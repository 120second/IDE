use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub(crate) fn is_within(root: &Path, candidate: &Path) -> bool {
    #[cfg(windows)]
    {
        let root = comparable_windows_path(root);
        let candidate = comparable_windows_path(candidate);
        candidate == root || candidate.starts_with(&format!("{root}\\"))
    }
    #[cfg(not(windows))]
    {
        candidate.starts_with(root)
    }
}

#[cfg(windows)]
fn comparable_windows_path(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\");
    let text = if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(disk) = text.strip_prefix(r"\\?\") {
        disk.to_owned()
    } else {
        text
    };
    text.trim_end_matches('\\').to_lowercase()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn verbatim_windows_paths_compare_with_regular_workspace_roots() {
        let root = Path::new(r"C:\Users\竞赛\workspace");
        let deep = Path::new(r"\\?\C:\Users\竞赛\workspace\a\b\main.cpp");
        let sibling = Path::new(r"\\?\C:\Users\竞赛\workspace-other\main.cpp");
        assert!(is_within(root, deep));
        assert!(!is_within(root, sibling));
    }
}

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub database_file: PathBuf,
    pub settings_file: PathBuf,
}

impl AppPaths {
    pub fn initialize(app: &AppHandle) -> AppResult<Self> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| AppError::Configuration(error.to_string()))?;

        fs::create_dir_all(&data_dir)?;

        Ok(Self {
            database_file: data_dir.join("lightcp.db"),
            settings_file: data_dir.join("settings.json"),
            data_dir,
        })
    }
}
