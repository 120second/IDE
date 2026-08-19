use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use crate::{
    error::{AppError, AppResult},
    filesystem::WorkspaceRuntime,
    paths::AppPaths,
    runner::RunnerManager,
};

pub struct AppState {
    pub paths: AppPaths,
    pub database_schema_version: i64,
    pub settings_write_lock: Mutex<()>,
    pub workspace: Mutex<WorkspaceRuntime>,
    pub runner: Arc<RunnerManager>,
}

impl AppState {
    pub fn new(paths: AppPaths, database_schema_version: i64) -> Self {
        Self {
            paths,
            database_schema_version,
            settings_write_lock: Mutex::new(()),
            workspace: Mutex::new(WorkspaceRuntime::default()),
            runner: Arc::new(RunnerManager::default()),
        }
    }

    pub fn active_workspace_root(&self) -> AppResult<PathBuf> {
        self.workspace
            .lock()
            .map_err(|_| AppError::Internal("workspace state lock was poisoned".to_owned()))?
            .root
            .clone()
            .ok_or_else(|| {
                AppError::FileSystemOperation("no workspace is currently open".to_owned())
            })
    }
}
