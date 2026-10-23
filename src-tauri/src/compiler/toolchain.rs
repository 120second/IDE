use super::service;
use crate::{
    error::{AppError, AppResult},
    process_tree::ProcessTree,
};
use std::{
    collections::HashMap,
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

// Probe once per executable revision/search environment rather than guessing
// from names such as g++, c++ or a locally renamed driver.
pub(super) fn supports_json(
    compiler: &str,
    directory: &Path,
    stop: &AtomicBool,
    timeout: Duration,
) -> AppResult<bool> {
    static CAPABILITIES: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let configured = Path::new(compiler);
    let resolved = if configured.is_absolute() {
        Some(configured.to_path_buf())
    } else if directory.join(configured).is_file() {
        Some(directory.join(configured))
    } else {
        std::env::var_os("PATH").and_then(|paths| {
            std::env::split_paths(&paths)
                .flat_map(|directory| {
                    [
                        directory.join(compiler),
                        directory.join(format!("{compiler}.exe")),
                    ]
                })
                .find(|path| path.is_file())
        })
    };
    let revision = resolved
        .as_ref()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|m| (m.len(), m.modified().ok()));
    let key = format!(
        "{compiler}\0{}\0{resolved:?}\0{revision:?}\0{:?}",
        directory.display(),
        std::env::var_os("PATH")
    );
    let cache = CAPABILITIES.get_or_init(Default::default);
    if let Some(value) = cache.lock().ok().and_then(|cache| cache.get(&key).copied()) {
        return Ok(value);
    }
    let mut command = Command::new(compiler);
    command
        .args([
            "-x",
            "c++",
            "-fsyntax-only",
            "-fdiagnostics-format=json",
            "-",
        ])
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    service::configure_hidden(&mut command);
    let Ok(mut child) = command.spawn() else {
        return Ok(false);
    };
    let tree = ProcessTree::attach(&mut child)?;
    let reader = child.stderr.take().map(|stderr| {
        service::spawn_limited_reader(
            stderr,
            65536,
            Arc::new(AtomicUsize::new(0)),
            Arc::new(AtomicBool::new(false)),
        )
    });
    let status =
        service::wait_for_compiler(&mut child, &tree, stop, timeout.min(Duration::from_secs(3)));
    drop(tree);
    if let Some(reader) = reader {
        service::join_reader(reader)?;
    }
    let supported = match status {
        Ok(status) => status.success(),
        Err(AppError::ProcessCancelled) => return Err(AppError::ProcessCancelled),
        // Unsupported probes must not prevent a normal compiler invocation.
        Err(_) => return Ok(false),
    };
    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= 64 {
            cache.clear();
        }
        cache.insert(key, supported);
    }
    Ok(supported)
}
