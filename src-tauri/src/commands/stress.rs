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
    let job = manager
        .reserve(&request.session_id)
        .map_err(CommandError::from)?;
    let performance = state.performance.clone();
    tauri::async_runtime::spawn_blocking(move || {
        job.run(&workspace_root, &build_root, &request, None, |event| {
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

#[tauri::command(async)]
pub fn export_stress_replay(
    path: String,
    failure: crate::stress::StressFailure,
) -> Result<(), CommandError> {
    crate::stress::replay::save(std::path::Path::new(&path), failure).map_err(Into::into)
}

#[tauri::command]
pub async fn replay_stress_test(
    path: String,
    session_id: String,
    compiler_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<StressSummary, CommandError> {
    let build_root = state.paths.data_dir.join("build");
    let job = state
        .stress
        .reserve(&session_id)
        .map_err(CommandError::from)?;
    let performance = state.performance.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = crate::stress::replay::load(std::path::Path::new(&path))?;
        crate::stress::replay::run(
            bundle,
            job,
            session_id,
            &build_root,
            compiler_path,
            |event| {
                performance.record_ipc_event();
                if let Err(error) = app.emit("stress-event", event) {
                    log::warn!("failed to emit replay event: {error}");
                }
            },
        )
    })
    .await
    .map_err(|error| {
        CommandError::from(AppError::Internal(format!(
            "replay task could not be joined: {error}"
        )))
    })?
    .map_err(CommandError::from)
}
