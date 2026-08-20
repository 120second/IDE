use std::{
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use crate::error::{AppError, AppResult};

use super::{RunRequest, RunResult, RunStatus, RunnerOutputBatch};

const OUTPUT_BATCH_INTERVAL: Duration = Duration::from_millis(24);
const POLL_INTERVAL: Duration = Duration::from_millis(4);

#[derive(Default)]
pub struct RunnerManager {
    active: Mutex<Option<ActiveRun>>,
}

struct ActiveRun {
    client_run_id: String,
    stop_requested: Arc<AtomicBool>,
}

#[derive(Clone, Copy)]
enum OutputStream {
    Stdout,
    Stderr,
}

struct RawChunk {
    stream: OutputStream,
    bytes: Vec<u8>,
}

impl RunnerManager {
    pub fn run<F>(&self, request: &RunRequest, mut emit: F) -> AppResult<RunResult>
    where
        F: FnMut(RunnerOutputBatch),
    {
        self.run_with_stop(request, Arc::new(AtomicBool::new(false)), &mut emit)
    }

    pub fn run_with_stop<F>(
        &self,
        request: &RunRequest,
        external_stop: Arc<AtomicBool>,
        mut emit: F,
    ) -> AppResult<RunResult>
    where
        F: FnMut(RunnerOutputBatch),
    {
        let executable = dunce::canonicalize(&request.executable_path).map_err(|error| {
            AppError::ProcessStart(format!(
                "executable is unavailable ({}): {error}",
                request.executable_path
            ))
        })?;
        if !executable.is_file() {
            return Err(AppError::ProcessStart(format!(
                "executable is not a file: {}",
                executable.display()
            )));
        }
        let working_directory = dunce::canonicalize(&request.working_directory)?;
        if !working_directory.is_dir() {
            return Err(AppError::FileSystemOperation(format!(
                "runner working directory is unavailable: {}",
                working_directory.display()
            )));
        }

        let stop_requested = Arc::new(AtomicBool::new(false));
        self.begin(&request.client_run_id, stop_requested.clone())?;
        let result = self.run_active(
            request,
            &executable,
            &working_directory,
            stop_requested,
            external_stop,
            &mut emit,
        );
        self.finish(&request.client_run_id);
        result
    }

    pub fn stop(&self) -> bool {
        let Ok(active) = self.active.lock() else {
            return false;
        };
        let Some(active) = active.as_ref() else {
            return false;
        };
        active.stop_requested.store(true, Ordering::Release);
        true
    }

    pub fn active_run_id(&self) -> Option<String> {
        self.active
            .lock()
            .ok()
            .and_then(|active| active.as_ref().map(|run| run.client_run_id.clone()))
    }

    fn begin(&self, client_run_id: &str, stop_requested: Arc<AtomicBool>) -> AppResult<()> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| AppError::Internal("runner state lock was poisoned".to_owned()))?;
        if active.is_some() {
            return Err(AppError::ProcessStart(
                "another program is already running".to_owned(),
            ));
        }
        *active = Some(ActiveRun {
            client_run_id: client_run_id.to_owned(),
            stop_requested,
        });
        Ok(())
    }

    fn finish(&self, client_run_id: &str) {
        let Ok(mut active) = self.active.lock() else {
            return;
        };
        if active
            .as_ref()
            .is_some_and(|run| run.client_run_id == client_run_id)
        {
            *active = None;
        }
    }

    fn run_active<F>(
        &self,
        request: &RunRequest,
        executable: &Path,
        working_directory: &Path,
        stop_requested: Arc<AtomicBool>,
        external_stop: Arc<AtomicBool>,
        emit: &mut F,
    ) -> AppResult<RunResult>
    where
        F: FnMut(RunnerOutputBatch),
    {
        let mut command = Command::new(executable);
        command
            .args(request.arguments.iter().take(32))
            .current_dir(working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_hidden(&mut command);
        let mut child = command.spawn().map_err(|error| {
            AppError::ProcessStart(format!(
                "failed to launch {}: {error}",
                executable.display()
            ))
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Internal("runner stdin pipe was unavailable".to_owned()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Internal("runner stdout pipe was unavailable".to_owned()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Internal("runner stderr pipe was unavailable".to_owned()))?;
        let input = request.stdin.as_bytes().to_vec();
        let input_writer = thread::spawn(move || -> std::io::Result<()> {
            let mut stdin = stdin;
            stdin.write_all(&input)?;
            stdin.flush()
        });
        let (sender, receiver) = mpsc::channel();
        let stdout_reader = spawn_reader(stdout, OutputStream::Stdout, sender.clone());
        let stderr_reader = spawn_reader(stderr, OutputStream::Stderr, sender);

        let started = Instant::now();
        let timeout = Duration::from_millis(request.timeout_ms.clamp(100, 60_000));
        let output_limit = request.max_output_bytes.clamp(64 * 1024, 16 * 1024 * 1024);
        let mut stdout_bytes = Vec::new();
        let mut stderr_bytes = Vec::new();
        let mut pending_stdout = Vec::new();
        let mut pending_stderr = Vec::new();
        let mut output_truncated = false;
        let mut last_emit = Instant::now();

        let (status, exit_code) = loop {
            drain_chunks(
                &receiver,
                output_limit,
                &mut stdout_bytes,
                &mut stderr_bytes,
                &mut pending_stdout,
                &mut pending_stderr,
                &mut output_truncated,
            );
            if last_emit.elapsed() >= OUTPUT_BATCH_INTERVAL {
                emit_pending(
                    request,
                    emit,
                    &mut pending_stdout,
                    &mut pending_stderr,
                    output_truncated,
                );
                last_emit = Instant::now();
            }

            if stop_requested.load(Ordering::Acquire) || external_stop.load(Ordering::Acquire) {
                let _ = child.kill();
                let exit = child.wait()?;
                break (RunStatus::Stopped, exit.code());
            }
            if started.elapsed() >= timeout {
                let _ = child.kill();
                let exit = child.wait()?;
                break (RunStatus::TimedOut, exit.code());
            }
            if let Some(exit) = child.try_wait()? {
                break (RunStatus::Exited, exit.code());
            }
            thread::sleep(POLL_INTERVAL);
        };

        let _ = input_writer.join();
        join_reader(stdout_reader)?;
        join_reader(stderr_reader)?;
        drain_chunks(
            &receiver,
            output_limit,
            &mut stdout_bytes,
            &mut stderr_bytes,
            &mut pending_stdout,
            &mut pending_stderr,
            &mut output_truncated,
        );
        emit_pending(
            request,
            emit,
            &mut pending_stdout,
            &mut pending_stderr,
            output_truncated,
        );

        Ok(RunResult {
            client_run_id: request.client_run_id.clone(),
            status,
            stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
            stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
            exit_code,
            duration_ms: elapsed_millis(started),
            output_truncated,
        })
    }
}

fn spawn_reader<R: Read + Send + 'static>(
    mut reader: R,
    stream: OutputStream,
    sender: mpsc::Sender<RawChunk>,
) -> thread::JoinHandle<std::io::Result<()>> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                return Ok(());
            }
            if sender
                .send(RawChunk {
                    stream,
                    bytes: buffer[..count].to_vec(),
                })
                .is_err()
            {
                return Ok(());
            }
        }
    })
}

#[allow(clippy::too_many_arguments)]
fn drain_chunks(
    receiver: &mpsc::Receiver<RawChunk>,
    limit: usize,
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    pending_stdout: &mut Vec<u8>,
    pending_stderr: &mut Vec<u8>,
    truncated: &mut bool,
) {
    while let Ok(chunk) = receiver.try_recv() {
        let used = stdout.len() + stderr.len();
        let allowed = chunk.bytes.len().min(limit.saturating_sub(used));
        let bytes = &chunk.bytes[..allowed];
        match chunk.stream {
            OutputStream::Stdout => {
                stdout.extend_from_slice(bytes);
                pending_stdout.extend_from_slice(bytes);
            }
            OutputStream::Stderr => {
                stderr.extend_from_slice(bytes);
                pending_stderr.extend_from_slice(bytes);
            }
        }
        *truncated |= allowed < chunk.bytes.len();
    }
}

fn emit_pending<F>(
    request: &RunRequest,
    emit: &mut F,
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    output_truncated: bool,
) where
    F: FnMut(RunnerOutputBatch),
{
    if stdout.is_empty() && stderr.is_empty() {
        return;
    }
    emit(RunnerOutputBatch {
        client_run_id: request.client_run_id.clone(),
        stdout: String::from_utf8_lossy(stdout).into_owned(),
        stderr: String::from_utf8_lossy(stderr).into_owned(),
        output_truncated,
    });
    stdout.clear();
    stderr.clear();
}

fn join_reader(handle: thread::JoinHandle<std::io::Result<()>>) -> AppResult<()> {
    handle
        .join()
        .map_err(|_| AppError::Internal("runner output reader panicked".to_owned()))?
        .map_err(AppError::from)
}

fn elapsed_millis(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
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
    use std::{fs, path::PathBuf, process::Command, time::UNIX_EPOCH};

    use crate::compiler::{compile_current_file, CompileProfile, CompileRequest, CompilerConfig};

    use super::*;

    #[test]
    fn output_capacity_keeps_streams_bounded() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(RawChunk {
                stream: OutputStream::Stdout,
                bytes: vec![b'a'; 80],
            })
            .unwrap();
        sender
            .send(RawChunk {
                stream: OutputStream::Stderr,
                bytes: vec![b'b'; 80],
            })
            .unwrap();
        let (mut stdout, mut stderr, mut pending_stdout, mut pending_stderr) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let mut truncated = false;
        drain_chunks(
            &receiver,
            100,
            &mut stdout,
            &mut stderr,
            &mut pending_stdout,
            &mut pending_stderr,
            &mut truncated,
        );
        assert_eq!(stdout.len() + stderr.len(), 100);
        assert!(truncated);
    }

    #[test]
    fn stop_is_reported_only_for_an_active_run() {
        let manager = RunnerManager::default();
        assert!(!manager.stop());
        let flag = Arc::new(AtomicBool::new(false));
        manager.begin("run-1", flag.clone()).unwrap();
        assert_eq!(manager.active_run_id().as_deref(), Some("run-1"));
        assert!(manager.stop());
        assert!(flag.load(Ordering::Acquire));
        manager.finish("run-1");
        assert!(!manager.stop());
    }

    #[test]
    fn runner_supports_stdin_re_tle_stop_and_large_output() {
        let _process_guard = crate::PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if Command::new("g++").arg("--version").output().is_err() {
            eprintln!("skipping runner integration test because g++ is unavailable");
            return;
        }
        let root = temporary_root("integration");
        let source = root.join("runner cases.cpp");
        fs::write(
            &source,
            r#"#include <iostream>
#include <string>
int main() {
    std::string mode;
    std::cin >> mode;
    if (mode == "re") return 7;
    if (mode == "loop") while (true) {}
    if (mode == "large") { for (int i = 0; i < 200000; ++i) std::cout << 'x'; return 0; }
    std::cout << "echo:" << mode << '\n';
    std::cerr << "diagnostic\n";
}
"#,
        )
        .unwrap();
        let build = root.join("build");
        let compile = compile_current_file(
            &root,
            &build,
            &CompileRequest {
                source_path: source.to_string_lossy().into_owned(),
                profile: CompileProfile::Release,
                config: CompilerConfig {
                    compiler_path: "g++".to_owned(),
                    standard: "c++20".to_owned(),
                    release_args: vec!["-O2".to_owned()],
                    debug_args: vec!["-g".to_owned(), "-O0".to_owned()],
                    max_output_bytes: 2 * 1024 * 1024,
                },
            },
        )
        .unwrap();
        assert!(compile.success, "{}", compile.stderr);
        let executable = compile.executable_path.unwrap();
        let manager = RunnerManager::default();

        let normal = manager
            .run(&request(&root, &executable, "hello\n", 1_000), |_| {})
            .unwrap();
        assert_eq!(normal.status, RunStatus::Exited);
        assert_eq!(normal.exit_code, Some(0));
        assert_eq!(normal.stdout.replace("\r\n", "\n"), "echo:hello\n");
        assert_eq!(normal.stderr.replace("\r\n", "\n"), "diagnostic\n");

        let runtime_error = manager
            .run(&request(&root, &executable, "re\n", 1_000), |_| {})
            .unwrap();
        assert_eq!(runtime_error.status, RunStatus::Exited);
        assert_eq!(runtime_error.exit_code, Some(7));

        let timed_out = manager
            .run(&request(&root, &executable, "loop\n", 120), |_| {})
            .unwrap();
        assert_eq!(timed_out.status, RunStatus::TimedOut);

        let large = manager
            .run(&request(&root, &executable, "large\n", 1_000), |_| {})
            .unwrap();
        assert!(large.output_truncated);
        assert_eq!(large.stdout.len(), 64 * 1024);

        let externally_stopped = RunnerManager::default()
            .run_with_stop(
                &request(&root, &executable, "loop\n", 5_000),
                Arc::new(AtomicBool::new(true)),
                |_| {},
            )
            .unwrap();
        assert_eq!(externally_stopped.status, RunStatus::Stopped);

        let manager = Arc::new(RunnerManager::default());
        let worker_manager = manager.clone();
        let stop_request = request(&root, &executable, "loop\n", 5_000);
        let worker = thread::spawn(move || worker_manager.run(&stop_request, |_| {}).unwrap());
        let deadline = Instant::now() + Duration::from_secs(1);
        while manager.active_run_id().is_none() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(2));
        }
        assert!(manager.stop());
        assert_eq!(worker.join().unwrap().status, RunStatus::Stopped);
        fs::remove_dir_all(root).unwrap();
    }

    fn request(root: &Path, executable: &str, stdin: &str, timeout_ms: u64) -> RunRequest {
        RunRequest {
            client_run_id: format!("test-{stdin}-{timeout_ms}"),
            executable_path: executable.to_owned(),
            arguments: Vec::new(),
            working_directory: root.to_string_lossy().into_owned(),
            stdin: stdin.to_owned(),
            timeout_ms,
            max_output_bytes: 64 * 1024,
        }
    }

    fn temporary_root(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lightcp-runner-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
