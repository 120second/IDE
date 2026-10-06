use serde::{Deserialize, Serialize};

use crate::error::AppResult;

use super::{auth::AuthUser, ServerApi};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityUser {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub bio: String,
    pub location: String,
    pub avatar_data_url: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub sender_id: String,
    pub recipient_id: String,
    pub body: String,
    pub created_at: String,
    pub read_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub user: CommunityUser,
    pub last_message: ChatMessage,
    pub unread_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileUpdate<'a> {
    display_name: &'a str,
    bio: &'a str,
    location: &'a str,
    avatar_data_url: &'a str,
}

#[derive(Serialize)]
struct UserSearch<'a> {
    query: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageCreate<'a> {
    recipient_id: &'a str,
    body: &'a str,
}

pub async fn update_profile(
    api: &ServerApi,
    display_name: &str,
    bio: &str,
    location: &str,
    avatar_data_url: &str,
) -> AppResult<AuthUser> {
    api.put(
        "/community/profile",
        &ProfileUpdate {
            display_name,
            bio,
            location,
            avatar_data_url,
        },
    )
    .await
}

pub async fn search_users(api: &ServerApi, query: &str) -> AppResult<Vec<CommunityUser>> {
    api.get_query("/community/users", &UserSearch { query })
        .await
}

pub async fn list_conversations(api: &ServerApi) -> AppResult<Vec<Conversation>> {
    api.get("/community/conversations", true).await
}

pub async fn list_messages(api: &ServerApi, user_id: &str) -> AppResult<Vec<ChatMessage>> {
    api.get(&format!("/community/messages/{user_id}"), true)
        .await
}

pub async fn send_message(
    api: &ServerApi,
    recipient_id: &str,
    body: &str,
) -> AppResult<ChatMessage> {
    api.post(
        "/community/messages",
        &MessageCreate { recipient_id, body },
        true,
    )
    .await
}
