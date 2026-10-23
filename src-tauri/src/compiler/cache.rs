//! A single in-memory build, validated by running the real preprocessor again.
//! This deliberately avoids timestamp-only dependency caches (new/shadowing
//! headers, __has_include, compiler macros and include search paths matter).
use super::{service, CompileProfile, CompileRequest, CompileResult, CompilerManager};
use crate::{
    error::{AppError, AppResult},
    process_tree::ProcessTree,
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(120);
const MAX_PREPROCESSED_BYTES: u64 = 16 * 1024 * 1024;
const MAX_DEPENDENCY_BYTES: usize = 32 * 1024 * 1024;
type Dependencies = BTreeMap<PathBuf, Vec<u8>>;

struct Probe {
    text: Vec<u8>,
    warnings: String,
    dependencies: Dependencies,
}

pub(super) struct CachedBuild {
    key: String,
    source: Vec<u8>,
    preprocessed: Vec<u8>,
    warnings: String,
    dependencies: Dependencies,
    artifact_revision: String,
    result: CompileResult,
}

struct ProbeFile(PathBuf);
impl Drop for ProbeFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub(super) fn compile(
    manager: &CompilerManager,
    root: &Path,
    build: &Path,
    request: &CompileRequest,
    stop: &AtomicBool,
) -> AppResult<CompileResult> {
    let started = Instant::now();
    let previous = manager
        .cache
        .lock()
        .map_err(|_| AppError::Internal("build cache lock poisoned".into()))?
        .take();
    let Some(compiler) = cacheable_compiler(request) else {
        return service::compile_with_stop(root, build, request, stop, TIMEOUT);
    };
    if stop.load(Ordering::Acquire) {
        return Err(AppError::ProcessCancelled);
    }
    let source = service::checked_source(root, &request.source_path)?;
    let source_bytes = fs::read(&source)?;
    if request
        .expected_source
        .as_ref()
        .is_some_and(|text| !service::expected_source_matches(text, &source_bytes))
    {
        return Err(AppError::Configuration(
            "源码已更改，请保存当前版本后重新编译。".into(),
        ));
    }
    let compiler_revision = revision(&compiler)?;
    let key = format!(
        "{}\0{}\0{}\0{}",
        source.display(),
        compiler.display(),
        compiler_revision,
        serde_json::to_string(&request.config).unwrap_or_default()
    );
    if manager
        .unstable_cache_key
        .lock()
        .map_err(|_| AppError::Internal("build cache lock poisoned".into()))?
        .as_ref()
        == Some(&key)
    {
        return service::compile_with_stop(
            root,
            build,
            request,
            stop,
            TIMEOUT.saturating_sub(started.elapsed()),
        );
    }
    let Some(probe) = preprocess(&compiler, &source, request, stop, TIMEOUT)? else {
        return service::compile_with_stop(
            root,
            build,
            request,
            stop,
            TIMEOUT.saturating_sub(started.elapsed()),
        );
    };
    if stop.load(Ordering::Acquire) {
        return Err(AppError::ProcessCancelled);
    }
    if fs::read(&source)? != source_bytes {
        return Err(AppError::Configuration(
            "预处理期间源码已修改，请重新运行。".into(),
        ));
    }
    if let Some(cached) = previous {
        if cached.key == key
            && cached.source == source_bytes
            && cached.preprocessed == probe.text
            && cached.warnings == probe.warnings
            && cached.dependencies == probe.dependencies
        {
            if let Some(executable) = &cached.result.executable_path {
                let artifact = Path::new(executable);
                if service::valid_executable(artifact)
                    && revision(artifact).ok().as_ref() == Some(&cached.artifact_revision)
                {
                    let mut result = cached.result.clone();
                    result.cache_hit = true;
                    result.duration_ms = started.elapsed().as_millis() as u64;
                    *manager
                        .cache
                        .lock()
                        .map_err(|_| AppError::Internal("build cache lock poisoned".into()))? =
                        Some(cached);
                    return Ok(result);
                }
            }
        }
    }
    // Always compile the ORIGINAL source. Compiling a .ii loses macro expansion
    // locations and can change warnings. Preprocessing is only a cache validator.
    let mut result = service::compile_with_stop(
        root,
        build,
        request,
        stop,
        TIMEOUT.saturating_sub(started.elapsed()),
    )?;
    // A header-only whitespace/comment edit can leave preprocessed text the
    // same while moving a warning's source columns. Rebuild diagnostic-bearing
    // programs so their original-source locations are always recomputed.
    if result.success && !result.output_truncated && result.diagnostics.is_empty() {
        // Revalidate after code generation too: do not associate an executable
        // with a signature from headers that changed during this build.
        let after = preprocess(
            &compiler,
            &source,
            request,
            stop,
            TIMEOUT.saturating_sub(started.elapsed()),
        )?;
        let unchanged = after
            .as_ref()
            .is_some_and(|after| after.dependencies == probe.dependencies)
            && fs::read(&source).is_ok_and(|text| text == source_bytes)
            && revision(&compiler).is_ok_and(|value| value == compiler_revision);
        if !unchanged {
            result.success = false;
            result.source_changed = true;
            result.executable_path = None;
            result.diagnostics.push(super::diagnostics::task_error(
                &source,
                "编译期间源码、头文件或工具链已变化，请重新编译。",
                "dependencies_changed",
            ));
        } else if after
            .as_ref()
            .is_some_and(|after| after.text != probe.text || after.warnings != probe.warnings)
        {
            // Some GCC builds emit nondeterministic whitespace/line markers.
            // Do not normalize C++ tokens or blame unchanged user files. Rebuild
            // from the original source and bypass this unstable cache key.
            *manager
                .unstable_cache_key
                .lock()
                .map_err(|_| AppError::Internal("build cache lock poisoned".into()))? = Some(key);
            result = service::compile_with_stop(
                root,
                build,
                request,
                stop,
                TIMEOUT.saturating_sub(started.elapsed()),
            )?;
        } else if let Some(executable) = &result.executable_path {
            result.duration_ms = started.elapsed().as_millis() as u64;
            let cached = CachedBuild {
                key,
                source: source_bytes,
                preprocessed: probe.text,
                warnings: probe.warnings,
                dependencies: probe.dependencies,
                artifact_revision: revision(Path::new(executable))?,
                result: result.clone(),
            };
            *manager
                .cache
                .lock()
                .map_err(|_| AppError::Internal("build cache lock poisoned".into()))? =
                Some(cached);
        }
    }
    result.duration_ms = started.elapsed().as_millis() as u64;
    Ok(result)
}

fn preprocess(
    compiler: &Path,
    source: &Path,
    request: &CompileRequest,
    stop: &AtomicBool,
    timeout: Duration,
) -> AppResult<Option<Probe>> {
    let started = Instant::now();
    if stop.load(Ordering::Acquire) {
        return Err(AppError::ProcessCancelled);
    }
    let probe_root = std::env::temp_dir();
    if !probe_root.as_os_str().to_string_lossy().is_ascii() {
        return Ok(None);
    }
    let probe = ProbeFile(probe_root.join(format!(
        "lightcp-{}-{}.ii",
        std::process::id(),
        uuid::Uuid::new_v4()
    )));
    let mut command = Command::new(compiler);
    let json_diagnostics = super::toolchain::supports_json(
        compiler.to_str().unwrap_or_default(),
        source.parent().unwrap_or(Path::new(".")),
        stop,
        timeout,
    )?;
    let standard = request.config.standard.trim();
    command
        .arg(format!(
            "-std={}",
            if standard.is_empty() {
                "c++20"
            } else {
                standard
            }
        ))
        .args(
            request
                .config
                .release_args
                .iter()
                .filter(|arg| !arg.trim().is_empty()),
        )
        .arg("-fdiagnostics-color=never");
    // GCC 16 removed the legacy JSON format. Cache probes must negotiate it
    // exactly like normal compilation instead of silently disabling reuse.
    if json_diagnostics {
        command.arg("-fdiagnostics-format=json");
    }
    command
        .args(["-Wdate-time", "-E"])
        .arg(source)
        .arg("-o")
        .arg(&probe.0)
        .current_dir(source.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    service::configure_hidden(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return Ok(None),
    };
    let tree = ProcessTree::attach(&mut child)?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("preprocessor stderr unavailable".into()))?;
    let truncated = Arc::new(AtomicBool::new(false));
    let reader = service::spawn_limited_reader(
        stderr,
        2 * 1024 * 1024,
        Arc::new(AtomicUsize::new(0)),
        truncated.clone(),
    );
    let status = service::wait_for_compiler(
        &mut child,
        &tree,
        stop,
        timeout.saturating_sub(started.elapsed()),
    );
    drop(tree);
    let warnings = service::join_reader(reader)?;
    // Time-dependent builtins are valid C++, but a second validation naturally
    // differs. Build normally instead of reporting a spurious dependency edit.
    if !status?.success()
        || warnings.contains("-Wdate-time")
        || truncated.load(Ordering::Relaxed)
        || fs::metadata(&probe.0)?.len() > MAX_PREPROCESSED_BYTES
    {
        return Ok(None);
    }
    let text = fs::read(&probe.0)?;
    if text
        .windows(b"#pragma GCC pch_preprocess".len())
        .any(|s| s == b"#pragma GCC pch_preprocess")
    {
        return Ok(None);
    }
    let Some(dependencies) = dependency_contents(&text, source.parent().unwrap_or(Path::new(".")))
    else {
        return Ok(None);
    };
    Ok(Some(Probe {
        text,
        warnings,
        dependencies,
    }))
}

fn dependency_contents(text: &[u8], directory: &Path) -> Option<Dependencies> {
    let text = std::str::from_utf8(text).ok()?;
    let mut dependencies = Dependencies::new();
    let mut bytes = 0usize;
    for line in text.lines().filter_map(|line| line.strip_prefix("# ")) {
        let (row, rest) = line.split_once(' ')?;
        if row.parse::<u32>().is_err() {
            continue;
        }
        let file = serde_json::Deserializer::from_str(rest)
            .into_iter::<String>()
            .next()?
            .ok()?;
        if file.starts_with('<') {
            continue;
        }
        let path = PathBuf::from(file);
        let path = dunce::canonicalize(if path.is_absolute() {
            path
        } else {
            directory.join(path)
        })
        .ok()?;
        if dependencies.contains_key(&path) {
            continue;
        }
        let content = fs::read(&path).ok()?;
        bytes = bytes.checked_add(content.len())?;
        if bytes > MAX_DEPENDENCY_BYTES {
            return None;
        }
        dependencies.insert(path, content);
    }
    (!dependencies.is_empty()).then_some(dependencies)
}

fn revision(path: &Path) -> AppResult<String> {
    let metadata = fs::metadata(path)?;
    Ok(format!("{}:{:?}", metadata.len(), metadata.modified()?))
}

fn cacheable_compiler(request: &CompileRequest) -> Option<PathBuf> {
    if !request.reuse_artifact || !matches!(request.profile, CompileProfile::Release) {
        return None;
    }
    // Extra sources, response files, plugins, link libraries, PCH and custom
    // driver options require a complete build, never a partial dependency guess.
    if !request.config.release_args.iter().all(|arg| {
        let arg = arg.trim();
        arg.is_empty()
            || matches!(
                arg,
                "-O0"
                    | "-O1"
                    | "-O2"
                    | "-O3"
                    | "-Og"
                    | "-Os"
                    | "-Ofast"
                    | "-pipe"
                    | "-pedantic"
                    | "-pedantic-errors"
                    | "-Wall"
                    | "-Wextra"
                    | "-Werror"
                    | "-Wshadow"
                    | "-Wconversion"
            )
            || ["-D", "-U", "-I", "-Wno-"]
                .iter()
                .any(|prefix| arg.starts_with(prefix) && arg.len() > prefix.len())
    }) {
        return None;
    }
    let configured = request.config.compiler_path.trim();
    let configured = if configured.is_empty() {
        "g++"
    } else {
        configured
    };
    let path = PathBuf::from(configured);
    let name = path.file_stem()?.to_str()?.to_ascii_lowercase();
    if !name.ends_with("g++") {
        return None;
    }
    if path.is_file() {
        return dunce::canonicalize(path).ok();
    }
    if path.is_absolute() || configured.contains(['/', '\\']) {
        return None;
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH")?) {
        for suffix in ["", ".exe"] {
            let candidate = dir.join(format!("{configured}{suffix}"));
            if candidate.is_file() {
                return dunce::canonicalize(candidate).ok();
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::super::CompilerConfig;

    #[test]
    #[ignore = "manual compiler and runner timing; run on an otherwise idle machine"]
    fn compiler_and_runner_timing() {
        let root =
            std::env::temp_dir().join(format!("lightcp-build-timing-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("sum.cpp");
        fs::write(&source, "#include <bits/stdc++.h>\nint main(){long long a=0,b=0;std::cin>>a>>b;std::cout<<a+b<<'\\n';}\n").unwrap();
        let manager = Arc::new(CompilerManager::default());
        let runner = crate::runner::RunnerManager::default();
        let mut request = CompileRequest {
            reuse_artifact: false,
            client_task_id: None,
            expected_source: None,
            source_path: source.to_string_lossy().into_owned(),
            profile: CompileProfile::Release,
            config: CompilerConfig {
                compiler_path: "g++".into(),
                standard: "c++20".into(),
                release_args: vec!["-O2".into()],
                debug_args: vec![],
                max_output_bytes: 65536,
            },
        };
        for reuse in [false, true] {
            request.reuse_artifact = reuse;
            for trial in 1..=3 {
                let compiled = manager
                    .reserve()
                    .unwrap()
                    .compile(&root, &root.join("build"), &request)
                    .unwrap();
                assert!(compiled.success, "{}", compiled.stderr);
                let clock = Instant::now();
                let result = runner
                    .run(
                        &crate::runner::RunRequest {
                            client_run_id: format!("timing-{reuse}-{trial}"),
                            executable_path: compiled.executable_path.unwrap(),
                            arguments: vec![],
                            working_directory: root.to_string_lossy().into_owned(),
                            stdin: "2 3\n".into(),
                            timeout_ms: 5000,
                            max_output_bytes: 65536,
                        },
                        |_| {},
                    )
                    .unwrap();
                assert_eq!(result.stdout.trim(), "5");
                eprintln!(
                    "PERF reuse={reuse} trial={trial} hit={} build_ms={} run_wall_ms={}",
                    compiled.cache_hit,
                    compiled.duration_ms,
                    clock.elapsed().as_millis()
                );
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
    use super::*;

    #[test]
    fn repeated_build_validates_headers_macros_and_artifact() {
        if Command::new("g++").arg("--version").output().is_err() {
            panic!("g++ is required for the build-cache regression test");
        }
        let root =
            std::env::temp_dir().join(format!("lightcp-cache-中文-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("求和.cpp");
        let header = root.join("value.h");
        fs::write(&header, "#define VALUE 3\n").unwrap();
        fs::write(&source, "#include \"value.h\"\n#if __has_include(\"extra.h\")\n#include \"extra.h\"\n#endif\nint main(){return VALUE;}\n").unwrap();
        let manager = Arc::new(CompilerManager::default());
        let mut request = CompileRequest {
            reuse_artifact: true,
            client_task_id: None,
            expected_source: None,
            source_path: source.to_string_lossy().into_owned(),
            profile: CompileProfile::Release,
            config: CompilerConfig {
                compiler_path: "g++".into(),
                standard: "c++20".into(),
                release_args: vec!["-O2".into()],
                debug_args: vec![],
                max_output_bytes: 65536,
            },
        };
        let build = |request: &CompileRequest| {
            manager
                .reserve()
                .unwrap()
                .compile(&root, &root.join("build"), request)
                .unwrap()
        };
        let first = build(&request);
        assert!(first.success, "{first:?}");
        assert!(!first.cache_hit);
        let cached_before_repeat = manager.cache.lock().unwrap().is_some();
        let hit = build(&request);
        assert!(hit.success && !hit.source_changed, "{hit:?}");
        if hit.cache_hit {
            assert_eq!(hit.executable_path, first.executable_path);
        } else {
            // Different GCC builds can emit unstable line-marker output. The
            // documented fallback must rebuild safely, not promise a cache hit.
            // A miss without that explicit policy is still a regression.
            let bypass = manager.unstable_cache_key.lock().unwrap().is_some();
            assert!(bypass, "unexpected cache miss: cached_before_repeat={cached_before_repeat}, compiler={:?}, repeat={hit:?}", cacheable_compiler(&request));
            assert_ne!(hit.executable_path, first.executable_path);
            eprintln!("Validated safe rebuild for an unstable preprocessor signature");
        }
        assert_eq!(
            Command::new(hit.executable_path.as_ref().unwrap())
                .status()
                .unwrap()
                .code(),
            Some(3),
        );
        eprintln!(
            "PERF gcc_bits_full_ms={} validated_repeat_ms={}",
            first.duration_ms, hit.duration_ms
        );
        fs::write(&header, "#define VALUE 8\n").unwrap();
        let changed = build(&request);
        assert!(changed.success && !changed.cache_hit);
        assert_ne!(changed.executable_path, first.executable_path);
        assert_eq!(
            Command::new(changed.executable_path.as_ref().unwrap())
                .output()
                .unwrap()
                .status
                .code(),
            Some(8)
        );
        fs::write(root.join("extra.h"), "#undef VALUE\n#define VALUE 9\n").unwrap();
        let added = build(&request);
        assert!(
            added.success && !added.cache_hit,
            "new __has_include dependencies must be detected"
        );
        assert_eq!(
            Command::new(added.executable_path.as_ref().unwrap())
                .output()
                .unwrap()
                .status
                .code(),
            Some(9)
        );
        fs::remove_file(added.executable_path.unwrap()).unwrap();
        assert!(!build(&request).cache_hit);
        request.config.release_args.push("-DOTHER=1".into());
        assert!(!build(&request).cache_hit, "config changes must miss");
        fs::write(&source, "int main(){add_subtree(1,1);}\n").unwrap();
        let failure = build(&request);
        assert!(!failure.success && !failure.cache_hit && failure.executable_path.is_none());
        assert!(failure
            .diagnostics
            .iter()
            .any(|d| d.message.contains("add_subtree") && d.path == source.to_string_lossy()));
        fs::write(&source, "int main(){}\n").unwrap();
        assert!(build(&request).success);
        request.reuse_artifact = false;
        assert!(
            !build(&request).cache_hit,
            "explicit compilation always rebuilds"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
