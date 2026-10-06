use crate::{
    error::CommandError,
    notebooks::{self, NotebookRecord},
    state::AppState,
};
use tauri::State;

#[tauri::command(async)]
pub fn read_notebook(
    kind: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, CommandError> {
    notebooks::read(&state.paths.database_file, &kind, &key).map_err(Into::into)
}
#[tauri::command(async)]
pub fn write_notebook(
    kind: String,
    key: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    notebooks::write(&state.paths.database_file, &kind, &key, &content).map_err(Into::into)
}
#[tauri::command(async)]
pub fn delete_notebook(
    kind: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    notebooks::delete(&state.paths.database_file, &kind, &key).map_err(Into::into)
}
#[tauri::command(async)]
pub fn import_notebooks(
    kind: String,
    storage_key: String,
    records: Vec<NotebookRecord>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    notebooks::import_legacy(&state.paths.database_file, &kind, &storage_key, &records)
        .map_err(Into::into)
}
#[tauri::command(async)]
pub fn remap_notebooks(
    previous: String,
    next: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    notebooks::remap(&state.paths.database_file, &previous, &next).map_err(Into::into)
}
