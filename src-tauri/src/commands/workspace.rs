use tauri::{AppHandle, State};

use crate::{
    database::recent_workspaces,
    error::{AppError, CommandError},
    filesystem::{canonical_workspace, WorkspaceInfo, WorkspaceWatcher},
    state::AppState,
};

#[tauri::command(async)]
pub fn open_workspace(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceInfo, CommandError> {
    let (root, info) = canonical_workspace(&path).map_err(CommandError::from)?;
    let watcher = WorkspaceWatcher::start(
        &root,
        &state.paths.database_file,
        app,
        state.performance.clone(),
    )
    .map_err(CommandError::from)?;
    recent_workspaces::record(&state.paths.database_file, &info).map_err(CommandError::from)?;

    let mut runtime = state.workspace.lock().map_err(|_| {
        CommandError::from(AppError::Internal(
            "workspace state lock was poisoned".to_owned(),
        ))
    })?;
    runtime.root = Some(root);
    runtime.watcher = Some(watcher);
    Ok(info)
}

#[tauri::command(async)]
pub fn list_recent_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceInfo>, CommandError> {
    recent_workspaces::list(&state.paths.database_file, 10).map_err(CommandError::from)
}
