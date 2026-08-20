use tauri::State;

use crate::{
    error::{AppError, CommandError},
    settings::{self, AppSettings},
    state::AppState,
};

#[tauri::command]
pub async fn load_settings(state: State<'_, AppState>) -> Result<AppSettings, CommandError> {
    let path = state.paths.settings_file.clone();
    blocking(move || settings::load(&path)).await
}

#[tauri::command]
pub async fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettings, CommandError> {
    let path = state.paths.settings_file.clone();
    let write_lock = state.settings_write_lock.clone();
    blocking(move || {
        let _write_guard = write_lock
            .lock()
            .map_err(|_| AppError::Internal("settings write lock was poisoned".to_owned()))?;

        let saved = crate::settings::save(&path, settings)?;
        log::debug!("application settings saved");
        Ok(saved)
    })
    .await
}

async fn blocking<T, F>(task: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            CommandError::from(AppError::Internal(format!(
                "settings task could not be joined: {error}"
            )))
        })?
        .map_err(CommandError::from)
}
