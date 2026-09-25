pub mod auth;
pub mod templates;

use std::time::Duration;

use reqwest::{Method, RequestBuilder, StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

const DEFAULT_API_BASE_URL: &str = "https://114.55.109.162/lightcp-api";
const CREDENTIAL_SERVICE: &str = "com.lightcp.ide";
const CREDENTIAL_USER: &str = "lightcp-access-token";

#[derive(Clone)]
pub struct ServerApi {
    base_url: String,
    client: reqwest::Client,
    app_handle: AppHandle,
}

#[derive(Debug, Deserialize)]
struct ErrorEnvelope {
    error: RemoteError,
}

#[derive(Debug, Deserialize)]
struct RemoteError {
    #[allow(dead_code)]
    code: String,
    message: String,
}

impl ServerApi {
    pub fn new(app_handle: AppHandle) -> AppResult<Self> {
        let base_url = std::env::var("LIGHTCP_API_BASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| option_env!("LIGHTCP_API_BASE_URL").map(str::to_owned))
            .unwrap_or_else(|| DEFAULT_API_BASE_URL.to_owned());
        let base_url = base_url.trim().trim_end_matches('/').to_owned();
        validate_base_url(&base_url)?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(20))
            .user_agent(format!("LightCP/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| AppError::Configuration(error.to_string()))?;
        Ok(Self {
            base_url,
            client,
            app_handle,
        })
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str, authenticated: bool) -> AppResult<T> {
        self.execute(self.request(Method::GET, path), authenticated)
            .await
    }

    pub async fn get_query<T, Q>(&self, path: &str, query: &Q) -> AppResult<T>
    where
        T: DeserializeOwned,
        Q: Serialize + ?Sized,
    {
        self.execute(self.request(Method::GET, path).query(query), true)
            .await
    }

    pub async fn post<T, B>(&self, path: &str, body: &B, authenticated: bool) -> AppResult<T>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        self.execute(self.request(Method::POST, path).json(body), authenticated)
            .await
    }

    pub async fn put<T, B>(&self, path: &str, body: &B) -> AppResult<T>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        self.execute(self.request(Method::PUT, path).json(body), true)
            .await
    }

    pub async fn send_empty<B: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> AppResult<()> {
        let request = self.request(method, path);
        let request = if let Some(body) = body {
            request.json(body)
        } else {
            request
        };
        let response = self.send(request, true).await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(response_error(response).await)
        }
    }

    async fn execute<T: DeserializeOwned>(
        &self,
        request: RequestBuilder,
        authenticated: bool,
    ) -> AppResult<T> {
        let response = self.send(request, authenticated).await?;
        if !response.status().is_success() {
            return Err(response_error(response).await);
        }
        response
            .json::<T>()
            .await
            .map_err(|error| AppError::Server(format!("invalid server response: {error}")))
    }

    async fn send(
        &self,
        request: RequestBuilder,
        authenticated: bool,
    ) -> AppResult<reqwest::Response> {
        let request = if authenticated {
            let token = load_access_token()?
                .ok_or_else(|| AppError::Authentication("no access token is stored".to_owned()))?;
            request.bearer_auth(token)
        } else {
            request
        };
        let response = request
            .send()
            .await
            .map_err(|error| AppError::Network(error.to_string()))?;
        if authenticated && response.status() == StatusCode::UNAUTHORIZED {
            let _ = delete_access_token();
            let _ = self.app_handle.emit("auth-expired", ());
        }
        Ok(response)
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        self.client
            .request(method, format!("{}{path}", self.base_url))
    }
}

fn validate_base_url(base_url: &str) -> AppResult<()> {
    let parsed = Url::parse(base_url).map_err(|error| {
        AppError::Configuration(format!("LIGHTCP_API_BASE_URL is invalid: {error}"))
    })?;
    let is_https = parsed.scheme() == "https";
    let is_loopback_http = parsed.scheme() == "http"
        && matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if is_https || is_loopback_http {
        return Ok(());
    }
    Err(AppError::Configuration(
        "LIGHTCP_API_BASE_URL must use HTTPS or HTTP on a loopback address".to_owned(),
    ))
}

async fn response_error(response: reqwest::Response) -> AppError {
    let status = response.status();
    let message = response
        .json::<ErrorEnvelope>()
        .await
        .map(|value| value.error.message)
        .unwrap_or_else(|_| format!("server returned HTTP {status}"));
    if status == StatusCode::UNAUTHORIZED {
        AppError::Authentication(message)
    } else {
        AppError::Server(message)
    }
}

pub fn save_access_token(token: &str) -> AppResult<()> {
    credential_entry()?
        .set_password(token)
        .map_err(|error| AppError::Configuration(format!("could not store access token: {error}")))
}

pub fn load_access_token() -> AppResult<Option<String>> {
    match credential_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(AppError::Configuration(format!(
            "could not read access token: {error}"
        ))),
    }
}

pub fn delete_access_token() -> AppResult<()> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Configuration(format!(
            "could not delete access token: {error}"
        ))),
    }
}

fn credential_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER)
        .map_err(|error| AppError::Configuration(format!("credential store unavailable: {error}")))
}

#[cfg(test)]
mod tests {
    use super::validate_base_url;

    #[test]
    fn development_tunnel_accepts_loopback_http() {
        assert!(validate_base_url("http://127.0.0.1:18100/api").is_ok());
        assert!(validate_base_url("http://localhost:18100/api").is_ok());
    }

    #[test]
    fn public_endpoints_require_https() {
        assert!(validate_base_url("https://api.example.com/api").is_ok());
        assert!(validate_base_url("http://api.example.com/api").is_err());
    }

    #[test]
    fn http_rejects_non_loopback_hosts() {
        assert!(validate_base_url("http://114.55.109.162:8100/api").is_err());
        assert!(validate_base_url("http://127.0.0.1.example.com/api").is_err());
    }
}
