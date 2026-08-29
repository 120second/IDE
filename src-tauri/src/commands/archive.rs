use tauri::State;

use crate::{
    archive::{
        self as archive_core, ArchiveBulkInput, ArchiveFacets, ArchiveFile, ArchiveInput,
        ArchiveQuery, SmartCollection, SmartCollectionInput,
    },
    error::CommandError,
    state::AppState,
};

#[tauri::command(async)]
pub fn list_archive_files(
    query: ArchiveQuery,
    state: State<'_, AppState>,
) -> Result<Vec<ArchiveFile>, CommandError> {
    archive_core::list_files(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        &query,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn get_archive_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<Option<ArchiveFile>, CommandError> {
    archive_core::get_file_by_path(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        &path,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn archive_file(
    input: ArchiveInput,
    state: State<'_, AppState>,
) -> Result<ArchiveFile, CommandError> {
    archive_core::archive_file(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        &input,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn set_archive_favorite(
    id: i64,
    favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    archive_core::set_favorite(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        id,
        favorite,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn complete_archive_review(
    id: i64,
    state: State<'_, AppState>,
) -> Result<ArchiveFile, CommandError> {
    archive_core::complete_review(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        id,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn bulk_update_archive(
    input: ArchiveBulkInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    archive_core::bulk_update(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        &input,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn list_archive_tags(
    search: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, CommandError> {
    archive_core::list_tags(&state.paths.database_file, &search).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn list_archive_facets(state: State<'_, AppState>) -> Result<ArchiveFacets, CommandError> {
    archive_core::list_facets(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn list_smart_collections(
    state: State<'_, AppState>,
) -> Result<Vec<SmartCollection>, CommandError> {
    archive_core::list_collections(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn create_smart_collection(
    input: SmartCollectionInput,
    state: State<'_, AppState>,
) -> Result<SmartCollection, CommandError> {
    archive_core::create_collection(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        &input,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn update_smart_collection(
    id: i64,
    input: SmartCollectionInput,
    state: State<'_, AppState>,
) -> Result<SmartCollection, CommandError> {
    archive_core::update_collection(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        id,
        &input,
    )
    .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn delete_smart_collection(id: i64, state: State<'_, AppState>) -> Result<(), CommandError> {
    archive_core::delete_collection(
        &state.paths.database_file,
        &state.active_workspace_root().map_err(CommandError::from)?,
        id,
    )
    .map_err(CommandError::from)
}
