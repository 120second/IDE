use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use crate::{
    debugger::DebugManager,
    error::{AppError, AppResult},
    filesystem::WorkspaceRuntime,
    paths::AppPaths,
    performance::PerformanceMetrics,
    runner::RunnerManager,
    stress::StressManager,
};

pub struct AppState {
    pub paths: AppPaths,
    pub database_schema_version: i64,
    pub settings_write_lock: Arc<Mutex<()>>,
    pub workspace: Mutex<WorkspaceRuntime>,
    pub runner: Arc<RunnerManager>,
    pub debugger: Arc<DebugManager>,
    pub stress: Arc<StressManager>,
    pub performance: Arc<PerformanceMetrics>,
}

impl AppState {
    pub fn new(paths: AppPaths, database_schema_version: i64) -> Self {
        let debug_data_dir = paths.data_dir.join("debug");
        Self {
            paths,
            database_schema_version,
            settings_write_lock: Arc::new(Mutex::new(())),
            workspace: Mutex::new(WorkspaceRuntime::default()),
            runner: Arc::new(RunnerManager::default()),
            debugger: Arc::new(DebugManager::new(debug_data_dir)),
            stress: Arc::new(StressManager::default()),
            performance: Arc::new(PerformanceMetrics::default()),
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
