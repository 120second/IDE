use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use crate::error::{AppError, AppResult};
use crate::paths::is_within;
use crate::process_tree::ProcessTree;

use super::{CompileProfile, CompileRequest, CompileResult};

const DEFAULT_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct CompilerManager {
    active: Mutex<Option<(Option<String>, Arc<AtomicBool>)>>,
    pub(super) cache: Mutex<Option<super::cache::CachedBuild>>,
    pub(super) unstable_cache_key: Mutex<Option<String>>,
}

impl CompilerManager {
    pub fn reserve(self: &Arc<Self>) -> AppResult<Compilation> {
        self.reserve_for(None)
    }

    pub fn reserve_for(self: &Arc<Self>, task_id: Option<String>) -> AppResult<Compilation> {
        let stop = Arc::new(AtomicBool::new(false));
        {
            let mut active = self
                .active
                .lock()
                .map_err(|_| AppError::Internal("compiler lock poisoned".into()))?;
            if active.is_some() {
                return Err(AppError::Process("another compilation is running".into()));
            }
            *active = Some((task_id, stop.clone()));
        }
        Ok(Compilation {
            manager: self.clone(),
            stop,
        })
    }
    pub fn stop(&self) -> bool {
        self.stop_matching(None)
    }

    pub fn stop_matching(&self, task_id: Option<&str>) -> bool {
        let Ok(active) = self.active.lock() else {
            return false;
        };
        let Some((current_id, stop)) = active.as_ref() else {
            return false;
        };
        if task_id.is_some() && current_id.as_deref() != task_id {
            return false;
        }
        stop.store(true, Ordering::Release);
        true
    }
}

pub struct Compilation {
    manager: Arc<CompilerManager>,
    stop: Arc<AtomicBool>,
}

impl Compilation {
    pub fn compile(
        self,
        root: &Path,
        build: &Path,
        request: &CompileRequest,
    ) -> AppResult<CompileResult> {
        super::cache::compile(&self.manager, root, build, request, &self.stop)
    }
}

impl Drop for Compilation {
    fn drop(&mut self) {
        if let Ok(mut active) = self.manager.active.lock() {
            if active
                .as_ref()
                .is_some_and(|(_, current)| Arc::ptr_eq(current, &self.stop))
            {
                *active = None;
            }
        }
    }
}

pub fn compile_current_file(
    workspace_root: &Path,
    build_root: &Path,
    request: &CompileRequest,
) -> AppResult<CompileResult> {
    compile_with_stop(
        workspace_root,
        build_root,
        request,
        &AtomicBool::new(false),
        Duration::from_secs(120),
    )
}

pub fn compile_with_stop(
    workspace_root: &Path,
    build_root: &Path,
    request: &CompileRequest,
    stop: &AtomicBool,
    timeout: Duration,
) -> AppResult<CompileResult> {
    if stop.load(Ordering::Acquire) {
        return Err(AppError::ProcessCancelled);
    }
    let source = checked_source(workspace_root, &request.source_path)?;
    let profile_args = match request.profile {
        CompileProfile::Release => &request.config.release_args,
        CompileProfile::Debug => &request.config.debug_args,
    };
    validate_profile_args(profile_args)?;
    let source_before = fs::read(&source)?;
    let started = Instant::now();
    if request
        .expected_source
        .as_ref()
        .is_some_and(|text| !expected_source_matches(text, &source_before))
    {
        return Err(AppError::Configuration(
            "源码已更改，请保存当前版本后重新编译。".into(),
        ));
    }
    let task_id = uuid::Uuid::new_v4().to_string();
    let task_root = build_root.join("tasks").join(&task_id);
    fs::create_dir_all(&task_root)?;
    prune_build_cache(&task_root);
    let executable = output_path(&task_root, &source);
    let compiler_executable = compatible_compiler_output(&executable)?;
    let compiler = request.config.compiler_path.trim();
    let compiler = if compiler.is_empty() { "g++" } else { compiler };
    let standard = request.config.standard.trim();
    let standard = if standard.is_empty() {
        "c++20"
    } else {
        standard
    };
    let profile_args = match request.profile {
        CompileProfile::Release => &request.config.release_args,
        CompileProfile::Debug => &request.config.debug_args,
    };
    if profile_args
        .iter()
        .any(|arg| matches!(arg.trim(), "-c" | "-S" | "-E" | "-fsyntax-only"))
    {
        return Err(AppError::Configuration(
            "构建可执行程序不能使用 -c、-S、-E 或 -fsyntax-only；请从编译参数中移除。".into(),
        ));
    }
    let dependency_snapshot = super::dependencies::inspect(
        &source,
        request,
        stop,
        timeout.saturating_sub(started.elapsed()),
    )?;
    let actual_manifest = super::dependencies::Manifest::new()?;
    let json_diagnostics = super::toolchain::supports_json(
        compiler,
        source.parent().unwrap_or(workspace_root),
        stop,
        timeout.saturating_sub(started.elapsed()),
    )?;
    let gcc_text = !json_diagnostics
        && super::toolchain::supports_byte_columns(
            compiler,
            source.parent().unwrap_or(workspace_root),
            stop,
            timeout.saturating_sub(started.elapsed()),
        )?;

    let mut command = Command::new(compiler);
    command
        .arg(format!("-std={standard}"))
        .args(
            profile_args
                .iter()
                .filter(|argument| !argument.trim().is_empty()),
        )
        .arg("-fdiagnostics-color=never");
    if json_diagnostics {
        command.arg("-fdiagnostics-format=json");
    } else if gcc_text {
        command.args([
            "-fdiagnostics-format=text",
            "-fdiagnostics-column-unit=byte",
            "-fdiagnostics-column-origin=1",
        ]);
    }
    command
        .args(["-MD", "-MT", "lightcp", "-MF"])
        .arg(&actual_manifest.0);
    command
        .arg(&source)
        .arg("-o")
        .arg(&compiler_executable)
        .current_dir(source.parent().unwrap_or(workspace_root))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_hidden(&mut command);

    let command_line = std::iter::once(compiler.to_owned())
        .chain(
            command
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned()),
        )
        .collect();
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::CompilerNotFound(format!("{compiler}: {error}"))
        } else {
            AppError::ProcessStart(format!("failed to launch {compiler}: {error}"))
        }
    })?;
    let process_tree = ProcessTree::attach(&mut child)?;
    let Some(stdout) = child.stdout.take() else {
        terminate_child(&mut child);
        return Err(AppError::Internal(
            "compiler stdout pipe was unavailable".to_owned(),
        ));
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_child(&mut child);
        return Err(AppError::Internal(
            "compiler stderr pipe was unavailable".to_owned(),
        ));
    };
    let limit = request
        .config
        .max_output_bytes
        .clamp(64 * 1024, 16 * 1024 * 1024)
        .max(DEFAULT_OUTPUT_LIMIT.min(request.config.max_output_bytes));
    let used = Arc::new(AtomicUsize::new(0));
    let truncated = Arc::new(AtomicBool::new(false));
    let stdout_reader = spawn_limited_reader(stdout, limit, used.clone(), truncated.clone());
    let stderr_reader = spawn_limited_reader(stderr, limit, used, truncated.clone());
    let status = wait_for_compiler(
        &mut child,
        &process_tree,
        stop,
        timeout.saturating_sub(started.elapsed()),
    );
    drop(process_tree);
    let stdout = join_reader(stdout_reader)?;
    let stderr = join_reader(stderr_reader)?;
    let status = match status {
        Ok(status) => status,
        Err(error) => {
            let _ = fs::remove_file(&compiler_executable);
            return Err(error);
        }
    };
    let source_changed = fs::read(&source).map_or(true, |current| current != source_before)
        || dependency_snapshot.as_ref().is_some_and(|snapshot| {
            !snapshot.unchanged()
                || status.success()
                    && !snapshot.matches_manifest(
                        &actual_manifest.0,
                        source.parent().unwrap_or(workspace_root),
                    )
        });
    let mut success = status.success() && !source_changed;
    let mut diagnostics = if gcc_text {
        super::diagnostics::parse_with_gcc_text(&stderr, &source, status.success(), true)
    } else {
        super::diagnostics::parse(&stderr, &source, status.success())
    };
    if truncated.load(Ordering::Relaxed)
        && !diagnostics
            .iter()
            .any(|d| d.code == "diagnostics_incomplete")
    {
        let mut note = super::diagnostics::task_error(
            &source,
            "编译输出已截断，诊断可能不完整；已保留完整收到的错误。",
            "diagnostics_incomplete",
        );
        note.severity = 2;
        diagnostics.push(note);
    }
    if source_changed {
        diagnostics.push(super::diagnostics::task_error(
            &source,
            "编译期间源码或相关头文件已修改，本次结果已过期，请重新编译。",
            "source_changed",
        ));
    }
    if success
        && !dependency_snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.complete)
    {
        success = false;
        diagnostics.push(super::diagnostics::task_error(
            &source,
            "无法确认本次构建的依赖，请检查编译参数或过大的依赖文件。",
            "dependencies_unavailable",
        ));
    }
    if success && !valid_executable(&compiler_executable) {
        success = false;
        diagnostics.push(super::diagnostics::task_error(
            &source,
            "编译器没有生成有效的可执行文件，请检查编译参数。",
            "invalid_artifact",
        ));
    }
    if success && compiler_executable != executable {
        let copied = fs::copy(&compiler_executable, &executable);
        let _ = fs::remove_file(&compiler_executable);
        copied?;
    } else if compiler_executable != executable {
        let _ = fs::remove_file(&compiler_executable);
    }

    Ok(CompileResult {
        dependencies: dependency_snapshot
            .as_ref()
            .map_or_else(Vec::new, |snapshot| snapshot.describe()),
        dependencies_complete: dependency_snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.complete),
        diagnostics_incomplete: diagnostics
            .iter()
            .any(|d| d.code == "diagnostics_incomplete")
            || truncated.load(Ordering::Relaxed),
        cache_hit: false,
        command: command_line,
        working_directory: source
            .parent()
            .unwrap_or(workspace_root)
            .to_string_lossy()
            .into_owned(),
        task_id,
        diagnostics,
        source_changed,
        success,
        executable_path: success.then(|| path_text(&executable)),
        stdout,
        stderr,
        exit_code: status.code(),
        duration_ms: elapsed_millis(started),
        output_truncated: truncated.load(Ordering::Relaxed),
    })
}

fn validate_profile_args(args: &[String]) -> AppResult<()> {
    let mut operand = false;
    for argument in args
        .iter()
        .map(|arg| arg.trim())
        .filter(|arg| !arg.is_empty())
    {
        if argument.starts_with('@') || argument.contains(",@") {
            return Err(AppError::Configuration(
                "当前构建入口仅支持单个 .cpp，暂不支持响应文件参数（@file）；请直接配置编译选项。"
                    .into(),
            ));
        }
        if operand {
            operand = false;
            continue;
        }
        if matches!(
            argument,
            "-I" | "-isystem"
                | "-iquote"
                | "-idirafter"
                | "-include"
                | "-imacros"
                | "-include-pch"
                | "-isysroot"
                | "--sysroot"
                | "-D"
                | "-U"
                | "-L"
                | "-l"
                | "-B"
                | "-o"
                | "-x"
                | "-MT"
                | "-MQ"
                | "-MF"
                | "-Xclang"
                | "-Xpreprocessor"
                | "-Xassembler"
                | "-Xlinker"
                | "-iprefix"
                | "-iwithprefix"
                | "-iwithprefixbefore"
                | "-dumpbase"
                | "-dumpdir"
        ) {
            operand = true;
            continue;
        }
        if !argument.starts_with('-') {
            let extension = Path::new(argument)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "o" | "obj" | "a" | "lib" | "dll" | "so") {
                return Err(AppError::Configuration(format!(
                    "当前构建入口仅支持单个 .cpp，不能通过编译参数加入额外源码：{argument}"
                )));
            }
        }
        if argument == "--" {
            return Err(AppError::Configuration(
                "请移除编译参数中的 --；源码和输出路径由应用管理。".into(),
            ));
        }
    }
    Ok(())
}

pub(super) fn wait_for_compiler(
    child: &mut std::process::Child,
    tree: &ProcessTree,
    stop: &AtomicBool,
    timeout: Duration,
) -> AppResult<std::process::ExitStatus> {
    let started = Instant::now();
    loop {
        if stop.load(Ordering::Acquire) {
            tree.terminate(child);
            return Err(AppError::ProcessCancelled);
        }
        if started.elapsed() >= timeout {
            tree.terminate(child);
            return Err(AppError::ProcessTimedOut);
        }
        match child.try_wait() {
            Ok(Some(exit)) => return Ok(exit),
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                tree.terminate(child);
                return Err(error.into());
            }
        }
    }
}

pub(super) fn checked_source(root: &Path, source_path: &str) -> AppResult<PathBuf> {
    let root = dunce::canonicalize(root)?;
    let source = dunce::canonicalize(source_path)?;
    if !is_within(&root, &source) || !source.is_file() {
        return Err(AppError::FileSystemOperation(format!(
            "source file is outside the active workspace: {}",
            source.display()
        )));
    }
    Ok(source)
}

pub(super) fn expected_source_matches(expected: &str, actual: &[u8]) -> bool {
    if expected.as_bytes() == actual {
        return true;
    }
    let Ok(actual) = std::str::from_utf8(actual) else {
        return false;
    };
    normalize_line_endings(expected) == normalize_line_endings(actual)
}

pub(super) fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn output_path(build_root: &Path, source: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().to_lowercase().hash(&mut hasher);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("solution")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    build_root.join(format!("{stem}-{:016x}.exe", hasher.finish()))
}

fn prune_build_cache(current: &Path) {
    let Some(parent) = current.parent() else {
        return;
    };
    let Ok(root) = dunce::canonicalize(parent) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    let mut jobs = entries
        .flatten()
        .filter_map(|entry| {
            let kind = entry.file_type().ok()?;
            if !kind.is_dir()
                || kind.is_symlink()
                || uuid::Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err()
            {
                return None;
            }
            let path = dunce::canonicalize(entry.path()).ok()?;
            if path.parent() != Some(root.as_path()) {
                return None;
            }
            Some((entry.metadata().ok()?.modified().ok()?, path))
        })
        .collect::<Vec<_>>();
    jobs.sort_by_key(|job| std::cmp::Reverse(job.0));
    let current = dunce::canonicalize(current).ok();
    for (_, job) in jobs.into_iter().skip(32) {
        if current.as_ref() != Some(&job) {
            // Windows keeps running executables locked; retain those jobs.
            let _ = fs::remove_dir_all(&job);
        }
    }
}

#[cfg(windows)]
pub(super) fn compatible_compiler_output(desired: &Path) -> AppResult<PathBuf> {
    if desired.as_os_str().to_string_lossy().is_ascii() {
        return Ok(desired.to_owned());
    }
    let mut roots = vec![std::env::temp_dir()];
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        roots.push(PathBuf::from(system_root).join("Temp"));
    }
    for root in roots {
        if !root.as_os_str().to_string_lossy().is_ascii() {
            continue;
        }
        let staging = root.join(format!("lightcp-compiler-output-{}", std::process::id()));
        if fs::create_dir_all(&staging).is_ok() {
            return Ok(staging.join(format!("{}.exe", uuid::Uuid::new_v4())));
        }
    }
    Ok(desired.to_owned())
}

pub(super) fn valid_executable(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut bytes = [0u8; 64];
    if file.read_exact(&mut bytes).is_err() {
        return false;
    }
    #[cfg(windows)]
    {
        if !bytes.starts_with(b"MZ") {
            return false;
        }
        let offset = u32::from_le_bytes(bytes[60..64].try_into().unwrap()) as usize;
        let mut header = [0u8; 24];
        if file.seek(SeekFrom::Start(offset as u64)).is_err()
            || file.read_exact(&mut header).is_err()
        {
            return false;
        }
        let flags = u16::from_le_bytes([header[22], header[23]]);
        header.starts_with(b"PE\0\0") && flags & 2 != 0 && flags & 0x2000 == 0
    }
    #[cfg(not(windows))]
    {
        bytes.starts_with(b"\x7fELF")
            || bytes.starts_with(&[0xcf, 0xfa, 0xed, 0xfe])
            || bytes.starts_with(&[0xce, 0xfa, 0xed, 0xfe])
    }
}

#[cfg(not(windows))]
pub(super) fn compatible_compiler_output(desired: &Path) -> AppResult<PathBuf> {
    Ok(desired.to_owned())
}

pub(super) fn spawn_limited_reader<R: Read + Send + 'static>(
    mut reader: R,
    limit: usize,
    used: Arc<AtomicUsize>,
    truncated: Arc<AtomicBool>,
) -> thread::JoinHandle<std::io::Result<String>> {
    thread::spawn(move || {
        let mut captured = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            let allowed = reserve_bytes(&used, limit, count);
            captured.extend_from_slice(&buffer[..allowed]);
            if allowed < count {
                truncated.store(true, Ordering::Relaxed);
            }
        }
        Ok(String::from_utf8_lossy(&captured).into_owned())
    })
}

fn reserve_bytes(used: &AtomicUsize, limit: usize, requested: usize) -> usize {
    loop {
        let current = used.load(Ordering::Relaxed);
        let allowed = requested.min(limit.saturating_sub(current));
        if used
            .compare_exchange_weak(
                current,
                current + allowed,
                Ordering::Relaxed,
                Ordering::Relaxed,
            )
            .is_ok()
        {
            return allowed;
        }
    }
}

pub(super) fn join_reader(
    handle: thread::JoinHandle<std::io::Result<String>>,
) -> AppResult<String> {
    handle
        .join()
        .map_err(|_| AppError::Internal("compiler output reader panicked".to_owned()))?
        .map_err(AppError::from)
}

fn terminate_child(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn elapsed_millis(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(windows)]
pub(super) fn configure_hidden(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(super) fn configure_hidden(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    #[test]
    fn stale_stop_does_not_cancel_a_new_compilation() {
        let manager = Arc::new(CompilerManager::default());
        let first = manager.reserve_for(Some("first".into())).unwrap();
        assert!(!manager.stop_matching(Some("previous")));
        assert!(!first.stop.load(Ordering::Acquire));
        drop(first);
        let second = manager.reserve_for(Some("second".into())).unwrap();
        assert!(!manager.stop_matching(Some("first")));
        assert!(!second.stop.load(Ordering::Acquire));
        assert!(manager.stop_matching(Some("second")));
        assert!(second.stop.load(Ordering::Acquire));
    }
    #[test]
    fn compilation_is_cancellable_before_the_worker_starts() {
        let manager = Arc::new(CompilerManager::default());
        let compilation = manager.reserve().unwrap();
        assert!(manager.reserve().is_err());
        assert!(manager.stop());
        let request = request(Path::new("missing.cpp"));
        assert!(matches!(
            compilation.compile(Path::new("."), Path::new("."), &request),
            Err(AppError::ProcessCancelled)
        ));
        assert!(!manager.stop());
        assert!(manager.reserve().is_ok());
    }
    #[cfg(windows)]
    #[test]
    fn compiler_wait_can_be_cancelled_and_timed_out() {
        use super::*;
        for cancelled in [false, true] {
            let mut command = Command::new("powershell");
            command
                .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"])
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            configure_hidden(&mut command);
            let mut child = command.spawn().unwrap();
            let tree = ProcessTree::attach(&mut child).unwrap();
            let started = Instant::now();
            let result = wait_for_compiler(
                &mut child,
                &tree,
                &AtomicBool::new(cancelled),
                Duration::from_millis(100),
            );
            assert!(matches!(
                (&result, cancelled),
                (Err(AppError::ProcessCancelled), true) | (Err(AppError::ProcessTimedOut), false)
            ));
            assert!(child.try_wait().unwrap().is_some());
            assert!(started.elapsed() < Duration::from_secs(3));
        }
    }
    use std::time::UNIX_EPOCH;

    use super::*;
    use crate::compiler::{CompileProfile, CompilerConfig};

    #[test]
    fn compiler_handles_chinese_paths_and_reports_compile_errors() {
        let _process_guard = crate::PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if Command::new("g++").arg("--version").output().is_err() {
            eprintln!("skipping compiler integration test because g++ is unavailable");
            return;
        }
        let root = temporary_root("中文 compiler");
        let build = root.join("build");
        let source = root.join("求和 程序.cpp");
        fs::write(
            &source,
            "#include <iostream>\nint main(){std::cout << 42 << '\\n';}\n",
        )
        .unwrap();
        let request = request(&source);
        let compiled = compile_current_file(&root, &build, &request).unwrap();
        assert!(
            compiled.success,
            "compiler stderr for Chinese-path integration test: {}",
            compiled.stderr
        );
        assert_eq!(compiled.exit_code, Some(0));
        assert!(compiled.executable_path.is_some());

        fs::write(
            &source,
            "#include <iostream>\nint main(){std::cout << 7 << '\\n';}\n",
        )
        .unwrap();
        let next = compile_current_file(&root, &build, &request).unwrap();
        assert!(next.success, "{}", next.stderr);
        assert_ne!(
            compiled.executable_path, next.executable_path,
            "build jobs must never overwrite one another"
        );
        assert!(Path::new(compiled.executable_path.as_ref().unwrap()).is_file());
        assert_eq!(
            String::from_utf8_lossy(
                &Command::new(next.executable_path.as_ref().unwrap())
                    .output()
                    .unwrap()
                    .stdout
            )
            .trim(),
            "7"
        );
        for flag in ["-fsyntax-only", "-c", "-E", "-S"] {
            let mut invalid = request.clone();
            invalid.config.release_args = vec![flag.into()];
            assert!(matches!(
                compile_current_file(&root, &build, &invalid),
                Err(AppError::Configuration(_))
            ));
        }
        let mut stale = request.clone();
        stale.expected_source = Some("a different source snapshot".into());
        assert!(matches!(
            compile_current_file(&root, &build, &stale),
            Err(AppError::Configuration(_))
        ));

        fs::write(&source, "int main( {\n").unwrap();
        let failed = compile_current_file(&root, &build, &request).unwrap();
        assert!(!failed.success);
        assert_ne!(failed.exit_code, Some(0));
        assert!(!failed.stderr.is_empty());
        assert!(
            failed
                .diagnostics
                .iter()
                .any(|d| d.severity == 1 && !d.file_level),
            "stderr: {}; parsed: {:?}",
            failed.stderr,
            failed.diagnostics
        );
        assert!(failed.executable_path.is_none());
        fs::write(
            &source,
            "void add_subtree(int,int); int main(){ add_subtree(1,1); }\n",
        )
        .unwrap();
        let linked = compile_current_file(&root, &build, &request).unwrap();
        assert!(!linked.success);
        assert!(linked
            .diagnostics
            .iter()
            .any(|d| d.file_level && d.message.contains("add_subtree")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_non_executable_artifact() {
        let root = temporary_root("invalid-artifact");
        let artifact = root.join("object.exe");
        fs::write(&artifact, b"this is not an executable").unwrap();
        assert!(!valid_executable(&artifact));
        fs::remove_dir_all(root).unwrap();
    }

    fn request(source: &Path) -> CompileRequest {
        CompileRequest {
            reuse_artifact: false,
            client_task_id: None,
            expected_source: None,
            source_path: path_text(source),
            profile: CompileProfile::Release,
            config: CompilerConfig {
                compiler_path: "g++".to_owned(),
                standard: "c++20".to_owned(),
                release_args: vec!["-O2".to_owned()],
                debug_args: vec!["-g".to_owned(), "-O0".to_owned()],
                max_output_bytes: DEFAULT_OUTPUT_LIMIT,
            },
        }
    }

    fn temporary_root(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("lightcp-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
