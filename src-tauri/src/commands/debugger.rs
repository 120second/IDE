use tauri::{AppHandle, Emitter, State};

use crate::{
    debugger::{
        DebugBreakpoint, DebugBreakpointInput, DebugSessionSnapshot, DebugStartRequest,
        DebugVariablePage,
    },
    error::{AppError, CommandError},
    state::AppState,
};

#[tauri::command]
pub async fn start_debug_session(
    request: DebugStartRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    let performance = state.performance.clone();
    blocking(move || {
        manager.start(request, move |event| {
            performance.record_ipc_event();
            if let Err(error) = app.emit("debug-event", event) {
                log::warn!("failed to emit debugger event: {error}");
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn stop_debug_session(
    state: State<'_, AppState>,
) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.stop()).await
}

#[tauri::command]
pub async fn restart_debug_session(
    state: State<'_, AppState>,
) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.restart()).await
}

#[tauri::command]
pub async fn debug_continue(
    state: State<'_, AppState>,
) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.continue_execution()).await
}

#[tauri::command]
pub async fn debug_pause(state: State<'_, AppState>) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.pause()).await
}

#[tauri::command]
pub async fn debug_step_over(
    state: State<'_, AppState>,
) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.step_over()).await
}

#[tauri::command]
pub async fn debug_step_into(
    state: State<'_, AppState>,
) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.step_into()).await
}

#[tauri::command]
pub async fn debug_step_out(
    state: State<'_, AppState>,
) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.step_out()).await
}

#[tauri::command]
pub async fn get_debug_snapshot(
    selected_frame: u32,
    watches: Vec<String>,
    state: State<'_, AppState>,
) -> Result<DebugSessionSnapshot, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.snapshot(selected_frame, &watches)).await
}

#[tauri::command]
pub async fn fetch_debug_variable_children(
    selected_frame: u32,
    expression: String,
    variable_object: Option<String>,
    from: u32,
    count: u32,
    state: State<'_, AppState>,
) -> Result<DebugVariablePage, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || {
        manager.fetch_children(
            selected_frame,
            &expression,
            variable_object.as_deref(),
            from,
            count,
        )
    })
    .await
}

#[tauri::command]
pub async fn set_debug_breakpoint(
    breakpoint: DebugBreakpointInput,
    state: State<'_, AppState>,
) -> Result<DebugBreakpoint, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.set_breakpoint(breakpoint)).await
}

#[tauri::command]
pub async fn remove_debug_breakpoint(
    id: String,
    state: State<'_, AppState>,
) -> Result<bool, CommandError> {
    let manager = state.debugger.clone();
    blocking(move || manager.remove_breakpoint(&id)).await
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
                "debugger task could not be joined: {error}"
            )))
        })?
        .map_err(CommandError::from)
}
