use tauri::State;

use crate::{
    compiler::{self as compiler_core, CompileRequest, CompileResult},
    error::{AppError, CommandError},
    state::AppState,
};

#[tauri::command]
pub async fn compile_current_file(
    request: CompileRequest,
    state: State<'_, AppState>,
) -> Result<CompileResult, CommandError> {
    let workspace_root = state.active_workspace_root().map_err(CommandError::from)?;
    let build_root = state.paths.data_dir.join("build");
    tauri::async_runtime::spawn_blocking(move || {
        compiler_core::compile_current_file(&workspace_root, &build_root, &request)
    })
    .await
    .map_err(|error| {
        CommandError::from(AppError::Internal(format!(
            "compiler task could not be joined: {error}"
        )))
    })?
    .map_err(CommandError::from)
}
