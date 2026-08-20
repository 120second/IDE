use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{AppError, CommandError},
    lsp::{LspPosition, LspStartResult, LspTextChange},
    state::AppState,
};

#[tauri::command]
pub async fn start_clangd(
    clangd_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LspStartResult, CommandError> {
    let manager = state.lsp.clone();
    let performance = state.performance.clone();
    let workspace_root = state.active_workspace_root().map_err(CommandError::from)?;
    blocking(move || {
        manager.start(workspace_root, clangd_path, move |event| {
            performance.record_ipc_event();
            if let Err(error) = app.emit("lsp-event", event) {
                log::warn!("failed to emit LSP event: {error}");
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn stop_clangd(state: State<'_, AppState>) -> Result<(), CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.stop()).await
}

#[tauri::command]
pub async fn lsp_did_open(
    path: String,
    text: String,
    version: i64,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.did_open(&path, text, version)).await
}

#[tauri::command]
pub async fn lsp_did_change(
    path: String,
    version: i64,
    changes: Vec<LspTextChange>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.did_change(&path, version, changes)).await
}

#[tauri::command]
pub async fn lsp_did_save(path: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.did_save(&path)).await
}

#[tauri::command]
pub async fn lsp_did_close(path: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.did_close(&path)).await
}

#[tauri::command]
pub async fn lsp_completion(
    path: String,
    position: LspPosition,
    context: Value,
    request_id: u64,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.completion(&path, position, context, request_id)).await
}

#[tauri::command]
pub async fn lsp_hover(
    path: String,
    position: LspPosition,
    request_id: u64,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    position_request("textDocument/hover", path, position, request_id, state).await
}

#[tauri::command]
pub async fn lsp_definition(
    path: String,
    position: LspPosition,
    request_id: u64,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    position_request("textDocument/definition", path, position, request_id, state).await
}

#[tauri::command]
pub async fn lsp_signature_help(
    path: String,
    position: LspPosition,
    request_id: u64,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    position_request(
        "textDocument/signatureHelp",
        path,
        position,
        request_id,
        state,
    )
    .await
}

#[tauri::command]
pub async fn lsp_references(
    path: String,
    position: LspPosition,
    request_id: u64,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.references(&path, position, request_id)).await
}

#[tauri::command]
pub async fn cancel_lsp_request(
    request_id: u64,
    state: State<'_, AppState>,
) -> Result<bool, CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.cancel(request_id)).await
}

async fn position_request(
    method: &'static str,
    path: String,
    position: LspPosition,
    request_id: u64,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let manager = state.lsp.clone();
    blocking(move || manager.position_request(method, &path, position, request_id)).await
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
                "LSP task could not be joined: {error}"
            )))
        })?
        .map_err(CommandError::from)
}
