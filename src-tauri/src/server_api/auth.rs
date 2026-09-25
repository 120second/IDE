use serde::{Deserialize, Serialize};

use crate::error::AppResult;

use super::{delete_access_token, load_access_token, save_access_token, ServerApi};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: String,
    pub username: String,
    pub email: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    access_token: String,
    #[allow(dead_code)]
    token_type: String,
    #[allow(dead_code)]
    expires_at: String,
    user: AuthUser,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterRequest<'a> {
    username: &'a str,
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
struct LoginRequest<'a> {
    identifier: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
struct ForgotPasswordRequest<'a> {
    email: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResetPasswordRequest<'a> {
    email: &'a str,
    code: &'a str,
    new_password: &'a str,
}

#[derive(Deserialize)]
struct MessageResponse {
    #[allow(dead_code)]
    message: String,
}

pub async fn register(
    api: &ServerApi,
    username: &str,
    email: &str,
    password: &str,
) -> AppResult<AuthUser> {
    let response: TokenResponse = api
        .post(
            "/auth/register",
            &RegisterRequest {
                username,
                email,
                password,
            },
            false,
        )
        .await?;
    save_access_token(&response.access_token)?;
    Ok(response.user)
}

pub async fn login(api: &ServerApi, identifier: &str, password: &str) -> AppResult<AuthUser> {
    let response: TokenResponse = api
        .post(
            "/auth/login",
            &LoginRequest {
                identifier,
                password,
            },
            false,
        )
        .await?;
    save_access_token(&response.access_token)?;
    Ok(response.user)
}

pub async fn restore(api: &ServerApi) -> AppResult<Option<AuthUser>> {
    if load_access_token()?.is_none() {
        // Verify the optional cloud service even when there is no saved login,
        // so the settings status reflects real connectivity.
        let _: serde_json::Value = api.get("/health", false).await?;
        return Ok(None);
    }
    match api.get::<AuthUser>("/auth/me", true).await {
        Ok(user) => Ok(Some(user)),
        Err(crate::error::AppError::Authentication(_)) => {
            delete_access_token()?;
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

pub async fn me(api: &ServerApi) -> AppResult<AuthUser> {
    api.get("/auth/me", true).await
}

pub fn logout() -> AppResult<()> {
    delete_access_token()
}

pub async fn forgot_password(api: &ServerApi, email: &str) -> AppResult<()> {
    let _: MessageResponse = api
        .post(
            "/auth/forgot-password",
            &ForgotPasswordRequest { email },
            false,
        )
        .await?;
    Ok(())
}

pub async fn reset_password(
    api: &ServerApi,
    email: &str,
    code: &str,
    new_password: &str,
) -> AppResult<()> {
    let _: MessageResponse = api
        .post(
            "/auth/reset-password",
            &ResetPasswordRequest {
                email,
                code,
                new_password,
            },
            false,
        )
        .await?;
    Ok(())
}
