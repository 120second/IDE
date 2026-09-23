use tauri::State;

use crate::{
    error::CommandError,
    server_api::auth::{self, AuthUser},
    state::AppState,
};

#[tauri::command]
pub async fn auth_restore(state: State<'_, AppState>) -> Result<Option<AuthUser>, CommandError> {
    auth::restore(&state.server_api)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn auth_register(
    username: String,
    email: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<AuthUser, CommandError> {
    auth::register(&state.server_api, &username, &email, &password)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn auth_login(
    identifier: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<AuthUser, CommandError> {
    auth::login(&state.server_api, &identifier, &password)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn auth_me(state: State<'_, AppState>) -> Result<AuthUser, CommandError> {
    auth::me(&state.server_api)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn auth_logout() -> Result<(), CommandError> {
    auth::logout().map_err(CommandError::from)
}

#[tauri::command]
pub async fn auth_forgot_password(
    email: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    auth::forgot_password(&state.server_api, &email)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn auth_reset_password(
    email: String,
    code: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    auth::reset_password(&state.server_api, &email, &code, &new_password)
        .await
        .map_err(CommandError::from)
}
