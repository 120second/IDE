use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use url::Url;

use crate::error::{AppError, AppResult};

use super::{
    model::{LspDiagnostic, LspEvent, LspPosition, LspRange, LspStartResult, LspTextChange},
    protocol::{read_message, write_message},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(700);
const MAX_DIAGNOSTICS_PER_FILE: usize = 2_000;

type EventSink = Arc<dyn Fn(LspEvent) + Send + Sync + 'static>;
type PendingSender = mpsc::SyncSender<Result<Value, String>>;

struct PendingRequest {
    sender: PendingSender,
    client_request_id: Option<u64>,
}

pub struct ClangdManager {
    active: Mutex<Option<Arc<ClangdSession>>>,
    operation_lock: Mutex<()>,
}

impl Default for ClangdManager {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            operation_lock: Mutex::new(()),
        }
    }
}

impl ClangdManager {
    pub fn start<F>(
        &self,
        workspace_root: PathBuf,
        configured_path: String,
        compiler_path: String,
        compiler_standard: String,
        compiler_args: Vec<String>,
        emit: F,
    ) -> AppResult<LspStartResult>
    where
        F: Fn(LspEvent) + Send + Sync + 'static,
    {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| lsp_error("clangd lifecycle lock was poisoned"))?;
        self.stop_unlocked()?;
        let session = ClangdSession::spawn(
            workspace_root,
            &configured_path,
            &compiler_path,
            &compiler_standard,
            compiler_args,
            Arc::new(emit),
        )?;
        let result = match session.initialize() {
            Ok(result) => result,
            Err(error) => {
                session.shutdown();
                return Err(error);
            }
        };
        *self
            .active
            .lock()
            .map_err(|_| lsp_error("clangd manager lock was poisoned"))? = Some(session);
        Ok(result)
    }

    pub fn stop(&self) -> AppResult<()> {
        let _operation = self
            .operation_lock
            .lock()
            .map_err(|_| lsp_error("clangd lifecycle lock was poisoned"))?;
        self.stop_unlocked()
    }

    fn stop_unlocked(&self) -> AppResult<()> {
        let session = self
            .active
            .lock()
            .map_err(|_| lsp_error("clangd manager lock was poisoned"))?
            .take();
        if let Some(session) = session {
            session.shutdown();
        }
        Ok(())
    }

    pub fn notify(&self, method: &str, params: Value) -> AppResult<()> {
        self.session()?.notify(method, params)
    }

    pub fn did_open(&self, path: &str, text: String, version: i64) -> AppResult<()> {
        let session = self.session()?;
        session.validate_document_path(path)?;
        session.configure_document(path)?;
        session.notify(
            "textDocument/didOpen",
            did_open_params(path, text, version)?,
        )
    }

    pub fn did_change(
        &self,
        path: &str,
        version: i64,
        changes: Vec<LspTextChange>,
    ) -> AppResult<()> {
        if changes.is_empty() {
            return Ok(());
        }
        let session = self.session()?;
        session.validate_document_path(path)?;
        session.notify(
            "textDocument/didChange",
            did_change_params(path, version, changes)?,
        )
    }

    pub fn did_save(&self, path: &str) -> AppResult<()> {
        let session = self.session()?;
        session.validate_document_path(path)?;
        session.notify("textDocument/didSave", did_save_params(path)?)
    }

    pub fn did_close(&self, path: &str) -> AppResult<()> {
        let session = self.session()?;
        session.validate_document_path(path)?;
        session.notify(
            "textDocument/didClose",
            json!({ "textDocument": text_document(path)? }),
        )
    }

    pub fn completion(
        &self,
        path: &str,
        position: LspPosition,
        context: Value,
        client_request_id: u64,
    ) -> AppResult<Value> {
        let session = self.session()?;
        session.validate_document_path(path)?;
        let mut params = text_document_position(path, position)?;
        if let Some(object) = params.as_object_mut() {
            object.insert("context".to_owned(), context);
        }
        session
            .request(
                "textDocument/completion",
                params,
                Some(client_request_id),
                REQUEST_TIMEOUT,
            )
            .map(|value| limit_completion_result(value, 500))
    }

    pub fn position_request(
        &self,
        method: &str,
        path: &str,
        position: LspPosition,
        client_request_id: u64,
    ) -> AppResult<Value> {
        if !matches!(
            method,
            "textDocument/hover" | "textDocument/definition" | "textDocument/signatureHelp"
        ) {
            return Err(AppError::Configuration(format!(
                "unsupported LSP request: {method}"
            )));
        }
        let session = self.session()?;
        session.validate_document_path(path)?;
        session
            .request(
                method,
                text_document_position(path, position)?,
                Some(client_request_id),
                REQUEST_TIMEOUT,
            )
            .map(|value| {
                if method == "textDocument/definition" {
                    limit_array_result(value, 2_000)
                } else {
                    value
                }
            })
    }

    pub fn references(
        &self,
        path: &str,
        position: LspPosition,
        client_request_id: u64,
    ) -> AppResult<Value> {
        let session = self.session()?;
        session.validate_document_path(path)?;
        session
            .request(
                "textDocument/references",
                references_params(path, position)?,
                Some(client_request_id),
                REQUEST_TIMEOUT,
            )
            .map(|value| limit_array_result(value, 2_000))
    }

    pub fn cancel(&self, client_request_id: u64) -> AppResult<bool> {
        self.session()?.cancel(client_request_id)
    }

    pub fn is_active(&self) -> bool {
        self.active
            .lock()
            .ok()
            .and_then(|session| session.clone())
            .is_some_and(|session| session.healthy.load(Ordering::Relaxed))
    }

    fn session(&self) -> AppResult<Arc<ClangdSession>> {
        let session = self
            .active
            .lock()
            .map_err(|_| lsp_error("clangd manager lock was poisoned"))?
            .clone()
            .ok_or_else(|| lsp_error("clangd is not running"))?;
        if !session.healthy.load(Ordering::Relaxed) {
            return Err(lsp_error("clangd session has exited"));
        }
        Ok(session)
    }
}

impl Drop for ClangdManager {
    fn drop(&mut self) {
        if let Ok(active) = self.active.get_mut() {
            if let Some(session) = active.take() {
                session.shutdown();
            }
        }
    }
}

struct ClangdSession {
    executable: String,
    workspace_root: PathBuf,
    compiler_executable: String,
    compiler_standard: String,
    compiler_args: Vec<String>,
    emit: EventSink,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, PendingRequest>>,
    client_requests: Mutex<HashMap<u64, u64>>,
    next_request_id: AtomicU64,
    healthy: AtomicBool,
    shutting_down: AtomicBool,
    last_stderr: Mutex<String>,
}

impl ClangdSession {
    fn spawn(
        workspace_root: PathBuf,
        configured_path: &str,
        compiler_path: &str,
        compiler_standard: &str,
        compiler_args: Vec<String>,
        emit: EventSink,
    ) -> AppResult<Arc<Self>> {
        if !workspace_root.is_dir() {
            return Err(AppError::Configuration(format!(
                "clangd 工作区不存在或不是目录：{}",
                workspace_root.display()
            )));
        }

        let compiler_executable = resolve_compiler_executable(compiler_path)?;
        let compiler_standard = normalize_compiler_standard(compiler_standard);
        let compiler_args = compiler_args
            .into_iter()
            .map(|argument| argument.trim().chars().take(4096).collect::<String>())
            .filter(|argument| !argument.is_empty())
            .take(128)
            .collect::<Vec<_>>();
        let candidates = clangd_candidates(configured_path);
        let mut errors = Vec::new();
        for executable in candidates {
            let mut command = Command::new(&executable);
            command
                .arg("--background-index")
                .arg(format!("--query-driver={compiler_executable}"))
                .current_dir(&workspace_root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            configure_hidden(&mut command);
            match command.spawn() {
                Ok(mut child) => {
                    let (Some(stdin), Some(stdout), Some(stderr)) =
                        (child.stdin.take(), child.stdout.take(), child.stderr.take())
                    else {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(lsp_error("clangd stdio pipes are unavailable"));
                    };
                    let session = Arc::new(Self {
                        executable: executable.clone(),
                        workspace_root,
                        compiler_executable,
                        compiler_standard,
                        compiler_args,
                        emit,
                        child: Mutex::new(child),
                        stdin: Mutex::new(stdin),
                        pending: Mutex::new(HashMap::new()),
                        client_requests: Mutex::new(HashMap::new()),
                        next_request_id: AtomicU64::new(1),
                        healthy: AtomicBool::new(true),
                        shutting_down: AtomicBool::new(false),
                        last_stderr: Mutex::new(String::new()),
                    });
                    session.emit_state("starting", "正在初始化 clangd…");
                    Self::spawn_stdout_reader(&session, stdout);
                    Self::spawn_stderr_reader(&session, stderr);
                    return Ok(session);
                }
                Err(error) => errors.push(format!("{executable}: {error}")),
            }
        }

        let configured = configured_path.trim();
        let message = if configured.is_empty() {
            "找不到 clangd。请安装 LLVM/clangd，或在设置中填写 clangd.exe 的完整路径。".to_owned()
        } else {
            format!(
                "无法启动 clangd（{configured}）。请检查设置中的路径；中文路径和空格路径可直接填写完整文件名。"
            )
        };
        Err(AppError::ProcessStart(format!(
            "{message} 尝试结果：{}",
            errors.join("；")
        )))
    }

    fn initialize(&self) -> AppResult<LspStartResult> {
        let root_uri = file_uri(&self.workspace_root)?;
        let result = self.request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "clientInfo": { "name": "LightCP", "version": env!("CARGO_PKG_VERSION") },
                "rootUri": root_uri,
                "capabilities": {
                    "workspace": { "workspaceFolders": true },
                    "textDocument": {
                        "synchronization": { "dynamicRegistration": false, "didSave": true },
                        "publishDiagnostics": { "relatedInformation": false, "versionSupport": true },
                        "completion": {
                            "completionItem": {
                                "snippetSupport": false,
                                "documentationFormat": ["plaintext", "markdown"]
                            },
                            "contextSupport": true
                        },
                        "hover": { "contentFormat": ["plaintext", "markdown"] },
                        "signatureHelp": {
                            "signatureInformation": {
                                "documentationFormat": ["plaintext", "markdown"],
                                "parameterInformation": { "labelOffsetSupport": true }
                            }
                        },
                        "definition": { "linkSupport": true },
                        "references": {}
                    }
                },
                "workspaceFolders": [{ "uri": root_uri, "name": workspace_name(&self.workspace_root) }],
                "trace": "off"
            }),
            None,
            REQUEST_TIMEOUT,
        )?;
        self.notify("initialized", json!({}))?;

        let server = result.get("serverInfo").cloned().unwrap_or(Value::Null);
        let server_name = server
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("clangd")
            .to_owned();
        let server_version = server
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        self.emit_state(
            "ready",
            if server_version.is_empty() {
                "clangd 已就绪".to_owned()
            } else {
                format!("clangd {server_version} 已就绪")
            },
        );
        Ok(LspStartResult {
            executable: self.executable.clone(),
            server_name,
            server_version,
        })
    }

    fn notify(&self, method: &str, params: Value) -> AppResult<()> {
        if !self.healthy.load(Ordering::Relaxed) {
            return Err(lsp_error("clangd session has exited"));
        }
        self.send(json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
    }

    fn validate_document_path(&self, path: &str) -> AppResult<()> {
        let candidate = PathBuf::from(path);
        let comparable = dunce::canonicalize(&candidate).unwrap_or(candidate);
        if !crate::paths::is_within(&self.workspace_root, &comparable) {
            return Err(AppError::Configuration(format!(
                "LSP document is outside the active workspace: {}",
                comparable.display()
            )));
        }
        Ok(())
    }

    fn configure_document(&self, path: &str) -> AppResult<()> {
        if has_compilation_database(Path::new(path)) {
            return Ok(());
        }
        let working_directory = Path::new(path)
            .parent()
            .unwrap_or(&self.workspace_root)
            .to_string_lossy()
            .into_owned();
        let mut compilation_command = Vec::with_capacity(self.compiler_args.len() + 3);
        compilation_command.push(self.compiler_executable.clone());
        compilation_command.push(format!("-std={}", self.compiler_standard));
        compilation_command.extend(self.compiler_args.iter().cloned());
        compilation_command.push(path.to_owned());

        let mut changes = serde_json::Map::new();
        changes.insert(
            path.to_owned(),
            json!({
                "workingDirectory": working_directory,
                "compilationCommand": compilation_command,
            }),
        );
        self.notify(
            "workspace/didChangeConfiguration",
            json!({
                "settings": {
                    "compilationDatabaseChanges": Value::Object(changes),
                }
            }),
        )
    }

    fn request(
        &self,
        method: &str,
        params: Value,
        client_request_id: Option<u64>,
        timeout: Duration,
    ) -> AppResult<Value> {
        if !self.healthy.load(Ordering::Relaxed) {
            return Err(lsp_error("clangd session has exited"));
        }
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::sync_channel(1);
        self.pending
            .lock()
            .map_err(|_| lsp_error("clangd pending-request lock was poisoned"))?
            .insert(
                request_id,
                PendingRequest {
                    sender,
                    client_request_id,
                },
            );
        if let Some(client_request_id) = client_request_id {
            let previous = self
                .client_requests
                .lock()
                .map_err(|_| lsp_error("clangd client-request lock was poisoned"))?
                .insert(client_request_id, request_id);
            if let Some(previous) = previous {
                self.cancel_internal(previous);
            }
        }

        if let Err(error) = self.send(json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        })) {
            self.remove_pending(request_id);
            return Err(error);
        }

        match receiver.recv_timeout(timeout) {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(message)) => Err(lsp_error(message)),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.cancel_internal(request_id);
                Err(lsp_error(format!("clangd request timed out: {method}")))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(lsp_error("clangd response channel closed unexpectedly"))
            }
        }
    }

    fn cancel(&self, client_request_id: u64) -> AppResult<bool> {
        let request_id = self
            .client_requests
            .lock()
            .map_err(|_| lsp_error("clangd client-request lock was poisoned"))?
            .remove(&client_request_id);
        if let Some(request_id) = request_id {
            self.cancel_internal(request_id);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn cancel_internal(&self, request_id: u64) {
        if let Some(pending) = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&request_id))
        {
            if let Some(client_request_id) = pending.client_request_id {
                if let Ok(mut requests) = self.client_requests.lock() {
                    requests.remove(&client_request_id);
                }
            }
            let _ = pending.sender.try_send(Err("request cancelled".to_owned()));
            let _ = self.send(json!({
                "jsonrpc": "2.0",
                "method": "$/cancelRequest",
                "params": { "id": request_id },
            }));
        }
    }

    fn send(&self, message: Value) -> AppResult<()> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| lsp_error("clangd stdin lock was poisoned"))?;
        write_message(&mut *stdin, &message)
    }

    fn spawn_stdout_reader(session: &Arc<Self>, stdout: impl std::io::Read + Send + 'static) {
        let weak = Arc::downgrade(session);
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let failure = loop {
                match read_message(&mut reader) {
                    Ok(Some(message)) => {
                        let Some(session) = weak.upgrade() else {
                            return;
                        };
                        session.handle_message(message);
                    }
                    Ok(None) => break "clangd 已退出".to_owned(),
                    Err(error) => break format!("clangd 通信失败：{error}"),
                }
            };
            if let Some(session) = weak.upgrade() {
                session.handle_exit(failure);
            }
        });
    }

    fn spawn_stderr_reader(session: &Arc<Self>, stderr: impl std::io::Read + Send + 'static) {
        let weak = Arc::downgrade(session);
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let Some(session) = weak.upgrade() else {
                    return;
                };
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                log::debug!("clangd: {line}");
                if let Ok(mut last) = session.last_stderr.lock() {
                    *last = line.chars().take(1_000).collect();
                };
            }
        });
    }

    fn handle_message(&self, message: Value) {
        if message.get("method").is_none() {
            if let Some(request_id) = message.get("id").and_then(Value::as_u64) {
                let pending = self
                    .pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&request_id));
                if let Some(pending) = pending {
                    if let Some(client_request_id) = pending.client_request_id {
                        if let Ok(mut requests) = self.client_requests.lock() {
                            requests.remove(&client_request_id);
                        }
                    }
                    let result = if let Some(error) = message.get("error") {
                        Err(format_json_rpc_error(error))
                    } else {
                        Ok(message.get("result").cloned().unwrap_or(Value::Null))
                    };
                    let _ = pending.sender.try_send(result);
                }
            }
            return;
        }

        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if method == "textDocument/publishDiagnostics" {
            self.handle_diagnostics(message.get("params").cloned().unwrap_or(Value::Null));
            return;
        }

        if let Some(id) = message.get("id").cloned() {
            let result = match method {
                "workspace/configuration" => {
                    let count = message
                        .pointer("/params/items")
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len);
                    Value::Array((0..count).map(|_| Value::Null).collect())
                }
                "window/workDoneProgress/create"
                | "client/registerCapability"
                | "client/unregisterCapability" => Value::Null,
                _ => Value::Null,
            };
            let _ = self.send(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
        }
    }

    fn handle_diagnostics(&self, params: Value) {
        let Some(uri) = params.get("uri").and_then(Value::as_str) else {
            return;
        };
        let Ok(path) = path_from_uri(uri) else {
            return;
        };
        if !crate::paths::is_within(&self.workspace_root, &path) {
            return;
        }
        let diagnostics = params
            .get("diagnostics")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(MAX_DIAGNOSTICS_PER_FILE)
            .filter_map(parse_diagnostic)
            .collect();
        (self.emit)(LspEvent::Diagnostics {
            path: path.to_string_lossy().into_owned(),
            diagnostics,
        });
    }

    fn handle_exit(&self, mut message: String) {
        self.healthy.store(false, Ordering::Relaxed);
        if let Ok(last) = self.last_stderr.lock() {
            if !last.is_empty() {
                message.push('：');
                message.push_str(&last);
            }
        }
        if let Ok(mut pending) = self.pending.lock() {
            for (_, request) in pending.drain() {
                let _ = request.sender.try_send(Err(message.clone()));
            }
        }
        if let Ok(mut requests) = self.client_requests.lock() {
            requests.clear();
        }
        if let Ok(mut child) = self.child.lock() {
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        if !self.shutting_down.load(Ordering::Relaxed) {
            self.emit_state(
                "crashed",
                format!("{message}。可在设置中检查路径后重新连接。"),
            );
        }
    }

    fn remove_pending(&self, request_id: u64) {
        let request = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&request_id));
        if let Some(client_request_id) = request.and_then(|request| request.client_request_id) {
            if let Ok(mut requests) = self.client_requests.lock() {
                requests.remove(&client_request_id);
            }
        }
    }

    fn emit_state(&self, state: &str, message: impl Into<String>) {
        (self.emit)(LspEvent::State {
            state: state.to_owned(),
            message: message.into(),
        });
    }

    fn shutdown(&self) {
        if self.shutting_down.swap(true, Ordering::Relaxed) {
            return;
        }
        if self.healthy.load(Ordering::Relaxed) {
            let _ = self.request("shutdown", Value::Null, None, Duration::from_millis(500));
            let _ = self.notify("exit", Value::Null);
        }
        self.healthy.store(false, Ordering::Relaxed);

        if let Ok(mut child) = self.child.lock() {
            let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                thread::sleep(Duration::from_millis(20));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn resolve_compiler_executable(configured_path: &str) -> AppResult<String> {
    let configured = configured_path.trim();
    let configured = if configured.is_empty() {
        "g++"
    } else {
        configured
    };
    let direct = PathBuf::from(configured);
    if direct.is_file() {
        return Ok(dunce::canonicalize(&direct)
            .unwrap_or(direct)
            .to_string_lossy()
            .into_owned());
    }
    if direct.is_absolute() || configured.contains('/') || configured.contains('\\') {
        return Err(AppError::CompilerNotFound(configured.to_owned()));
    }

    let mut names = vec![configured.to_owned()];
    #[cfg(windows)]
    if direct.extension().is_none() {
        let extensions =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_owned());
        names.extend(
            extensions
                .split(';')
                .filter(|extension| !extension.is_empty())
                .map(|extension| format!("{configured}{extension}")),
        );
    }

    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            for name in &names {
                let candidate = directory.join(name);
                if !candidate.is_file() {
                    continue;
                }
                return Ok(dunce::canonicalize(&candidate)
                    .unwrap_or(candidate)
                    .to_string_lossy()
                    .into_owned());
            }
        }
    }
    Err(AppError::CompilerNotFound(configured.to_owned()))
}

fn normalize_compiler_standard(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        "c++20".to_owned()
    } else {
        value.chars().take(32).collect()
    }
}

fn has_compilation_database(source: &Path) -> bool {
    let mut directory = source.parent();
    while let Some(candidate) = directory {
        if candidate.join("compile_commands.json").is_file()
            || candidate
                .join("build")
                .join("compile_commands.json")
                .is_file()
        {
            return true;
        }
        directory = candidate.parent();
    }
    false
}

fn clangd_candidates(configured_path: &str) -> Vec<String> {
    let configured_path = configured_path.trim();
    if !configured_path.is_empty() {
        return vec![configured_path.chars().take(2048).collect()];
    }
    let mut candidates = vec!["clangd".to_owned()];
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(variable) {
                roots.push(PathBuf::from(root));
            }
        }
        for root in roots {
            let llvm = root.join(r"LLVM\bin\clangd.exe");
            if llvm.is_file() {
                candidates.push(llvm.to_string_lossy().into_owned());
            }
            for edition in ["Community", "BuildTools", "Professional", "Enterprise"] {
                for relative in [
                    r"VC\Tools\Llvm\x64\bin\clangd.exe",
                    r"VC\Tools\Llvm\bin\clangd.exe",
                ] {
                    let visual_studio = root
                        .join("Microsoft Visual Studio")
                        .join("2022")
                        .join(edition)
                        .join(relative);
                    if visual_studio.is_file() {
                        candidates.push(visual_studio.to_string_lossy().into_owned());
                    }
                }
            }
        }
        candidates.dedup();
    }
    candidates
}

fn limit_array_result(value: Value, limit: usize) -> Value {
    match value {
        Value::Array(mut values) => {
            values.truncate(limit);
            Value::Array(values)
        }
        other => other,
    }
}

fn limit_completion_result(mut value: Value, limit: usize) -> Value {
    if let Value::Array(values) = &mut value {
        values.truncate(limit);
    } else if let Some(items) = value.get_mut("items").and_then(Value::as_array_mut) {
        items.truncate(limit);
    }
    value
}

fn text_document(path: &str) -> AppResult<Value> {
    Ok(json!({ "uri": file_uri(Path::new(path))? }))
}

fn text_document_position(path: &str, position: LspPosition) -> AppResult<Value> {
    Ok(json!({
        "textDocument": text_document(path)?,
        "position": position,
    }))
}

fn did_open_params(path: &str, text: String, version: i64) -> AppResult<Value> {
    Ok(json!({
        "textDocument": {
            "uri": file_uri(Path::new(path))?,
            "languageId": "cpp",
            "version": version,
            "text": text,
        }
    }))
}

fn did_change_params(path: &str, version: i64, changes: Vec<LspTextChange>) -> AppResult<Value> {
    Ok(json!({
        "textDocument": {
            "uri": file_uri(Path::new(path))?,
            "version": version,
        },
        "contentChanges": changes,
    }))
}

fn did_save_params(path: &str) -> AppResult<Value> {
    Ok(json!({ "textDocument": text_document(path)? }))
}

fn references_params(path: &str, position: LspPosition) -> AppResult<Value> {
    let mut params = text_document_position(path, position)?;
    if let Some(object) = params.as_object_mut() {
        object.insert("context".to_owned(), json!({ "includeDeclaration": true }));
    }
    Ok(params)
}

fn parse_diagnostic(value: &Value) -> Option<LspDiagnostic> {
    let range = parse_range(value.get("range")?)?;
    Some(LspDiagnostic {
        range,
        severity: value
            .get("severity")
            .and_then(Value::as_u64)
            .unwrap_or(3)
            .clamp(1, 4) as u8,
        message: value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("clangd diagnostic")
            .chars()
            .take(8_000)
            .collect(),
        source: value
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("clangd")
            .chars()
            .take(128)
            .collect(),
        code: value
            .get("code")
            .map(|code| match code {
                Value::String(code) => code.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default()
            .chars()
            .take(256)
            .collect(),
    })
}

fn parse_range(value: &Value) -> Option<LspRange> {
    Some(LspRange {
        start: parse_position(value.get("start")?)?,
        end: parse_position(value.get("end")?)?,
    })
}

fn parse_position(value: &Value) -> Option<LspPosition> {
    Some(LspPosition {
        line: value.get("line")?.as_u64()?.min(u64::from(u32::MAX)) as u32,
        character: value.get("character")?.as_u64()?.min(u64::from(u32::MAX)) as u32,
    })
}

fn file_uri(path: &Path) -> AppResult<String> {
    Url::from_file_path(path).map(String::from).map_err(|_| {
        AppError::Configuration(format!("无法把路径转换为 file URI：{}", path.display()))
    })
}

fn path_from_uri(uri: &str) -> AppResult<PathBuf> {
    Url::parse(uri)
        .map_err(|error| lsp_error(format!("clangd returned an invalid URI: {error}")))?
        .to_file_path()
        .map_err(|_| lsp_error(format!("clangd returned a non-file URI: {uri}")))
}

fn workspace_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("workspace")
        .to_owned()
}

fn format_json_rpc_error(error: &Value) -> String {
    let code = error
        .get("code")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("clangd request failed");
    format!("clangd request failed ({code}): {message}")
}

fn lsp_error(message: impl Into<String>) -> AppError {
    AppError::Process(message.into())
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
    use std::{fs, process::Command, sync::Mutex};

    use super::*;

    static CLANGD_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn parses_diagnostics_without_materializing_unbounded_input() {
        let diagnostic = parse_diagnostic(&json!({
            "range": {
                "start": { "line": 2, "character": 4 },
                "end": { "line": 2, "character": 9 }
            },
            "severity": 1,
            "message": "unknown identifier",
            "source": "clangd",
            "code": "undeclared_var_use"
        }))
        .expect("diagnostic should parse");
        assert_eq!(diagnostic.range.start.line, 2);
        assert_eq!(diagnostic.severity, 1);
        assert_eq!(diagnostic.code, "undeclared_var_use");
    }

    #[test]
    fn configured_clangd_path_is_not_split_on_spaces() {
        assert_eq!(
            clangd_candidates(r"C:\Program Files\LLVM\bin\clangd.exe"),
            vec![r"C:\Program Files\LLVM\bin\clangd.exe"]
        );
    }

    #[test]
    fn clangd_session_starts_synchronizes_and_stops_when_available() {
        let _lock = CLANGD_TEST_LOCK
            .lock()
            .expect("test lock should be available");
        let Some(_clangd) = clangd_candidates("").into_iter().find(|candidate| {
            Command::new(candidate)
                .arg("--version")
                .output()
                .is_ok_and(|output| output.status.success())
        }) else {
            return;
        };
        let root = std::env::temp_dir().join(format!(
            "lightcp-clangd-中文 空格-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after Unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("temporary workspace should be created");
        let source = root.join("main.cpp");
        let text = "#include <bits/stdc++.h>\nint helper(int value) { return value; }\nint main() { std::vector<int> values; return helper(missing_name); }\n";
        fs::write(&source, text).expect("source should be written");

        let manager = ClangdManager::default();
        let (event_sender, event_receiver) = std::sync::mpsc::channel();
        let result = manager
            .start(
                root.clone(),
                String::new(),
                "g++".to_owned(),
                "c++20".to_owned(),
                Vec::new(),
                move |event| {
                    let _ = event_sender.send(event);
                },
            )
            .expect("clangd should initialize");
        assert!(!result.executable.is_empty());
        manager
            .did_open(&source.to_string_lossy(), text.to_owned(), 1)
            .expect("document should open");
        let hover = manager
            .position_request(
                "textDocument/hover",
                &source.to_string_lossy(),
                LspPosition {
                    line: 2,
                    character: 22,
                },
                99,
            )
            .expect("hover request should complete");
        assert!(hover.is_object() || hover.is_null());
        let definition = manager
            .position_request(
                "textDocument/definition",
                &source.to_string_lossy(),
                LspPosition {
                    line: 2,
                    character: 22,
                },
                100,
            )
            .expect("definition request should complete");
        assert!(!definition.is_null());
        let references = manager
            .references(
                &source.to_string_lossy(),
                LspPosition {
                    line: 1,
                    character: 5,
                },
                101,
            )
            .expect("references request should complete");
        assert!(references.as_array().is_some_and(|items| items.len() >= 2));

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut received_diagnostic = false;
        let mut missing_system_header = false;
        while Instant::now() < deadline {
            match event_receiver.recv_timeout(Duration::from_millis(200)) {
                Ok(LspEvent::Diagnostics { diagnostics, .. }) if !diagnostics.is_empty() => {
                    missing_system_header = diagnostics.iter().any(|diagnostic| {
                        diagnostic.code == "pp_file_not_found"
                            || diagnostic.message.contains("file not found")
                    });
                    received_diagnostic = true;
                    break;
                }
                Ok(_) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(received_diagnostic, "clangd should publish diagnostics");
        assert!(
            !missing_system_header,
            "clangd should load MinGW system headers through the configured compiler"
        );
        manager.stop().expect("clangd should stop");
        assert!(!manager.is_active());

        fs::remove_dir_all(root).expect("temporary workspace should be removable");
    }
}
