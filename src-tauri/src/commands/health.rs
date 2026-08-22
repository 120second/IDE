use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::{error::CommandError, state::AppState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    status: &'static str,
    application: &'static str,
    version: &'static str,
    database_schema_version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    available: bool,
    requested: String,
    resolved_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    compiler: ToolStatus,
    debugger: ToolStatus,
    language_server: ToolStatus,
}

#[tauri::command]
pub fn health_check(state: State<'_, AppState>) -> Result<HealthStatus, CommandError> {
    log::debug!(
        "health_check requested; data directory: {}",
        state.paths.data_dir.display()
    );

    Ok(HealthStatus {
        status: "ready",
        application: "LightCP",
        version: env!("CARGO_PKG_VERSION"),
        database_schema_version: state.database_schema_version,
    })
}

#[tauri::command]
pub fn diagnose_toolchain(
    compiler_path: String,
    gdb_path: String,
    clangd_path: String,
) -> ToolchainStatus {
    ToolchainStatus {
        compiler: locate_tool(&compiler_path, "g++", &[]),
        debugger: locate_tool(&gdb_path, "gdb", &[]),
        language_server: locate_tool(&clangd_path, "clangd", &clangd_fallbacks()),
    }
}

fn locate_tool(configured: &str, default_name: &str, fallbacks: &[PathBuf]) -> ToolStatus {
    let requested = if configured.trim().is_empty() {
        default_name
    } else {
        configured.trim()
    };
    let resolved_path = resolve_executable(requested).or_else(|| {
        fallbacks
            .iter()
            .find(|candidate| candidate.is_file())
            .map(|candidate| canonical_text(candidate))
    });
    ToolStatus {
        available: resolved_path.is_some(),
        requested: requested.chars().take(2048).collect(),
        resolved_path,
    }
}

fn resolve_executable(value: &str) -> Option<String> {
    let direct = PathBuf::from(value);
    if direct.is_file() {
        return Some(canonical_text(&direct));
    }
    if direct.is_absolute() || value.contains('/') || value.contains('\\') {
        return None;
    }

    let mut names = vec![value.to_owned()];
    #[cfg(windows)]
    if direct.extension().is_none() {
        let extensions =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_owned());
        names.extend(
            extensions
                .split(';')
                .filter(|extension| !extension.is_empty())
                .map(|extension| format!("{value}{extension}")),
        );
    }

    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|directory| {
        names.iter().find_map(|name| {
            let candidate = directory.join(name);
            candidate.is_file().then(|| canonical_text(&candidate))
        })
    })
}

fn canonical_text(path: &Path) -> String {
    dunce::canonicalize(path)
        .unwrap_or_else(|_| path.to_owned())
        .to_string_lossy()
        .into_owned()
}

fn clangd_fallbacks() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut candidates = Vec::new();
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            let Some(root) = std::env::var_os(variable).map(PathBuf::from) else {
                continue;
            };
            candidates.push(root.join(r"LLVM\bin\clangd.exe"));
            for edition in ["Community", "BuildTools", "Professional", "Enterprise"] {
                for relative in [
                    r"VC\Tools\Llvm\x64\bin\clangd.exe",
                    r"VC\Tools\Llvm\bin\clangd.exe",
                ] {
                    candidates.push(
                        root.join("Microsoft Visual Studio")
                            .join("2022")
                            .join(edition)
                            .join(relative),
                    );
                }
            }
        }
        candidates
    }
    #[cfg(not(windows))]
    Vec::new()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::locate_tool;

    #[test]
    fn tool_diagnostics_accept_a_direct_executable_path() {
        let path = std::env::temp_dir().join(format!(
            "lightcp-tool-diagnostic-{}{}",
            std::process::id(),
            std::env::consts::EXE_SUFFIX
        ));
        fs::write(&path, b"stub").expect("temporary tool should be writable");

        let status = locate_tool(&path.to_string_lossy(), "missing-tool", &[]);

        assert!(status.available);
        assert!(status.resolved_path.is_some());
        fs::remove_file(path).expect("temporary tool should be removable");
    }

    #[test]
    fn missing_direct_tool_is_reported_without_guessing() {
        let status = locate_tool(
            r"Z:\definitely-missing\lightcp-tool.exe",
            "missing-tool",
            &[],
        );
        assert!(!status.available);
        assert!(status.resolved_path.is_none());
    }
}
