use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::Instant,
};

use crate::error::{AppError, AppResult};

use super::{CompileProfile, CompileRequest, CompileResult};

const DEFAULT_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;

pub fn compile_current_file(
    workspace_root: &Path,
    build_root: &Path,
    request: &CompileRequest,
) -> AppResult<CompileResult> {
    let source = checked_source(workspace_root, &request.source_path)?;
    fs::create_dir_all(build_root)?;
    let executable = output_path(build_root, &source);
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
        .arg(&executable)
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
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("compiler stdout pipe was unavailable".to_owned()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("compiler stderr pipe was unavailable".to_owned()))?;
    let limit = request
        .config
        .max_output_bytes
        .clamp(64 * 1024, 16 * 1024 * 1024)
        .max(DEFAULT_OUTPUT_LIMIT.min(request.config.max_output_bytes));
    let used = Arc::new(AtomicUsize::new(0));
    let truncated = Arc::new(AtomicBool::new(false));
    let stdout_reader = spawn_limited_reader(stdout, limit, used.clone(), truncated.clone());
    let stderr_reader = spawn_limited_reader(stderr, limit, used, truncated.clone());
    let status = child.wait()?;
    let stdout = join_reader(stdout_reader)?;
    let stderr = join_reader(stderr_reader)?;
    let success = status.success();

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

fn checked_source(root: &Path, source_path: &str) -> AppResult<PathBuf> {
    let root = dunce::canonicalize(root)?;
    let source = dunce::canonicalize(source_path)?;
    if !source.starts_with(&root) || !source.is_file() {
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
        assert!(compiled.success);
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
