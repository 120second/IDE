use std::path::PathBuf;
use std::time::Instant;

use tauri::State;

use crate::{
    archive,
    error::{AppError, CommandError},
    filesystem::{
        self as fs_core, FileContent, FileEntry, FileRevision, PathResult, WorkspaceFileResponse,
        WriteTextResult,
    },
    state::AppState,
};

#[tauri::command(async)]
pub fn list_directory(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileEntry>, CommandError> {
    let started = Instant::now();
    let root = active_root(&state)?;
    let is_workspace_root = dunce::canonicalize(&path).ok().is_some_and(|candidate| {
        crate::paths::is_within(&root, &candidate) && crate::paths::is_within(&candidate, &root)
    });
    let entries = fs_core::list_directory(&root, &path).map_err(CommandError::from)?;
    archive::register_entries(&state.paths.database_file, &root, &entries)
        .map_err(CommandError::from)?;
    if is_workspace_root {
        state.performance.set_workspace_load_duration(
            started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        );
    }
    Ok(entries)
}

#[tauri::command]
pub async fn find_workspace_files(
    query: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceFileResponse, CommandError> {
    let root = active_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || fs_core::find_workspace_files(&root, &query))
        .await
        .map_err(|error| {
            CommandError::from(AppError::Internal(format!(
                "workspace file search task could not be joined: {error}"
            )))
        })?
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn read_text_file(
    path: String,
    state: State<'_, AppState>,
) -> Result<FileContent, CommandError> {
    let root = active_root(&state)?;
    let read_root = root.clone();
    let content =
        tauri::async_runtime::spawn_blocking(move || fs_core::read_text_file(&read_root, &path))
            .await
            .map_err(|error| {
                CommandError::from(AppError::Internal(format!(
                    "file read task could not be joined: {error}"
                )))
            })?
            .map_err(CommandError::from)?;

    let database_file = state.paths.database_file.clone();
    let opened_path = content.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = archive::record_opened(&database_file, &root, &opened_path) {
            log::warn!("failed to record opened file {opened_path}: {error}");
        }
    });
    Ok(content)
}

#[tauri::command(async)]
pub fn get_text_file_revision(
    path: String,
    state: State<'_, AppState>,
) -> Result<FileRevision, CommandError> {
    fs_core::get_text_file_revision(&active_root(&state)?, &path).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn write_text_file(
    path: String,
    content: String,
    expected_revision: String,
    state: State<'_, AppState>,
) -> Result<WriteTextResult, CommandError> {
    fs_core::write_text_file(&active_root(&state)?, &path, &content, &expected_revision)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn create_file(
    parent: String,
    name: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<PathResult, CommandError> {
    let root = active_root(&state)?;
    let result =
        fs_core::create_file(&root, &parent, &name, &content).map_err(CommandError::from)?;
    archive::register_path(&state.paths.database_file, &root, &result.path)
        .map_err(CommandError::from)?;
    Ok(result)
}

#[tauri::command(async)]
pub fn create_directory(
    parent: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<PathResult, CommandError> {
    fs_core::create_directory(&active_root(&state)?, &parent, &name).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn rename_entry(
    path: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<PathResult, CommandError> {
    let root = active_root(&state)?;
    let result = fs_core::rename_entry(&root, &path, &new_name).map_err(CommandError::from)?;
    archive::sync_renamed_path(&state.paths.database_file, &root, &path, &result.path)
        .map_err(CommandError::from)?;
    Ok(result)
}

#[tauri::command(async)]
pub fn delete_entry(path: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    let root = active_root(&state)?;
    fs_core::delete_entry(&root, &path).map_err(CommandError::from)?;
    archive::sync_deleted_path(&state.paths.database_file, &root, &path).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn move_entry(
    source: String,
    target_directory: String,
    state: State<'_, AppState>,
) -> Result<PathResult, CommandError> {
    let root = active_root(&state)?;
    let result =
        fs_core::move_entry(&root, &source, &target_directory).map_err(CommandError::from)?;
    archive::sync_renamed_path(&state.paths.database_file, &root, &source, &result.path)
        .map_err(CommandError::from)?;
    Ok(result)
}

fn active_root(state: &State<'_, AppState>) -> Result<PathBuf, CommandError> {
    state
        .workspace
        .lock()
        .map_err(|_| {
            CommandError::from(AppError::Internal(
                "workspace state lock was poisoned".to_owned(),
            ))
        })?
        .root
        .clone()
        .ok_or_else(|| {
            CommandError::from(AppError::FileSystemOperation(
                "no workspace is currently open".to_owned(),
            ))
        })
}
