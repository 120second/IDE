use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{AppError, CommandError},
    runner::{RunRequest, RunResult},
    state::AppState,
};

#[tauri::command]
pub async fn run_program(
    request: RunRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RunResult, CommandError> {
    let manager = state.runner.clone();
    let performance = state.performance.clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.run(&request, |batch| {
            performance.record_ipc_event();
            if let Err(error) = app.emit("runner-output", batch) {
                log::warn!("failed to emit buffered runner output: {error}");
            }
        })
    })
    .await
    .map_err(|error| {
        CommandError::from(AppError::Internal(format!(
            "runner task could not be joined: {error}"
        )))
    })?
    .map_err(CommandError::from)
}

#[tauri::command]
pub fn stop_program(state: State<'_, AppState>) -> bool {
    state.runner.stop()
}
