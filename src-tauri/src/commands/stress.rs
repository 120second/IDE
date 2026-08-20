use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{AppError, CommandError},
    state::AppState,
    stress::{StressRunRequest, StressSummary},
};

#[tauri::command]
pub async fn start_stress_test(
    request: StressRunRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<StressSummary, CommandError> {
    let workspace_root = state.active_workspace_root().map_err(CommandError::from)?;
    let build_root = state.paths.data_dir.join("build");
    let manager = state.stress.clone();
    let performance = state.performance.clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.run(&workspace_root, &build_root, &request, |event| {
            performance.record_ipc_event();
            if let Err(error) = app.emit("stress-event", event) {
                log::warn!("failed to emit stress event: {error}");
            }
        })
    })
    .await
    .map_err(|error| {
        CommandError::from(AppError::Internal(format!(
            "stress task could not be joined: {error}"
        )))
    })?
    .map_err(CommandError::from)
}

#[tauri::command]
pub fn stop_stress_test(state: State<'_, AppState>) -> bool {
    state.stress.stop()
}
