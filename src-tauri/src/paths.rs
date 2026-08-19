use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

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
