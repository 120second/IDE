use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Read,
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
    active: Mutex<Option<Arc<AtomicBool>>>,
}

impl CompilerManager {
    pub fn reserve(self: &Arc<Self>) -> AppResult<Compilation> {
        let stop = Arc::new(AtomicBool::new(false));
        {
            let mut active = self
                .active
                .lock()
                .map_err(|_| AppError::Internal("compiler lock poisoned".into()))?;
            if active.is_some() {
                return Err(AppError::Process("another compilation is running".into()));
            }
            *active = Some(stop.clone());
        }
        Ok(Compilation {
            manager: self.clone(),
            stop,
        })
    }
    pub fn stop(&self) -> bool {
        let Ok(active) = self.active.lock() else {
            return false;
        };
        let Some(stop) = active.as_ref() else {
            return false;
        };
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
        compile_with_stop(root, build, request, &self.stop, Duration::from_secs(120))
    }
}

impl Drop for Compilation {
    fn drop(&mut self) {
        if let Ok(mut active) = self.manager.active.lock() {
            if active
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &self.stop))
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
    fs::create_dir_all(build_root)?;
    let executable = output_path(build_root, &source);
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

    let mut command = Command::new(compiler);
    command
        .arg(format!("-std={standard}"))
        .args(
            profile_args
                .iter()
                .filter(|argument| !argument.trim().is_empty()),
        )
        .arg(&source)
        .arg("-o")
        .arg(&compiler_executable)
        .current_dir(source.parent().unwrap_or(workspace_root))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_hidden(&mut command);

    let started = Instant::now();
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
    let status = wait_for_compiler(&mut child, &process_tree, stop, timeout);
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
    let success = status.success();
    if success && compiler_executable != executable {
        let copied = fs::copy(&compiler_executable, &executable);
        let _ = fs::remove_file(&compiler_executable);
        copied?;
    } else if compiler_executable != executable {
        let _ = fs::remove_file(&compiler_executable);
    }

    Ok(CompileResult {
        success,
        executable_path: success.then(|| path_text(&executable)),
        stdout,
        stderr,
        exit_code: status.code(),
        duration_ms: elapsed_millis(started),
        output_truncated: truncated.load(Ordering::Relaxed),
    })
}

fn wait_for_compiler(
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

fn checked_source(root: &Path, source_path: &str) -> AppResult<PathBuf> {
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

#[cfg(windows)]
fn compatible_compiler_output(desired: &Path) -> AppResult<PathBuf> {
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
            return Ok(staging.join(
                desired
                    .file_name()
                    .unwrap_or_else(|| std::ffi::OsStr::new("solution.exe")),
            ));
        }
    }
    Ok(desired.to_owned())
}

#[cfg(not(windows))]
fn compatible_compiler_output(desired: &Path) -> AppResult<PathBuf> {
    Ok(desired.to_owned())
}

fn spawn_limited_reader<R: Read + Send + 'static>(
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

fn join_reader(handle: thread::JoinHandle<std::io::Result<String>>) -> AppResult<String> {
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
fn configure_hidden(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_hidden(_command: &mut Command) {}

#[cfg(test)]
mod tests {
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

        fs::write(&source, "int main( {\n").unwrap();
        let failed = compile_current_file(&root, &build, &request).unwrap();
        assert!(!failed.success);
        assert_ne!(failed.exit_code, Some(0));
        assert!(!failed.stderr.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    fn request(source: &Path) -> CompileRequest {
        CompileRequest {
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
