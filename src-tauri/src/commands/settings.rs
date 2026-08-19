use tauri::State;

use crate::{
    error::{AppError, CommandError},
    settings::{self, AppSettings},
    state::AppState,
};

#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> Result<AppSettings, CommandError> {
    settings::load(&state.paths.settings_file).map_err(CommandError::from)
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettings, CommandError> {
    let _write_guard = state.settings_write_lock.lock().map_err(|_| {
        CommandError::from(AppError::Internal(
            "settings write lock was poisoned".to_owned(),
        ))
    })?;

    let saved =
        crate::settings::save(&state.paths.settings_file, settings).map_err(CommandError::from)?;
    log::debug!("application settings saved");
    Ok(saved)
}
