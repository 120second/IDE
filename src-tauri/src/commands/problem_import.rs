use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{AppError, CommandError},
    problem_import::ListenerStatus,
    state::AppState,
};

#[tauri::command(async)]
pub fn start_problem_listener(
    template_code: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ListenerStatus, CommandError> {
    // Match workspace switching's lock order so a concurrent switch cannot
    // start a listener against a workspace that has just been closed.
    let runtime = state
        .workspace
        .lock()
        .map_err(|_| CommandError::from(AppError::Internal("workspace lock poisoned".into())))?;
    let root = runtime.root.clone().ok_or_else(|| {
        CommandError::from(AppError::Server("请先打开工作区，再开启题目监听。".into()))
    })?;
    if template_code.len() > 1024 * 1024 {
        return Err(AppError::Server("所选模板超过 1 MB，请选择其他模板。".into()).into());
    }
    state
        .problem_listener
        .start(
            root,
            state.paths.database_file.clone(),
            template_code,
            move |imported| {
                if let Err(error) = app.emit("problem-imported", imported) {
                    log::error!("Cannot notify editor of imported problem: {error}");
                }
            },
        )
        .map_err(Into::into)
}

#[tauri::command(async)]
pub fn stop_problem_listener(state: State<'_, AppState>) -> Result<(), CommandError> {
    state.problem_listener.stop().map_err(Into::into)
}

#[tauri::command(async)]
pub fn problem_listener_status(state: State<'_, AppState>) -> Result<ListenerStatus, CommandError> {
    state.problem_listener.status().map_err(Into::into)
}
