use tauri::State;

use crate::{
    error::{AppError, CommandError},
    recovery::{self, EditorRecoverySnapshot},
    state::AppState,
};

#[tauri::command(async)]
pub fn load_editor_recovery(
    state: State<'_, AppState>,
) -> Result<Option<EditorRecoverySnapshot>, CommandError> {
    recovery::load(&state.paths.editor_recovery_file).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn save_editor_recovery(
    snapshot: EditorRecoverySnapshot,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let _guard = state.recovery_write_lock.lock().map_err(|_| {
        CommandError::from(AppError::Internal(
            "editor recovery write lock was poisoned".to_owned(),
        ))
    })?;
    recovery::save(&state.paths.editor_recovery_file, &snapshot).map_err(CommandError::from)
}
