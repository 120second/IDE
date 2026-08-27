use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::error::{AppError, AppResult};

use super::{
    mi::{
        const_field, field, parse_record, MiAsyncKind, MiListItem, MiRecord, MiResult,
        MiStreamKind, MiValue,
    },
    DebugBreakpoint, DebugBreakpointInput, DebugEvent, DebugFrame, DebugSessionSnapshot,
    DebugSessionState, DebugStartRequest, DebugVariable, DebugVariablePage, DebugWatchValue,
};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(800);
const CHILD_PAGE_LIMIT: u32 = 100;
const OUTPUT_BATCH_INTERVAL: Duration = Duration::from_millis(32);
const OUTPUT_BATCH_BYTES: usize = 32 * 1024;

type EventSink = Arc<dyn Fn(DebugEvent) + Send + Sync + 'static>;

#[derive(Debug)]
struct CommandResult {
    class: String,
    results: Vec<MiResult>,
}

struct PendingDebugOutput {
    chunks: Vec<(String, String)>,
    bytes: usize,
    last_flush: Instant,
}

impl PendingDebugOutput {
    fn new() -> Self {
        Self {
            chunks: Vec::new(),
            bytes: 0,
            last_flush: Instant::now(),
        }
    }

    fn push(&mut self, stream: &str, text: String) {
        if text.is_empty() {
            return;
        }
        self.bytes = self.bytes.saturating_add(text.len());
        if let Some((last_stream, last_text)) = self.chunks.last_mut() {
            if last_stream == stream {
                last_text.push_str(&text);
                return;
            }
        }
        self.chunks.push((stream.to_owned(), text));
    }

    fn should_flush(&self) -> bool {
        self.bytes >= OUTPUT_BATCH_BYTES || self.last_flush.elapsed() >= OUTPUT_BATCH_INTERVAL
    }

    fn flush(&mut self, session: &DebugSession) {
        for (stream, text) in self.chunks.drain(..) {
            session.emit_output(&stream, text);
        }
        self.bytes = 0;
        self.last_flush = Instant::now();
    }
}

pub struct DebugManager {
    active: Mutex<Option<Arc<DebugSession>>>,
    data_dir: PathBuf,
}

impl DebugManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            active: Mutex::new(None),
            data_dir,
        }
    }

    pub fn start<F>(&self, request: DebugStartRequest, emit: F) -> AppResult<DebugSessionSnapshot>
    where
        F: Fn(DebugEvent) + Send + Sync + 'static,
    {
        let mut active = self
            .active
            .lock()
            .map_err(|_| debugger_error("debug manager lock was poisoned"))?;
        if active.is_some() {
            return Err(debugger_error("a debug session is already active"));
        }
        let session = DebugSession::spawn(request, &self.data_dir, Arc::new(emit))?;
        if let Err(error) = session.initialize() {
            session.set_state(DebugSessionState::Error, error.to_string());
            session.shutdown();
            return Err(error);
        }
        let snapshot = session.empty_snapshot();
        *active = Some(session);
        Ok(snapshot)
    }

    pub fn stop(&self) -> AppResult<DebugSessionSnapshot> {
        let session = self
            .active
            .lock()
            .map_err(|_| debugger_error("debug manager lock was poisoned"))?
            .take();
        if let Some(session) = session {
            let id = session.id.clone();
            session.shutdown();
            Ok(DebugSessionSnapshot {
                session_id: id,
                state: DebugSessionState::Idle,
                reason: "调试已停止".to_owned(),
                selected_frame: 0,
                frames: Vec::new(),
                variables: Vec::new(),
                watches: Vec::new(),
                breakpoints: Vec::new(),
            })
        } else {
            Ok(DebugSessionSnapshot {
                session_id: String::new(),
                state: DebugSessionState::Idle,
                reason: String::new(),
                selected_frame: 0,
                frames: Vec::new(),
                variables: Vec::new(),
                watches: Vec::new(),
                breakpoints: Vec::new(),
            })
        }
    }

    pub fn restart(&self) -> AppResult<DebugSessionSnapshot> {
        let old = self
            .active
            .lock()
            .map_err(|_| debugger_error("debug manager lock was poisoned"))?
            .take()
            .ok_or_else(|| debugger_error("no active debug session"))?;
        let request = old.request.clone();
        let emit = old.emit.clone();
        old.shutdown();
        let session = DebugSession::spawn(request, &self.data_dir, emit)?;
        if let Err(error) = session.initialize() {
            session.set_state(DebugSessionState::Error, error.to_string());
            session.shutdown();
            return Err(error);
        }
        let snapshot = session.empty_snapshot();
        *self
            .active
            .lock()
            .map_err(|_| debugger_error("debug manager lock was poisoned"))? = Some(session);
        Ok(snapshot)
    }

    pub fn continue_execution(&self) -> AppResult<DebugSessionSnapshot> {
        let session = self.session()?;
        session.execute_control("-exec-continue")?;
        Ok(session.empty_snapshot())
    }

    pub fn pause(&self) -> AppResult<DebugSessionSnapshot> {
        let session = self.session()?;
        session.execute_control("-exec-interrupt --all")?;
        Ok(session.empty_snapshot())
    }

    pub fn step_over(&self) -> AppResult<DebugSessionSnapshot> {
        let session = self.session()?;
        session.execute_control("-exec-next")?;
        Ok(session.empty_snapshot())
    }

    pub fn step_into(&self) -> AppResult<DebugSessionSnapshot> {
        let session = self.session()?;
        session.execute_control("-exec-step")?;
        Ok(session.empty_snapshot())
    }

    pub fn step_out(&self) -> AppResult<DebugSessionSnapshot> {
        let session = self.session()?;
        session.execute_control("-exec-finish")?;
        Ok(session.empty_snapshot())
    }

    pub fn snapshot(
        &self,
        selected_frame: u32,
        watches: &[String],
    ) -> AppResult<DebugSessionSnapshot> {
        self.session()?.snapshot(selected_frame, watches)
    }

    pub fn fetch_children(
        &self,
        selected_frame: u32,
        expression: &str,
        variable_object: Option<&str>,
        from: u32,
        count: u32,
    ) -> AppResult<DebugVariablePage> {
        self.session()?
            .fetch_children(selected_frame, expression, variable_object, from, count)
    }

    pub fn set_breakpoint(&self, breakpoint: DebugBreakpointInput) -> AppResult<DebugBreakpoint> {
        self.session()?.set_breakpoint(breakpoint)
    }

    pub fn remove_breakpoint(&self, id: &str) -> AppResult<bool> {
        self.session()?.remove_breakpoint(id)
    }

    pub fn is_active(&self) -> bool {
        self.active
            .lock()
            .map(|active| active.is_some())
            .unwrap_or(false)
    }

    fn session(&self) -> AppResult<Arc<DebugSession>> {
        self.active
            .lock()
            .map_err(|_| debugger_error("debug manager lock was poisoned"))?
            .clone()
            .ok_or_else(|| debugger_error("no active debug session"))
    }
}

impl Drop for DebugManager {
    fn drop(&mut self) {
        if let Ok(active) = self.active.get_mut() {
            if let Some(session) = active.take() {
                session.shutdown();
            }
        }
    }
}

struct DebugSession {
    id: String,
    request: DebugStartRequest,
    emit: EventSink,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, mpsc::SyncSender<CommandResult>>>,
    next_token: AtomicU64,
    operation_lock: Mutex<()>,
    status: Mutex<(DebugSessionState, String)>,
    breakpoints: Mutex<Vec<DebugBreakpoint>>,
    shutting_down: AtomicBool,
    input_file: Option<PathBuf>,
}

impl DebugSession {
    fn spawn(request: DebugStartRequest, data_dir: &Path, emit: EventSink) -> AppResult<Arc<Self>> {
        let executable = dunce::canonicalize(&request.executable_path).map_err(|error| {
            debugger_start_error(format!(
                "调试程序不存在：{}（{error}）",
                request.executable_path
            ))
        })?;
        let working_directory =
            dunce::canonicalize(&request.working_directory).map_err(|error| {
                debugger_start_error(format!(
                    "调试工作目录不可用：{}（{error}）",
                    request.working_directory
                ))
            })?;
        if !executable.is_file() || !working_directory.is_dir() {
            return Err(debugger_start_error("调试程序或工作目录无效"));
        }

        let id = format!(
            "debug-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let input_file = if request.stdin.is_empty() {
            None
        } else {
            fs::create_dir_all(data_dir)?;
            let path = data_dir.join(format!("{id}.stdin"));
            fs::write(&path, request.stdin.as_bytes())?;
            Some(path)
        };

        let gdb_path = request.gdb_path.trim();
        let gdb_path = if gdb_path.is_empty() { "gdb" } else { gdb_path };
        let mut command = Command::new(gdb_path);
        command
            .args(["--interpreter=mi2", "--quiet", "--nx"])
            .current_dir(&working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_hidden(&mut command);
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                debugger_start_error(format!(
                    "找不到 GDB（{gdb_path}）。请在设置中填写 gdb.exe 的完整路径，或将 GDB 加入 PATH。"
                ))
            } else {
                debugger_start_error(format!("无法启动 GDB（{gdb_path}）：{error}"))
            }
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| debugger_error("GDB stdin pipe is unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| debugger_error("GDB stdout pipe is unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| debugger_error("GDB stderr pipe is unavailable"))?;

        let session = Arc::new(Self {
            id,
            request: DebugStartRequest {
                executable_path: executable.to_string_lossy().into_owned(),
                working_directory: working_directory.to_string_lossy().into_owned(),
                ..request
            },
            emit,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_token: AtomicU64::new(1),
            operation_lock: Mutex::new(()),
            status: Mutex::new((DebugSessionState::Starting, "正在启动 GDB".to_owned())),
            breakpoints: Mutex::new(Vec::new()),
            shutting_down: AtomicBool::new(false),
            input_file,
        });
        session.emit_state(DebugSessionState::Starting, "正在启动 GDB");
        Self::spawn_stdout_reader(&session, stdout);
        Self::spawn_stderr_reader(&session, stderr);
        Ok(session)
    }

    fn initialize(&self) -> AppResult<()> {
        let _operation = self.lock_operation()?;
        self.command_unlocked("-gdb-set pagination off")?;
        self.command_unlocked("-gdb-set confirm off")?;
        if self.command_unlocked("-gdb-set mi-async on").is_err() {
            self.command_unlocked("-gdb-set target-async on")?;
        }
        self.command_unlocked(&format!(
            "-environment-cd {}",
            mi_quote(&self.request.working_directory)
        ))?;
        self.command_unlocked(&format!(
            "-file-exec-and-symbols {}",
            mi_quote(&self.request.executable_path)
        ))?;

        let mut unique: Vec<DebugBreakpointInput> =
            Vec::with_capacity(self.request.breakpoints.len());
        for input in &self.request.breakpoints {
            if let Some(index) = unique
                .iter()
                .position(|existing| same_breakpoint_input_location(existing, input))
            {
                unique[index] = input.clone();
            } else {
                unique.push(input.clone());
            }
        }
        let mut installed = Vec::with_capacity(unique.len());
        for input in &unique {
            installed.push(self.insert_breakpoint_unlocked(input));
        }
        *self
            .breakpoints
            .lock()
            .map_err(|_| debugger_error("breakpoint lock was poisoned"))? = installed;
        self.emit_breakpoints();
        self.launch_unlocked()?;
        Ok(())
    }

    fn launch_unlocked(&self) -> AppResult<()> {
        self.set_state(DebugSessionState::Starting, "正在启动被调试程序");
        let result = if let Some(input) = &self.input_file {
            let command = format!("run < \"{}\"", slash_path(input));
            self.command_unlocked(&format!("-interpreter-exec console {}", mi_quote(&command)))?
        } else {
            self.command_unlocked("-exec-run")?
        };
        if !matches!(result.class.as_str(), "running" | "done") {
            return Err(debugger_error(format!(
                "GDB did not start the target: {}",
                result.class
            )));
        }
        if self.state() == DebugSessionState::Starting {
            self.set_state(DebugSessionState::Running, "程序正在运行");
        }
        Ok(())
    }

    fn execute_control(&self, command: &str) -> AppResult<()> {
        let _operation = self.lock_operation()?;
        if command != "-exec-interrupt --all" && self.state() != DebugSessionState::Stopped {
            return Err(debugger_error(
                "the target must be stopped before stepping or continuing",
            ));
        }
        self.command_unlocked(command)?;
        if command != "-exec-interrupt --all" {
            self.set_state(DebugSessionState::Running, "程序正在运行");
        }
        Ok(())
    }

    fn snapshot(&self, selected_frame: u32, watches: &[String]) -> AppResult<DebugSessionSnapshot> {
        let _operation = self.lock_operation()?;
        let (state, reason) = self.status();
        if state != DebugSessionState::Stopped {
            return Ok(self.snapshot_with(
                state,
                reason,
                selected_frame,
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ));
        }
        self.command_unlocked(&format!("-stack-select-frame {selected_frame}"))?;
        let frames = self.list_frames_unlocked()?;
        let variables = self.list_variables_unlocked()?;
        let watches = watches
            .iter()
            .map(|expression| self.evaluate_watch_unlocked(expression))
            .collect();
        Ok(self.snapshot_with(state, reason, selected_frame, frames, variables, watches))
    }

    fn list_frames_unlocked(&self) -> AppResult<Vec<DebugFrame>> {
        let result = self.command_unlocked("-stack-list-frames")?;
        let mut frames = Vec::new();
        if let Some(items) = field(&result.results, "stack").and_then(MiValue::as_list) {
            for tuple in list_tuples(items, "frame") {
                frames.push(DebugFrame {
                    level: number_field(tuple, "level"),
                    address: const_field(tuple, "addr").unwrap_or_default().to_owned(),
                    function: const_field(tuple, "func")
                        .unwrap_or("<未知函数>")
                        .to_owned(),
                    file: const_field(tuple, "file").unwrap_or_default().to_owned(),
                    full_name: const_field(tuple, "fullname")
                        .unwrap_or_default()
                        .to_owned(),
                    line: const_field(tuple, "line").and_then(|value| value.parse().ok()),
                });
            }
        }
        Ok(frames)
    }

    fn list_variables_unlocked(&self) -> AppResult<Vec<DebugVariable>> {
        // --simple-values intentionally avoids materializing arrays and structs.
        let result = self.command_unlocked("-stack-list-variables --simple-values")?;
        let mut variables = Vec::new();
        if let Some(items) = field(&result.results, "variables").and_then(MiValue::as_list) {
            for tuple in list_tuples(items, "variable") {
                let name = const_field(tuple, "name").unwrap_or_default().to_owned();
                let value = const_field(tuple, "value").unwrap_or_default().to_owned();
                let type_name = const_field(tuple, "type").unwrap_or_default().to_owned();
                let has_children = value.is_empty()
                    || value.starts_with('{')
                    || type_name.contains('[')
                    || type_name.contains("vector")
                    || type_name.contains("map")
                    || type_name.contains("set");
                variables.push(DebugVariable {
                    expression: name.clone(),
                    name,
                    value,
                    type_name,
                    num_children: 0,
                    has_children,
                    variable_object: None,
                });
            }
        }
        Ok(variables)
    }

    fn evaluate_watch_unlocked(&self, expression: &str) -> DebugWatchValue {
        let expression = expression.trim().chars().take(1024).collect::<String>();
        if expression.is_empty() {
            return DebugWatchValue {
                expression,
                value: String::new(),
                error: String::new(),
            };
        }
        match self.command_unlocked(&format!(
            "-data-evaluate-expression {}",
            mi_quote(&expression)
        )) {
            Ok(result) => DebugWatchValue {
                expression,
                value: const_field(&result.results, "value")
                    .unwrap_or_default()
                    .to_owned(),
                error: String::new(),
            },
            Err(error) => DebugWatchValue {
                expression,
                value: String::new(),
                error: error.to_string(),
            },
        }
    }

    fn fetch_children(
        &self,
        selected_frame: u32,
        expression: &str,
        variable_object: Option<&str>,
        from: u32,
        count: u32,
    ) -> AppResult<DebugVariablePage> {
        let _operation = self.lock_operation()?;
        if self.state() != DebugSessionState::Stopped {
            return Err(debugger_error(
                "variables can only be read while the target is stopped",
            ));
        }
        self.command_unlocked(&format!("-stack-select-frame {selected_frame}"))?;
        let parent_expression = expression.trim().chars().take(1024).collect::<String>();
        let (object, total) = if let Some(object) =
            variable_object.filter(|value| !value.is_empty())
        {
            (object.to_owned(), 0)
        } else {
            let created = self
                .command_unlocked(&format!("-var-create - * {}", mi_quote(&parent_expression)))?;
            (
                const_field(&created.results, "name")
                    .ok_or_else(|| debugger_error("GDB did not return a variable object"))?
                    .to_owned(),
                number_field(&created.results, "numchild"),
            )
        };
        let count = count.clamp(1, CHILD_PAGE_LIMIT);
        let to = from.saturating_add(count);
        let result = self.command_unlocked(&format!(
            "-var-list-children --simple-values {} {from} {to}",
            mi_quote(&object)
        ))?;
        let total = number_field(&result.results, "numchild").max(total);
        let mut children = Vec::new();
        if let Some(items) = field(&result.results, "children").and_then(MiValue::as_list) {
            for tuple in list_tuples(items, "child") {
                let name = const_field(tuple, "exp").unwrap_or("?").to_owned();
                let object_name = const_field(tuple, "name").unwrap_or_default().to_owned();
                let num_children = number_field(tuple, "numchild");
                children.push(DebugVariable {
                    expression: child_expression(&parent_expression, &name),
                    name,
                    value: const_field(tuple, "value").unwrap_or_default().to_owned(),
                    type_name: const_field(tuple, "type").unwrap_or_default().to_owned(),
                    num_children,
                    has_children: num_children > 0,
                    variable_object: (!object_name.is_empty()).then_some(object_name),
                });
            }
        }
        let has_more = const_field(&result.results, "has_more") == Some("1")
            || from.saturating_add(children.len() as u32) < total;
        Ok(DebugVariablePage {
            parent_expression,
            variable_object: object,
            from,
            total,
            has_more,
            children,
        })
    }

    fn set_breakpoint(&self, input: DebugBreakpointInput) -> AppResult<DebugBreakpoint> {
        let _operation = self.lock_operation()?;
        let old_numbers = self
            .breakpoints
            .lock()
            .map_err(|_| debugger_error("breakpoint lock was poisoned"))?
            .iter()
            .filter(|breakpoint| {
                breakpoint.id == input.id || same_breakpoint_location(breakpoint, &input)
            })
            .filter_map(|breakpoint| breakpoint.gdb_number.clone())
            .collect::<Vec<_>>();
        for number in old_numbers {
            let _ = self.command_unlocked(&format!("-break-delete {}", mi_quote(&number)));
        }
        let breakpoint = self.insert_breakpoint_unlocked(&input);
        let mut breakpoints = self
            .breakpoints
            .lock()
            .map_err(|_| debugger_error("breakpoint lock was poisoned"))?;
        breakpoints.retain(|candidate| {
            candidate.id != input.id && !same_breakpoint_location(candidate, &input)
        });
        breakpoints.push(breakpoint.clone());
        drop(breakpoints);
        self.emit_breakpoints();
        Ok(breakpoint)
    }

    fn remove_breakpoint(&self, id: &str) -> AppResult<bool> {
        let _operation = self.lock_operation()?;
        let number = self
            .breakpoints
            .lock()
            .map_err(|_| debugger_error("breakpoint lock was poisoned"))?
            .iter()
            .find(|breakpoint| breakpoint.id == id)
            .and_then(|breakpoint| breakpoint.gdb_number.clone());
        if let Some(number) = number {
            self.command_unlocked(&format!("-break-delete {}", mi_quote(&number)))?;
        }
        let mut breakpoints = self
            .breakpoints
            .lock()
            .map_err(|_| debugger_error("breakpoint lock was poisoned"))?;
        let before = breakpoints.len();
        breakpoints.retain(|breakpoint| breakpoint.id != id);
        let removed = before != breakpoints.len();
        drop(breakpoints);
        self.emit_breakpoints();
        Ok(removed)
    }

    fn insert_breakpoint_unlocked(&self, input: &DebugBreakpointInput) -> DebugBreakpoint {
        let mut breakpoint = DebugBreakpoint::from(input);
        if !input.enabled {
            return breakpoint;
        }
        let location = format!("{}:{}", slash_text(&input.file), input.line);
        let command = if input.condition.trim().is_empty() {
            format!("-break-insert {}", mi_quote(&location))
        } else {
            format!(
                "-break-insert -c {} {}",
                mi_quote(input.condition.trim()),
                mi_quote(&location)
            )
        };
        match self.command_unlocked(&command) {
            Ok(result) => {
                if let Some(tuple) = field(&result.results, "bkpt").and_then(MiValue::as_tuple) {
                    breakpoint.gdb_number = const_field(tuple, "number").map(str::to_owned);
                    breakpoint.line = const_field(tuple, "line")
                        .and_then(|line| line.parse().ok())
                        .unwrap_or(input.line);
                    breakpoint.verified = breakpoint.gdb_number.is_some();
                } else {
                    breakpoint.message = "GDB 未返回断点编号".to_owned();
                }
            }
            Err(error) => breakpoint.message = error.to_string(),
        }
        breakpoint
    }

    fn command_unlocked(&self, command: &str) -> AppResult<CommandResult> {
        if self.shutting_down.load(Ordering::Acquire) && command != "-gdb-exit" {
            return Err(debugger_error("debug session is shutting down"));
        }
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::sync_channel(1);
        self.pending
            .lock()
            .map_err(|_| debugger_error("GDB response lock was poisoned"))?
            .insert(token, sender);
        let write_result = self
            .stdin
            .lock()
            .map_err(|_| debugger_error("GDB stdin lock was poisoned"))
            .and_then(|mut stdin| {
                writeln!(stdin, "{token}{command}").map_err(AppError::from)?;
                stdin.flush().map_err(AppError::from)
            });
        if let Err(error) = write_result {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&token);
            }
            return Err(error);
        }
        let result = receiver.recv_timeout(COMMAND_TIMEOUT).map_err(|error| {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&token);
            }
            debugger_error(format!("GDB/MI command timed out ({command}): {error}"))
        })?;
        if result.class == "error" {
            let message = const_field(&result.results, "msg").unwrap_or("unknown GDB error");
            Err(debugger_error(format!("GDB/MI: {message}")))
        } else {
            Ok(result)
        }
    }

    fn spawn_stdout_reader(session: &Arc<Self>, stdout: impl Read + Send + 'static) {
        let weak = Arc::downgrade(session);
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let mut pending_output = PendingDebugOutput::new();
            for line in reader.lines() {
                let Some(session) = weak.upgrade() else {
                    return;
                };
                match line {
                    Ok(line) if !line.trim().is_empty() => {
                        session.handle_record(&line, &mut pending_output)
                    }
                    Ok(_) => {}
                    Err(error) => {
                        session.emit_output("log", format!("GDB 输出读取失败：{error}\n"));
                        break;
                    }
                }
            }
            if let Some(session) = weak.upgrade() {
                pending_output.flush(&session);
                session.handle_gdb_eof();
            }
        });
    }

    fn spawn_stderr_reader(session: &Arc<Self>, stderr: impl Read + Send + 'static) {
        let weak = Arc::downgrade(session);
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = [0_u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => return,
                    Ok(count) => {
                        let Some(session) = weak.upgrade() else {
                            return;
                        };
                        session.emit_output(
                            "log",
                            String::from_utf8_lossy(&buffer[..count]).into_owned(),
                        );
                    }
                    Err(_) => return,
                }
            }
        });
    }

    fn handle_record(&self, line: &str, pending_output: &mut PendingDebugOutput) {
        match parse_record(line) {
            Ok(MiRecord::Result {
                token: Some(token),
                class,
                results,
            }) => {
                pending_output.flush(self);
                let sender = self
                    .pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&token));
                if let Some(sender) = sender {
                    let _ = sender.send(CommandResult { class, results });
                }
            }
            Ok(MiRecord::Async {
                kind: MiAsyncKind::Exec,
                class,
                results,
                ..
            }) => {
                pending_output.flush(self);
                match class.as_str() {
                    "running" => self.set_state(DebugSessionState::Running, "程序正在运行"),
                    "stopped" => {
                        let reason = const_field(&results, "reason").unwrap_or("stopped");
                        if reason.starts_with("exited") {
                            self.set_state(
                                DebugSessionState::Exited,
                                stopped_reason(reason, &results),
                            );
                        } else {
                            self.set_state(
                                DebugSessionState::Stopped,
                                stopped_reason(reason, &results),
                            );
                        }
                    }
                    _ => {}
                }
            }
            Ok(MiRecord::Stream { kind, text }) => {
                let stream = match kind {
                    MiStreamKind::Console => "console",
                    MiStreamKind::Target => "target",
                    MiStreamKind::Log => "log",
                };
                pending_output.push(stream, text);
                if pending_output.should_flush() {
                    pending_output.flush(self);
                }
            }
            Ok(_) => pending_output.flush(self),
            Err(error) => {
                pending_output.push("log", format!("[MI 解析警告] {error}\n"));
                if pending_output.should_flush() {
                    pending_output.flush(self);
                }
            }
        }
    }

    fn handle_gdb_eof(&self) {
        if self.shutting_down.load(Ordering::Acquire) {
            return;
        }
        let state = self.state();
        if !matches!(state, DebugSessionState::Exited | DebugSessionState::Error) {
            self.set_state(DebugSessionState::Error, "GDB 进程意外退出");
        }
    }

    fn shutdown(&self) {
        if self.shutting_down.swap(true, Ordering::AcqRel) {
            return;
        }
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut stdin) = self.stdin.lock() {
            let _ = writeln!(stdin, "{token}-gdb-exit");
            let _ = stdin.flush();
        }
        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        loop {
            let exited = self
                .child
                .lock()
                .ok()
                .and_then(|mut child| child.try_wait().ok().flatten())
                .is_some();
            if exited {
                break;
            }
            if Instant::now() >= deadline {
                if let Ok(mut child) = self.child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        if let Some(path) = &self.input_file {
            let _ = fs::remove_file(path);
        }
        self.set_state(DebugSessionState::Idle, "调试已停止");
    }

    fn lock_operation(&self) -> AppResult<std::sync::MutexGuard<'_, ()>> {
        self.operation_lock
            .lock()
            .map_err(|_| debugger_error("debug operation lock was poisoned"))
    }

    fn state(&self) -> DebugSessionState {
        self.status
            .lock()
            .map(|status| status.0)
            .unwrap_or(DebugSessionState::Error)
    }

    fn status(&self) -> (DebugSessionState, String) {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or((DebugSessionState::Error, "调试状态不可用".to_owned()))
    }

    fn set_state(&self, state: DebugSessionState, reason: impl Into<String>) {
        let reason = reason.into();
        if let Ok(mut status) = self.status.lock() {
            *status = (state, reason.clone());
        }
        self.emit_state(state, &reason);
    }

    fn emit_state(&self, state: DebugSessionState, reason: &str) {
        (self.emit)(DebugEvent::State {
            session_id: self.id.clone(),
            state,
            reason: reason.to_owned(),
        });
    }

    fn emit_output(&self, stream: &str, text: String) {
        if text.is_empty() {
            return;
        }
        (self.emit)(DebugEvent::Output {
            session_id: self.id.clone(),
            stream: stream.to_owned(),
            text,
        });
    }

    fn emit_breakpoints(&self) {
        let breakpoints = self
            .breakpoints
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default();
        (self.emit)(DebugEvent::Breakpoints {
            session_id: self.id.clone(),
            breakpoints,
        });
    }

    fn empty_snapshot(&self) -> DebugSessionSnapshot {
        let (state, reason) = self.status();
        self.snapshot_with(state, reason, 0, Vec::new(), Vec::new(), Vec::new())
    }

    fn snapshot_with(
        &self,
        state: DebugSessionState,
        reason: String,
        selected_frame: u32,
        frames: Vec<DebugFrame>,
        variables: Vec<DebugVariable>,
        watches: Vec<DebugWatchValue>,
    ) -> DebugSessionSnapshot {
        DebugSessionSnapshot {
            session_id: self.id.clone(),
            state,
            reason,
            selected_frame,
            frames,
            variables,
            watches,
            breakpoints: self
                .breakpoints
                .lock()
                .map(|items| items.clone())
                .unwrap_or_default(),
        }
    }
}

fn list_tuples<'a>(items: &'a [MiListItem], result_name: &str) -> Vec<&'a [MiResult]> {
    items
        .iter()
        .filter_map(|item| match item {
            MiListItem::Value(MiValue::Tuple(tuple)) => Some(tuple.as_slice()),
            MiListItem::Result(result) if result.variable == result_name => result.value.as_tuple(),
            _ => None,
        })
        .collect()
}

fn number_field(results: &[MiResult], name: &str) -> u32 {
    const_field(results, name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn child_expression(parent: &str, child: &str) -> String {
    if child.chars().all(|character| character.is_ascii_digit()) {
        format!("{parent}[{child}]")
    } else if child.starts_with('[') || child.starts_with('.') || child.starts_with("->") {
        format!("{parent}{child}")
    } else {
        format!("{parent}.{child}")
    }
}

fn stopped_reason(reason: &str, results: &[MiResult]) -> String {
    match reason {
        "breakpoint-hit" => "命中断点".to_owned(),
        "end-stepping-range" | "function-finished" => "单步执行完成".to_owned(),
        "signal-received" => format!(
            "收到信号 {}",
            const_field(results, "signal-name").unwrap_or("未知")
        ),
        "exited-normally" => "程序正常退出".to_owned(),
        "exited" => format!(
            "程序退出，退出码 {}",
            const_field(results, "exit-code").unwrap_or("未知")
        ),
        "exited-signalled" => "程序因信号退出".to_owned(),
        other => format!("程序已暂停（{other}）"),
    }
}

fn mi_quote(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    for character in value.chars() {
        match character {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

fn slash_path(path: &Path) -> String {
    slash_text(&path.to_string_lossy())
}

fn slash_text(value: &str) -> String {
    value.replace('\\', "/")
}

fn normalized_debug_path(value: &str) -> String {
    slash_text(value).to_lowercase()
}

fn same_breakpoint_input_location(
    left: &DebugBreakpointInput,
    right: &DebugBreakpointInput,
) -> bool {
    left.line == right.line
        && normalized_debug_path(&left.file) == normalized_debug_path(&right.file)
}

fn same_breakpoint_location(breakpoint: &DebugBreakpoint, input: &DebugBreakpointInput) -> bool {
    breakpoint.line == input.line
        && normalized_debug_path(&breakpoint.file) == normalized_debug_path(&input.file)
}

fn debugger_error(message: impl Into<String>) -> AppError {
    AppError::Process(format!("debugger: {}", message.into()))
}

fn debugger_start_error(message: impl Into<String>) -> AppError {
    AppError::ProcessStart(format!("debugger: {}", message.into()))
}

#[cfg(windows)]
fn configure_hidden(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_hidden(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mi_strings_are_quoted_without_shell_interpolation() {
        assert_eq!(
            mi_quote("C:\\work dir\\a\"b.cpp"),
            "\"C:\\\\work dir\\\\a\\\"b.cpp\""
        );
        assert_eq!(slash_text("C:\\work\\main.cpp"), "C:/work/main.cpp");
    }

    #[test]
    fn child_expressions_cover_arrays_and_members() {
        assert_eq!(child_expression("a", "12"), "a[12]");
        assert_eq!(child_expression("node", "next"), "node.next");
        assert_eq!(child_expression("node", "->value"), "node->value");
    }

    #[test]
    fn breakpoint_locations_ignore_path_separator_and_case() {
        let left = DebugBreakpointInput {
            id: "left".to_owned(),
            file: "D:\\Code\\Main.cpp".to_owned(),
            line: 24,
            enabled: true,
            condition: String::new(),
        };
        let right = DebugBreakpointInput {
            id: "right".to_owned(),
            file: "d:/code/main.cpp".to_owned(),
            line: 24,
            enabled: true,
            condition: String::new(),
        };
        assert!(same_breakpoint_input_location(&left, &right));
    }

    #[test]
    fn mi_stream_output_is_merged_before_ipc() {
        let mut pending = PendingDebugOutput::new();
        for _ in 0..100_000 {
            pending.push("target", "line\n".to_owned());
        }
        assert_eq!(pending.chunks.len(), 1);
        assert_eq!(pending.bytes, 500_000);
        assert!(pending.should_flush());
    }

    #[test]
    fn gdb_mi_session_supports_breakpoints_stdin_stack_variables_and_watches() {
        let _process_guard = crate::PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if Command::new("gdb").arg("--version").output().is_err()
            || Command::new("g++").arg("--version").output().is_err()
        {
            eprintln!("skipping GDB/MI integration test because gdb or g++ is unavailable");
            return;
        }
        let root = std::env::temp_dir().join(format!(
            "lightcp-debugger-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("调试 case.cpp");
        let executable = root.join("debug-case.exe");
        fs::write(
            &source,
            "#include <iostream>\nint main() {\n  int n = 0;\n  std::cin >> n;\n  int x = n + 1;\n  std::cout << x << '\\n';\n  return 0;\n}\n",
        )
        .unwrap();
        let compile = Command::new("g++")
            .args(["-g", "-O0"])
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            compile.status.success(),
            "{}",
            String::from_utf8_lossy(&compile.stderr)
        );

        let (events, receiver) = mpsc::channel();
        let manager = DebugManager::new(root.join("debug-data"));
        manager
            .start(
                DebugStartRequest {
                    gdb_path: "gdb".to_owned(),
                    executable_path: executable.to_string_lossy().into_owned(),
                    source_path: source.to_string_lossy().into_owned(),
                    working_directory: root.to_string_lossy().into_owned(),
                    stdin: "41\n".to_owned(),
                    breakpoints: vec![DebugBreakpointInput {
                        id: "bp-1".to_owned(),
                        file: source.to_string_lossy().into_owned(),
                        line: 6,
                        enabled: true,
                        condition: "n == 41".to_owned(),
                    }],
                },
                move |event| {
                    let _ = events.send(event);
                },
            )
            .unwrap();

        let deadline = Instant::now() + Duration::from_secs(8);
        let mut stopped = false;
        while Instant::now() < deadline {
            if let Ok(DebugEvent::State {
                state: DebugSessionState::Stopped,
                ..
            }) = receiver.recv_timeout(Duration::from_millis(100))
            {
                stopped = true;
                break;
            }
        }
        assert!(stopped, "GDB should stop at the conditional breakpoint");
        let snapshot = manager.snapshot(0, &["x".to_owned()]).unwrap();
        assert_eq!(snapshot.state, DebugSessionState::Stopped);
        assert!(snapshot.frames.iter().any(|frame| frame.function == "main"));
        assert!(snapshot
            .variables
            .iter()
            .any(|variable| variable.name == "n"));
        assert_eq!(snapshot.watches[0].value, "42");
        manager
            .set_breakpoint(DebugBreakpointInput {
                id: "bp-replacement".to_owned(),
                file: source.to_string_lossy().into_owned(),
                line: 6,
                enabled: true,
                condition: String::new(),
            })
            .unwrap();
        let replaced = manager.snapshot(0, &[]).unwrap();
        assert_eq!(replaced.breakpoints.len(), 1);
        assert_eq!(replaced.breakpoints[0].id, "bp-replacement");
        manager.stop().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
