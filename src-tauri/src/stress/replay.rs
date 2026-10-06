use super::{
    StressEvent, StressFailure, StressJob, StressReplayContext, StressRunRequest, StressSummary,
};
use crate::{
    compiler::CompilerConfig,
    error::{AppError, AppResult},
    filesystem,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_BUNDLE_BYTES: u64 = 96 * 1024 * 1024;
const MAX_SOURCE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
pub struct ReplayBundle {
    pub format: String,
    pub version: u8,
    pub failure: StressFailure,
}

pub fn capture(
    root: &Path,
    request: &StressRunRequest,
) -> AppResult<(StressReplayContext, [String; 2])> {
    let solution = filesystem::read_text_file(root, &request.solution_path)?;
    let brute = filesystem::read_text_file(root, &request.brute_path)?;
    let context = StressReplayContext {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        solution_name: file_name(&request.solution_path),
        brute_name: file_name(&request.brute_path),
        solution_source: solution.content,
        brute_source: brute.content,
        generator_profile: request.generator_profile.clone(),
        compiler_config: request.compiler_config.clone(),
        timeout_ms: request.timeout_ms.clamp(100, 60_000),
        max_output_bytes: request.max_output_bytes.clamp(64 * 1024, 16 * 1024 * 1024),
    };
    Ok((context, [solution.revision, brute.revision]))
}

pub fn ensure_sources_unchanged(
    root: &Path,
    request: &StressRunRequest,
    revisions: &[String; 2],
) -> AppResult<()> {
    for (path, revision) in [&request.solution_path, &request.brute_path]
        .into_iter()
        .zip(revisions)
    {
        if filesystem::get_text_file_revision(root, path)?.revision != *revision {
            return Err(error("编译期间源文件发生变化，请重新开始对拍。"));
        }
    }
    Ok(())
}

pub fn save(path: &Path, failure: StressFailure) -> AppResult<()> {
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err(error("重放包必须保存为 JSON 文件。"));
    }
    let bundle = ReplayBundle {
        format: "lightcp-stress-replay".into(),
        version: 1,
        failure,
    };
    validate(&bundle)?;
    let bytes = serde_json::to_vec_pretty(&bundle).map_err(|e| error(e.to_string()))?;
    if bytes.len() as u64 > MAX_BUNDLE_BYTES {
        return Err(error("重放包超过 96 MiB。"));
    }
    crate::recovery::atomic_write(path, &bytes)
}

pub fn load(path: &Path) -> AppResult<ReplayBundle> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(MAX_BUNDLE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BUNDLE_BYTES {
        return Err(error("重放包超过 96 MiB。"));
    }
    let bundle: ReplayBundle =
        serde_json::from_slice(&bytes).map_err(|e| error(format!("重放包格式无法识别：{e}")))?;
    validate(&bundle)?;
    Ok(bundle)
}

fn validate(bundle: &ReplayBundle) -> AppResult<()> {
    if bundle.format != "lightcp-stress-replay" || bundle.version != 1 {
        return Err(error("不支持此重放包的格式或版本。"));
    }
    let failure = &bundle.failure;
    let context = failure
        .replay
        .as_ref()
        .ok_or_else(|| error("此反例没有编译时的源码快照，请重新对拍后导出。"))?;
    if failure.seed.parse::<u64>().is_err()
        || failure.input.len() > 16 * 1024 * 1024
        || context.solution_source.len() > MAX_SOURCE_BYTES
        || context.brute_source.len() > MAX_SOURCE_BYTES
        || context.solution_source.trim().is_empty()
        || context.brute_source.trim().is_empty()
        || !(100..=60_000).contains(&context.timeout_ms)
        || !(64 * 1024..=16 * 1024 * 1024).contains(&context.max_output_bytes)
    {
        return Err(error("重放包的源码、输入或运行限制不符合要求。"));
    }
    validate_compiler(&context.compiler_config)
}

fn validate_compiler(config: &CompilerConfig) -> AppResult<()> {
    if config.standard.len() > 32
        || config.release_args.len() > 128
        || config
            .release_args
            .iter()
            .any(|arg| arg.len() > 4096 || arg.contains('\0'))
    {
        return Err(error("重放包的编译参数不符合要求。"));
    }
    Ok(())
}

pub fn run<F>(
    bundle: ReplayBundle,
    job: StressJob,
    session_id: String,
    build_root: &Path,
    compiler: String,
    emit: F,
) -> AppResult<StressSummary>
where
    F: FnMut(StressEvent),
{
    validate(&bundle)?;
    let context = bundle.failure.replay.as_ref().unwrap();
    let workspace = ReplayWorkspace::create(build_root)?;
    let solution = workspace.0.join("solution.cpp");
    let brute = workspace.0.join("brute.cpp");
    fs::write(&solution, &context.solution_source)?;
    fs::write(&brute, &context.brute_source)?;
    let mut compiler_config = context.compiler_config.clone();
    compiler_config.compiler_path = compiler;
    let request = StressRunRequest {
        session_id,
        solution_path: solution.to_string_lossy().into_owned(),
        brute_path: brute.to_string_lossy().into_owned(),
        generator_profile: context.generator_profile.clone(),
        iterations: 1,
        infinite: false,
        seed: bundle.failure.seed.clone(),
        timeout_ms: context.timeout_ms,
        max_output_bytes: context.max_output_bytes,
        compiler_config,
        start_case: 0,
        initial_passed: 0,
        initial_failed: 0,
        initial_elapsed_ms: 0,
    };
    let mut result = job.run(
        &workspace.0,
        &workspace.0.join("build"),
        &request,
        Some(&bundle.failure.input),
        emit,
    )?;
    for artifact in [&mut result.failure, &mut result.replay_result]
        .into_iter()
        .flatten()
    {
        if let Some(replay) = &mut artifact.replay {
            replay.solution_name.clone_from(&context.solution_name);
            replay.brute_name.clone_from(&context.brute_name);
        }
    }
    Ok(result)
}

struct ReplayWorkspace(PathBuf);
impl ReplayWorkspace {
    fn create(build: &Path) -> AppResult<Self> {
        let parent = build.join("replays");
        fs::create_dir_all(&parent)?;
        let parent = dunce::canonicalize(parent)?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| error(e.to_string()))?
            .as_nanos();
        let path = parent.join(format!("{}-{nonce}", std::process::id()));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }
}
impl Drop for ReplayWorkspace {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            log::warn!("could not clean replay workspace: {error}");
        }
    }
}
fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
fn error(message: impl Into<String>) -> AppError {
    AppError::Process(format!("stress: {}", message.into()))
}
