use std::{fs, path::PathBuf};

use crate::error::{AppError, CommandError};

const MAX_THEME_BYTES: u64 = 512 * 1024;

#[tauri::command]
pub fn read_theme_file(path: String) -> Result<String, CommandError> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path).map_err(AppError::from)?;
    if !metadata.is_file() || metadata.len() > MAX_THEME_BYTES {
        return Err(CommandError::from(AppError::Configuration(
            "theme file must be a regular file no larger than 512 KiB".to_owned(),
        )));
    }
    fs::read_to_string(path)
        .map_err(AppError::from)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn write_theme_file(path: String, content: String) -> Result<(), CommandError> {
    if content.len() as u64 > MAX_THEME_BYTES {
        return Err(CommandError::from(AppError::Configuration(
            "theme document is larger than 512 KiB".to_owned(),
        )));
    }
    serde_json::from_str::<serde_json::Value>(&content).map_err(|error| {
        CommandError::from(AppError::Configuration(format!(
            "theme document is not valid JSON: {error}"
        )))
    })?;
    fs::write(PathBuf::from(path), content)
        .map_err(AppError::from)
        .map_err(CommandError::from)
}
