use tauri::State;

use crate::{
    error::CommandError,
    server_api::{
        auth::AuthUser,
        community::{self, ChatMessage, CommunityUser, Conversation},
    },
    state::AppState,
};

#[tauri::command]
pub async fn update_community_profile(
    display_name: String,
    bio: String,
    location: String,
    avatar_data_url: String,
    state: State<'_, AppState>,
) -> Result<AuthUser, CommandError> {
    community::update_profile(
        &state.server_api,
        &display_name,
        &bio,
        &location,
        &avatar_data_url,
    )
    .await
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn search_community_users(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<CommunityUser>, CommandError> {
    community::search_users(&state.server_api, &query)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn list_conversations(
    state: State<'_, AppState>,
) -> Result<Vec<Conversation>, CommandError> {
    community::list_conversations(&state.server_api)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn list_chat_messages(
    user_id: String,
    before_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ChatMessage>, CommandError> {
    community::list_messages(&state.server_api, &user_id, before_id.as_deref())
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn send_chat_message(
    recipient_id: String,
    body: String,
    state: State<'_, AppState>,
) -> Result<ChatMessage, CommandError> {
    community::send_message(&state.server_api, &recipient_id, &body)
        .await
        .map_err(CommandError::from)
}
