use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Instant,
};

use crate::{
    compiler::{compile_with_stop, CompileProfile, CompileRequest},
    error::{AppError, AppResult},
    generator::{generate_visual, next_seed, VisualGenerateRequest},
    runner::{RunRequest, RunResult, RunStatus, RunnerManager},
    testcase::compare_output,
};

use super::{
    StressCasePassed, StressEvent, StressFailure, StressRunRequest, StressStats, StressStatus,
    StressSummary,
};

const MAX_ITERATIONS: u64 = 10_000_000;

#[derive(Default)]
pub struct StressManager {
    active: Mutex<Option<Arc<ActiveStress>>>,
}

struct ActiveStress {
    session_id: String,
    stop_requested: Arc<AtomicBool>,
    solution_runner: Arc<RunnerManager>,
    brute_runner: Arc<RunnerManager>,
}

impl StressManager {
    pub fn run<F>(
        &self,
        workspace_root: &Path,
        build_root: &Path,
        request: &StressRunRequest,
        mut emit: F,
    ) -> AppResult<StressSummary>
    where
        F: FnMut(StressEvent),
    {
        validate_request(request)?;
        let session = Arc::new(ActiveStress {
            session_id: request.session_id.trim().chars().take(128).collect(),
            stop_requested: Arc::new(AtomicBool::new(false)),
            solution_runner: Arc::new(RunnerManager::default()),
            brute_runner: Arc::new(RunnerManager::default()),
        });
        self.begin(session.clone())?;
        let result = self.run_session(
            workspace_root,
            build_root,
            request,
            &session,
            None,
            &mut emit,
        );
        self.finish(&session.session_id);
        result
    }

    pub fn reserve(self: &Arc<Self>, session_id: &str) -> AppResult<StressJob> {
        let session = Arc::new(ActiveStress {
            session_id: session_id.to_owned(),
            stop_requested: Arc::new(AtomicBool::new(false)),
            solution_runner: Arc::new(RunnerManager::default()),
            brute_runner: Arc::new(RunnerManager::default()),
        });
        self.begin(session.clone())?;
        Ok(StressJob {
            manager: self.clone(),
            session,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn run_session<F>(
        &self,
        workspace_root: &Path,
        build_root: &Path,
        request: &StressRunRequest,
        session: &Arc<ActiveStress>,
        input: Option<&str>,
        emit: &mut F,
    ) -> AppResult<StressSummary>
    where
        F: FnMut(StressEvent),
    {
        validate_request(request)?;
        if session.stop_requested.load(Ordering::Acquire) {
            return Ok(stopped_summary(request, "对拍已停止"));
        }
        let result =
            match self.run_active(workspace_root, build_root, request, session, input, emit) {
                Err(AppError::ProcessCancelled) => Ok(stopped_summary(request, "编译已停止")),
                result => result,
            };
        if let Err(error) = &result {
            emit_state(
                emit,
                &session.session_id,
                StressStatus::Error,
                &error.to_string(),
            );
        }
        result
    }

    pub fn stop(&self) -> bool {
        let Ok(active) = self.active.lock() else {
            return false;
        };
        let Some(session) = active.as_ref() else {
            return false;
        };
        session.stop_requested.store(true, Ordering::Release);
        session.solution_runner.stop();
        session.brute_runner.stop();
        true
    }

    pub fn active_session_id(&self) -> Option<String> {
        self.active
            .lock()
            .ok()
            .and_then(|active| active.as_ref().map(|session| session.session_id.clone()))
    }

    fn begin(&self, session: Arc<ActiveStress>) -> AppResult<()> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| stress_error("stress manager lock was poisoned"))?;
        if active.is_some() {
            return Err(stress_error("another stress test is already running"));
        }
        *active = Some(session);
        Ok(())
    }

    fn finish(&self, session_id: &str) {
        let Ok(mut active) = self.active.lock() else {
            return;
        };
        if active
            .as_ref()
            .is_some_and(|session| session.session_id == session_id)
        {
            *active = None;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run_active<F>(
        &self,
        workspace_root: &Path,
        build_root: &Path,
        request: &StressRunRequest,
        session: &Arc<ActiveStress>,
        fixed_input: Option<&str>,
        emit: &mut F,
    ) -> AppResult<StressSummary>
    where
        F: FnMut(StressEvent),
    {
        // Snapshot reads and compilation must use the same resolved root, including
        // Windows TEMP short-name aliases and workspace paths containing `..`.
        let canonical_root = dunce::canonicalize(workspace_root)?;
        let workspace_root = canonical_root.as_path();
        emit_state(
            emit,
            &session.session_id,
            StressStatus::Compiling,
            "正在编译待测程序和暴力程序…",
        );
        let (replay_context, source_revisions) = super::replay::capture(workspace_root, request)?;
        let solution_compile = compile_with_stop(
            workspace_root,
            build_root,
            &CompileRequest {
                source_path: request.solution_path.clone(),
                profile: CompileProfile::Release,
                config: request.compiler_config.clone(),
            },
            &session.stop_requested,
            std::time::Duration::from_secs(120),
        )?;
        if !solution_compile.success {
            return Err(stress_error(format!(
                "待测程序编译失败：{}{}",
                solution_compile.stdout, solution_compile.stderr
            )));
        }
        if session.stop_requested.load(Ordering::Acquire) {
            return Ok(stopped_summary(request, "编译后已停止"));
        }
        let brute_compile = compile_with_stop(
            workspace_root,
            build_root,
            &CompileRequest {
                source_path: request.brute_path.clone(),
                profile: CompileProfile::Release,
                config: request.compiler_config.clone(),
            },
            &session.stop_requested,
            std::time::Duration::from_secs(120),
        )?;
        if !brute_compile.success {
            return Err(stress_error(format!(
                "暴力程序编译失败：{}{}",
                brute_compile.stdout, brute_compile.stderr
            )));
        }
        super::replay::ensure_sources_unchanged(workspace_root, request, &source_revisions)?;
        let solution_executable = solution_compile
            .executable_path
            .ok_or_else(|| stress_error("待测程序编译器未返回可执行文件"))?;
        let brute_executable = brute_compile
            .executable_path
            .ok_or_else(|| stress_error("暴力程序编译器未返回可执行文件"))?;

        emit_state(emit, &session.session_id, StressStatus::Running, "正在对拍");
        let started = Instant::now();
        let mut current_seed = request
            .seed
            .trim()
            .parse::<u64>()
            .map_err(|_| stress_error("seed must be a uint64 decimal string"))?;
        let mut passed = request.initial_passed;
        let failed = request.initial_failed;
        let mut total = request.start_case;
        let mut pending_passed = Vec::with_capacity(32);
        let mut last_progress_emit = Instant::now();

        while request.infinite || total < request.iterations {
            if session.stop_requested.load(Ordering::Acquire) {
                let stats = statistics(request, started, total, passed, failed);
                emit_passed(emit, &session.session_id, &mut pending_passed);
                emit_state(
                    emit,
                    &session.session_id,
                    StressStatus::Stopped,
                    "对拍已停止",
                );
                return Ok(summary(
                    request,
                    StressStatus::Stopped,
                    "对拍已停止",
                    current_seed,
                    stats,
                    None,
                ));
            }

            let case_seed = current_seed;
            let next_case_seed = next_seed(case_seed);
            let input = if let Some(input) = fixed_input {
                input.to_owned()
            } else {
                let mut profile = request.generator_profile.clone();
                profile.seed = case_seed.to_string();
                let generated = generate_visual(&VisualGenerateRequest { profile, count: 1 });
                if !generated.diagnostics.is_empty() {
                    let message = generated
                        .diagnostics
                        .iter()
                        .map(|diagnostic| diagnostic.message.as_str())
                        .collect::<Vec<_>>()
                        .join("；");
                    return Err(stress_error(format!("随机数据生成失败：{message}")));
                }
                let generated_case = generated
                    .cases
                    .into_iter()
                    .next()
                    .ok_or_else(|| stress_error("random generator returned no case"))?;
                generated_case.input
            };
            if session.stop_requested.load(Ordering::Acquire) {
                continue;
            }

            let case_number = total.saturating_add(1);
            let (solution, brute) = run_pair(
                session,
                request,
                case_number,
                &solution_executable,
                &brute_executable,
                &input,
            )?;
            if session.stop_requested.load(Ordering::Acquire)
                || solution.status == RunStatus::Stopped
                || brute.status == RunStatus::Stopped
            {
                let stats = statistics(request, started, total, passed, failed);
                emit_passed(emit, &session.session_id, &mut pending_passed);
                emit_state(
                    emit,
                    &session.session_id,
                    StressStatus::Stopped,
                    "对拍已停止",
                );
                return Ok(summary(
                    request,
                    StressStatus::Stopped,
                    "对拍已停止",
                    next_case_seed,
                    stats,
                    None,
                ));
            }

            total = case_number;
            current_seed = next_case_seed;
            if let Some(reason) = failure_reason(&solution, &brute) {
                let stats = statistics(request, started, total, passed, failed.saturating_add(1));
                emit_passed(emit, &session.session_id, &mut pending_passed);
                let failure = StressFailure {
                    index: case_number,
                    seed: case_seed.to_string(),
                    next_seed: next_case_seed.to_string(),
                    reason,
                    input,
                    solution_output: solution.stdout,
                    brute_output: brute.stdout,
                    solution_stderr: solution.stderr,
                    brute_stderr: brute.stderr,
                    solution_exit_code: solution.exit_code,
                    brute_exit_code: brute.exit_code,
                    solution_time_ms: solution.duration_ms,
                    brute_time_ms: brute.duration_ms,
                    stats,
                    replay: Some(replay_context.clone()),
                };
                emit(StressEvent::Failure {
                    session_id: session.session_id.clone(),
                    failure: Box::new(failure.clone()),
                });
                emit_state(
                    emit,
                    &session.session_id,
                    StressStatus::Failed,
                    "发现反例，对拍已暂停",
                );
                return Ok(summary(
                    request,
                    StressStatus::Failed,
                    "发现失败用例",
                    next_case_seed,
                    failure.stats.clone(),
                    Some(failure),
                ));
            }

            passed = passed.saturating_add(1);
            let stats = statistics(request, started, total, passed, failed);
            if fixed_input.is_some() {
                let replay_result = StressFailure {
                    index: case_number,
                    seed: case_seed.to_string(),
                    next_seed: next_case_seed.to_string(),
                    reason: "本次重放输出一致".to_owned(),
                    input,
                    solution_output: solution.stdout,
                    brute_output: brute.stdout,
                    solution_stderr: solution.stderr,
                    brute_stderr: brute.stderr,
                    solution_exit_code: solution.exit_code,
                    brute_exit_code: brute.exit_code,
                    solution_time_ms: solution.duration_ms,
                    brute_time_ms: brute.duration_ms,
                    stats: stats.clone(),
                    replay: Some(replay_context.clone()),
                };
                let mut result = summary(
                    request,
                    StressStatus::Completed,
                    "本次重放输出一致",
                    current_seed,
                    stats,
                    None,
                );
                result.replay_result = Some(replay_result);
                return Ok(result);
            }
            pending_passed.push(StressCasePassed {
                index: case_number,
                seed: case_seed.to_string(),
                solution_time_ms: solution.duration_ms,
                brute_time_ms: brute.duration_ms,
                stats,
            });
            if pending_passed.len() >= 32 || last_progress_emit.elapsed().as_millis() >= 100 {
                emit_passed(emit, &session.session_id, &mut pending_passed);
                last_progress_emit = Instant::now();
            }
        }

        let stats = statistics(request, started, total, passed, failed);
        emit_passed(emit, &session.session_id, &mut pending_passed);
        emit_state(
            emit,
            &session.session_id,
            StressStatus::Completed,
            "对拍已完成",
        );
        Ok(summary(
            request,
            StressStatus::Completed,
            "对拍已完成",
            current_seed,
            stats,
            None,
        ))
    }
}

pub struct StressJob {
    manager: Arc<StressManager>,
    session: Arc<ActiveStress>,
}
impl StressJob {
    pub fn run<F>(
        self,
        workspace: &Path,
        build: &Path,
        request: &StressRunRequest,
        input: Option<&str>,
        mut emit: F,
    ) -> AppResult<StressSummary>
    where
        F: FnMut(StressEvent),
    {
        self.manager
            .run_session(workspace, build, request, &self.session, input, &mut emit)
    }
}
impl Drop for StressJob {
    fn drop(&mut self) {
        self.manager.finish(&self.session.session_id);
    }
}

fn emit_passed<F>(emit: &mut F, session_id: &str, pending: &mut Vec<StressCasePassed>)
where
    F: FnMut(StressEvent),
{
    if pending.is_empty() {
        return;
    }
    emit(StressEvent::CasesPassed {
        session_id: session_id.to_owned(),
        results: std::mem::take(pending),
    });
}

impl Drop for StressManager {
    fn drop(&mut self) {
        if let Ok(active) = self.active.get_mut() {
            if let Some(session) = active.take() {
                session.stop_requested.store(true, Ordering::Release);
                session.solution_runner.stop();
                session.brute_runner.stop();
            }
        }
    }
}

fn run_pair(
    session: &Arc<ActiveStress>,
    request: &StressRunRequest,
    case_number: u64,
    solution_executable: &str,
    brute_executable: &str,
    input: &str,
) -> AppResult<(RunResult, RunResult)> {
    let solution_request = run_request(
        request,
        format!("{}-{case_number}-solution", session.session_id),
        solution_executable,
        &request.solution_path,
        input,
    );
    let brute_request = run_request(
        request,
        format!("{}-{case_number}-brute", session.session_id),
        brute_executable,
        &request.brute_path,
        input,
    );
    let solution_runner = session.solution_runner.clone();
    let brute_runner = session.brute_runner.clone();
    let solution_stop = session.stop_requested.clone();
    let brute_stop = session.stop_requested.clone();
    thread::scope(|scope| {
        let solution = scope
            .spawn(move || solution_runner.run_with_stop(&solution_request, solution_stop, |_| {}));
        let brute =
            scope.spawn(move || brute_runner.run_with_stop(&brute_request, brute_stop, |_| {}));
        let solution = solution
            .join()
            .map_err(|_| stress_error("待测程序 Runner 线程异常退出"))??;
        let brute = brute
            .join()
            .map_err(|_| stress_error("暴力程序 Runner 线程异常退出"))??;
        Ok((solution, brute))
    })
}

fn run_request(
    request: &StressRunRequest,
    client_run_id: String,
    executable_path: &str,
    source_path: &str,
    input: &str,
) -> RunRequest {
    RunRequest {
        client_run_id,
        executable_path: executable_path.to_owned(),
        arguments: Vec::new(),
        working_directory: parent_directory(source_path),
        stdin: input.to_owned(),
        timeout_ms: request.timeout_ms.clamp(50, 60_000),
        max_output_bytes: request.max_output_bytes.clamp(64 * 1024, 16 * 1024 * 1024),
    }
}

fn failure_reason(solution: &RunResult, brute: &RunResult) -> Option<String> {
    if solution.status == RunStatus::TimedOut {
        return Some("待测程序运行超时".to_owned());
    }
    if brute.status == RunStatus::TimedOut {
        return Some("暴力程序运行超时".to_owned());
    }
    if solution.exit_code != Some(0) {
        return Some(format!(
            "待测程序运行错误（退出码 {}）",
            solution
                .exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "未知".to_owned())
        ));
    }
    if brute.exit_code != Some(0) {
        return Some(format!(
            "暴力程序运行错误（退出码 {}）",
            brute
                .exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "未知".to_owned())
        ));
    }
    if solution.output_truncated || brute.output_truncated {
        return Some("程序输出超过容量上限".to_owned());
    }
    (!compare_output(&solution.stdout, &brute.stdout)).then(|| "输出不一致".to_owned())
}

fn statistics(
    request: &StressRunRequest,
    started: Instant,
    total: u64,
    passed: u64,
    failed: u64,
) -> StressStats {
    let elapsed_ms = request
        .initial_elapsed_ms
        .saturating_add(started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64);
    StressStats {
        total_cases: total,
        passed,
        failed,
        elapsed_ms,
        cases_per_second: if elapsed_ms == 0 {
            0.0
        } else {
            total as f64 * 1000.0 / elapsed_ms as f64
        },
    }
}

fn summary(
    request: &StressRunRequest,
    status: StressStatus,
    message: &str,
    next_seed: u64,
    stats: StressStats,
    failure: Option<StressFailure>,
) -> StressSummary {
    StressSummary {
        session_id: request.session_id.clone(),
        status,
        message: message.to_owned(),
        next_seed: next_seed.to_string(),
        stats,
        failure,
        replay_result: None,
    }
}

fn stopped_summary(request: &StressRunRequest, message: &str) -> StressSummary {
    StressSummary {
        session_id: request.session_id.clone(),
        status: StressStatus::Stopped,
        message: message.to_owned(),
        next_seed: request.seed.clone(),
        stats: StressStats {
            total_cases: request.start_case,
            passed: request.initial_passed,
            failed: request.initial_failed,
            elapsed_ms: request.initial_elapsed_ms,
            cases_per_second: 0.0,
        },
        failure: None,
        replay_result: None,
    }
}

fn emit_state<F>(emit: &mut F, session_id: &str, status: StressStatus, message: &str)
where
    F: FnMut(StressEvent),
{
    emit(StressEvent::State {
        session_id: session_id.to_owned(),
        status,
        message: message.to_owned(),
    });
}

fn validate_request(request: &StressRunRequest) -> AppResult<()> {
    if request.session_id.trim().is_empty() {
        return Err(stress_error("session id cannot be empty"));
    }
    if !request.infinite && !(1..=MAX_ITERATIONS).contains(&request.iterations) {
        return Err(stress_error(format!(
            "iterations must be between 1 and {MAX_ITERATIONS}"
        )));
    }
    request
        .seed
        .trim()
        .parse::<u64>()
        .map_err(|_| stress_error("seed must be a uint64 decimal string"))?;
    if normalized_path(&request.solution_path) == normalized_path(&request.brute_path) {
        return Err(stress_error("待测程序和暴力程序必须是不同的源文件"));
    }
    Ok(())
}

fn normalized_path(value: &str) -> String {
    value.replace('/', "\\").to_lowercase()
}

fn parent_directory(path: &str) -> String {
    PathBuf::from(path)
        .parent()
        .unwrap_or_else(|| Path::new(path))
        .to_string_lossy()
        .into_owned()
}

fn stress_error(message: impl Into<String>) -> AppError {
    AppError::Process(format!("stress: {}", message.into()))
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command, time::UNIX_EPOCH};

    use crate::{
        compiler::CompilerConfig,
        generator::{
            GeneratorStrategy, TreeShape, ValueExpression, VisualField, VisualGeneratorProfile,
            VisualNode,
        },
    };

    use super::*;

    #[test]
    fn stress_finds_and_preserves_a_counterexample() {
        let _process_guard = crate::PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if Command::new("g++").arg("--version").output().is_err() {
            eprintln!("skipping stress integration test because g++ is unavailable");
            return;
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("lightcp-stress-{}-{nonce}", std::process::id()));
        let build = root.join("build");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        let solution = root.join("solution.cpp");
        let brute = root.join("brute.cpp");
        fs::write(
            &solution,
            "#include <iostream>\nint main(){ long long n; std::cin>>n; std::cout<<n+1<<'\\n'; }\n",
        )
        .unwrap();
        fs::write(
            &brute,
            "#include <iostream>\nint main(){ long long n; std::cin>>n; std::cout<<n<<'\\n'; }\n",
        )
        .unwrap();
        let profile = VisualGeneratorProfile {
            version: 1,
            nodes: vec![VisualNode::Line {
                id: "line".to_owned(),
                fields: vec![VisualField::Integer {
                    id: "n".to_owned(),
                    name: "n".to_owned(),
                    minimum: ValueExpression::Constant {
                        value: "7".to_owned(),
                    },
                    maximum: ValueExpression::Constant {
                        value: "7".to_owned(),
                    },
                }],
            }],
            strategy: GeneratorStrategy::Random,
            tree_shape: TreeShape::Random,
            seed: "1".to_owned(),
        };
        let request = StressRunRequest {
            session_id: "stress-test".to_owned(),
            solution_path: solution.to_string_lossy().into_owned(),
            brute_path: brute.to_string_lossy().into_owned(),
            generator_profile: profile,
            iterations: 10,
            infinite: false,
            seed: "123".to_owned(),
            timeout_ms: 5_000,
            max_output_bytes: 64 * 1024,
            compiler_config: CompilerConfig {
                compiler_path: "g++".to_owned(),
                standard: "c++20".to_owned(),
                release_args: vec!["-O2".to_owned()],
                debug_args: vec!["-g".to_owned(), "-O0".to_owned()],
                max_output_bytes: 64 * 1024,
            },
            start_case: 0,
            initial_passed: 0,
            initial_failed: 0,
            initial_elapsed_ms: 0,
        };
        let manager = StressManager::default();
        let mut events = Vec::new();
        let result = manager
            .run(&root.join("nested").join(".."), &build, &request, |event| {
                events.push(event)
            })
            .unwrap();
        assert_eq!(result.status, StressStatus::Failed);
        let failure = result.failure.unwrap();
        assert_eq!(failure.index, 1);
        assert_eq!(failure.input.trim(), "7");
        assert_eq!(failure.solution_output.trim(), "8", "{failure:#?}");
        assert_eq!(failure.brute_output.trim(), "7", "{failure:#?}");
        assert_eq!(failure.stats.failed, 1);
        assert!(events
            .iter()
            .any(|event| matches!(event, StressEvent::Failure { .. })));
        let path = root.join("中文 反例.lightcp-replay.json");
        super::super::replay::save(&path, failure.clone()).unwrap();
        fs::write(&solution, "int main() { return 99; }").unwrap();
        fs::write(&brute, "int main() { return 88; }").unwrap();
        let manager = Arc::new(StressManager::default());
        let mut bundle = super::super::replay::load(&path).unwrap();
        // Replaying uses the saved input even when generation rules change.
        bundle
            .failure
            .replay
            .as_mut()
            .unwrap()
            .generator_profile
            .nodes
            .clear();
        let replayed = super::super::replay::run(
            bundle,
            manager.reserve("replay-test").unwrap(),
            "replay-test".into(),
            &build,
            "g++".into(),
            |_| {},
        )
        .unwrap();
        assert_eq!(replayed.status, StressStatus::Failed);
        let replayed = replayed.failure.unwrap();
        assert_eq!(replayed.input, failure.input);
        assert_eq!(replayed.solution_output, failure.solution_output);
        assert_eq!(replayed.brute_output, failure.brute_output);
        assert_eq!(
            fs::read_to_string(&solution).unwrap(),
            "int main() { return 99; }"
        );
        assert_eq!(fs::read_dir(build.join("replays")).unwrap().count(), 0);
        let mut invalid = failure.clone();
        invalid.replay = None;
        assert!(super::super::replay::save(&path, invalid).is_err());
        let mut bundle = super::super::replay::load(&path).unwrap();
        let context = bundle.failure.replay.as_mut().unwrap();
        context.solution_source.clone_from(&context.brute_source);
        let matched = super::super::replay::run(
            bundle,
            manager.reserve("matched").unwrap(),
            "matched".into(),
            &build,
            "g++".into(),
            |_| {},
        )
        .unwrap();
        assert_eq!(matched.status, StressStatus::Completed);
        assert!(matched.failure.is_none());
        assert_eq!(matched.replay_result.unwrap().stats.failed, 0);
        let bundle = super::super::replay::load(&path).unwrap();
        let job = manager.reserve("cancelled").unwrap();
        assert!(manager.stop());
        let stopped = super::super::replay::run(
            bundle,
            job,
            "cancelled".into(),
            &build,
            "g++".into(),
            |_| {},
        )
        .unwrap();
        assert_eq!(stopped.status, StressStatus::Stopped);
        assert!(manager.active_session_id().is_none());
        assert_eq!(fs::read_dir(build.join("replays")).unwrap().count(), 0);
        let mut future = super::super::replay::load(&path).unwrap();
        future.version = 2;
        fs::write(&path, serde_json::to_vec(&future).unwrap()).unwrap();
        assert!(super::super::replay::load(&path).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn request_validation_rejects_same_program() {
        let request = StressRunRequest {
            session_id: "x".to_owned(),
            solution_path: "C:\\work\\a.cpp".to_owned(),
            brute_path: "c:/WORK/a.cpp".to_owned(),
            generator_profile: VisualGeneratorProfile {
                version: 1,
                nodes: Vec::new(),
                strategy: GeneratorStrategy::Random,
                tree_shape: TreeShape::Random,
                seed: "1".to_owned(),
            },
            iterations: 1,
            infinite: false,
            seed: "1".to_owned(),
            timeout_ms: 100,
            max_output_bytes: 1024,
            compiler_config: CompilerConfig {
                compiler_path: "g++".to_owned(),
                standard: "c++20".to_owned(),
                release_args: vec!["-O2".to_owned()],
                debug_args: vec!["-g".to_owned()],
                max_output_bytes: 1024,
            },
            start_case: 0,
            initial_passed: 0,
            initial_failed: 0,
            initial_elapsed_ms: 0,
        };
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn stop_sets_the_shared_cancel_signal() {
        let manager = StressManager::default();
        let session = Arc::new(ActiveStress {
            session_id: "stop-test".to_owned(),
            stop_requested: Arc::new(AtomicBool::new(false)),
            solution_runner: Arc::new(RunnerManager::default()),
            brute_runner: Arc::new(RunnerManager::default()),
        });
        manager.begin(session.clone()).unwrap();
        assert_eq!(manager.active_session_id().as_deref(), Some("stop-test"));
        assert!(manager.stop());
        assert!(session.stop_requested.load(Ordering::Acquire));
        manager.finish("stop-test");
        assert!(!manager.stop());
    }

    #[test]
    fn ten_thousand_progress_records_are_batched() {
        let mut pending = Vec::with_capacity(32);
        let mut events = Vec::new();
        for index in 1..=10_000 {
            pending.push(StressCasePassed {
                index,
                seed: index.to_string(),
                solution_time_ms: 0,
                brute_time_ms: 0,
                stats: StressStats {
                    total_cases: index,
                    passed: index,
                    ..StressStats::default()
                },
            });
            if pending.len() >= 32 {
                emit_passed(&mut |event| events.push(event), "batch-test", &mut pending);
            }
        }
        emit_passed(&mut |event| events.push(event), "batch-test", &mut pending);
        assert_eq!(events.len(), 313);
        let delivered = events
            .iter()
            .map(|event| match event {
                StressEvent::CasesPassed { results, .. } => results.len(),
                _ => 0,
            })
            .sum::<usize>();
        assert_eq!(delivered, 10_000);
    }
}
