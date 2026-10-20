use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const RELEASES_API: &str = "https://api.github.com/repos/120second/IDE/releases?per_page=100";
pub const RELEASES_PAGE: &str = "https://github.com/120second/IDE/releases";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub status: &'static str,
    pub release: Option<ReleaseInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub name: String,
    pub notes: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub page_url: String,
    pub installer_url: Option<String>,
    pub portable_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

pub async fn check(current_version: &str) -> Result<UpdateCheck, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .user_agent(format!("LightCP/{current_version}"))
        .build()
        .map_err(|_| "无法初始化更新检查，请稍后重试。".to_owned())?;
    let mut response = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "检查更新超时，请检查网络后重试。".to_owned()
            } else {
                "无法连接 GitHub，请检查网络后重试，也可直接打开版本发布页。".to_owned()
            }
        })?;
    match response.status().as_u16() {
        200 => {}
        403 | 429 => return Err("GitHub 暂时限制了检查频率，请稍后重试或打开版本发布页。".into()),
        404 => return Err("暂时无法访问版本发布源，请稍后重试。".into()),
        status => return Err(format!("版本服务返回 HTTP {status}，请稍后重试。")),
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "更新信息接收失败，请重试。".to_owned())?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("版本信息过大，无法检查，请打开版本发布页。".into());
        }
        body.extend_from_slice(&chunk);
    }
    select_release(current_version, &body)
}

fn github_url(parts: &[&str]) -> String {
    let mut url = url::Url::parse(RELEASES_PAGE).expect("fixed release URL");
    url.path_segments_mut().expect("HTTPS URL").extend(parts);
    url.into()
}

fn select_release(current_version: &str, body: &[u8]) -> Result<UpdateCheck, String> {
    let current =
        Version::parse(current_version).map_err(|_| "当前应用版本无效，无法比较更新。")?;
    let releases: Vec<GithubRelease> = serde_json::from_slice(body)
        .map_err(|_| "版本服务返回的信息无效，请稍后重试或打开版本发布页。")?;
    let selected = releases
        .into_iter()
        .filter(|release| !release.draft)
        .filter_map(|release| {
            let version = Version::parse(
                release
                    .tag_name
                    .strip_prefix('v')
                    .unwrap_or(&release.tag_name),
            )
            .ok()?;
            // Stable users stay on stable releases; preview users can also receive previews.
            if current.pre.is_empty() && (release.prerelease || !version.pre.is_empty()) {
                return None;
            }
            Some((version, release))
        })
        .max_by(|(a, _), (b, _)| a.cmp_precedence(b));
    let Some((version, release)) = selected else {
        return Ok(UpdateCheck {
            current_version: current_version.into(),
            status: "noRelease",
            release: None,
        });
    };
    let asset_url = |suffix: &str| {
        let name = format!("LightCP_{version}_x64-{suffix}.exe");
        let expected = github_url(&["download", &release.tag_name, &name]);
        release
            .assets
            .iter()
            .find(|asset| asset.name == name && asset.browser_download_url == expected)
            .map(|_| expected)
    };
    let info = ReleaseInfo {
        version: version.to_string(),
        name: release
            .name
            .as_deref()
            .unwrap_or(&release.tag_name)
            .chars()
            .take(200)
            .collect(),
        notes: release
            .body
            .as_deref()
            .unwrap_or("")
            .chars()
            .take(12_000)
            .collect(),
        published_at: release.published_at.clone(),
        prerelease: release.prerelease || !version.pre.is_empty(),
        page_url: github_url(&["tag", &release.tag_name]),
        installer_url: asset_url("setup"),
        portable_url: asset_url("portable"),
    };
    Ok(UpdateCheck {
        current_version: current_version.into(),
        status: if version.cmp_precedence(&current).is_gt() {
            "updateAvailable"
        } else {
            "upToDate"
        },
        release: Some(info),
    })
}

pub fn validate_update_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "无效的版本链接。")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(url.path() == "/120second/IDE/releases"
            || url.path().starts_with("/120second/IDE/releases/"))
    {
        return Err("仅支持 LightCP 官方 GitHub 版本链接。".into());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str, prerelease: bool) -> serde_json::Value {
        json!({"tag_name":tag,"prerelease":prerelease,"assets":[]})
    }

    #[test]
    fn compares_numeric_preview_versions_and_ignores_drafts_and_invalid_tags() {
        let mut draft = release("v9.0.0", false);
        draft["draft"] = json!(true);
        let data = serde_json::to_vec(&json!([
            release("v0.1.1-dev.9", true),
            release("v0.1.1-dev.10", true),
            draft,
            release("nightly", true)
        ]))
        .unwrap();
        let result = select_release("0.1.1-dev.4", &data).unwrap();
        assert_eq!(result.status, "updateAvailable");
        assert_eq!(result.release.unwrap().version, "0.1.1-dev.10");
    }

    #[test]
    fn stable_users_do_not_receive_previews_and_newer_local_builds_are_not_downgraded() {
        let data = serde_json::to_vec(&json!([
            release("v0.2.0-dev.1", true),
            release("v0.1.1", false)
        ]))
        .unwrap();
        assert_eq!(select_release("0.1.1", &data).unwrap().status, "upToDate");
        assert_eq!(
            select_release("0.2.0-dev.2", &data).unwrap().status,
            "upToDate"
        );
        assert_eq!(
            select_release("0.1.0", &data)
                .unwrap()
                .release
                .unwrap()
                .version,
            "0.1.1"
        );
    }

    #[test]
    fn handles_empty_and_invalid_responses_without_claiming_latest() {
        assert_eq!(
            select_release("0.1.1-dev.4", b"[]").unwrap().status,
            "noRelease"
        );
        assert!(select_release("0.1.1", b"<html>error</html>").is_err());
    }

    #[test]
    fn only_exposes_matching_official_windows_downloads() {
        let data = serde_json::to_vec(&json!([{
            "tag_name":"v0.1.1-dev.5", "prerelease":true,
            "assets":[
                {"name":"LightCP_0.1.1-dev.5_x64-setup.exe","browser_download_url":"https://github.com/120second/IDE/releases/download/v0.1.1-dev.5/LightCP_0.1.1-dev.5_x64-setup.exe"},
                {"name":"LightCP_0.1.1-dev.5_x64-portable.exe","browser_download_url":"https://example.com/unsafe.exe"}
            ]
        }])).unwrap();
        let info = select_release("0.1.1-dev.4", &data)
            .unwrap()
            .release
            .unwrap();
        assert!(info.installer_url.is_some());
        assert!(info.portable_url.is_none());
        assert_eq!(
            info.page_url,
            "https://github.com/120second/IDE/releases/tag/v0.1.1-dev.5"
        );
        for url in [
            RELEASES_PAGE,
            info.page_url.as_str(),
            info.installer_url.as_deref().unwrap(),
        ] {
            assert!(validate_update_url(url).is_ok());
        }
        for url in [
            "https://example.com/",
            "file:///C:/bad.exe",
            "https://github.com/other/repo/releases",
            "https://github.com/120second/IDE/releases?redirect=bad",
            "https://user@github.com/120second/IDE/releases",
        ] {
            assert!(validate_update_url(url).is_err());
        }
    }

    #[test]
    #[ignore = "uses the public GitHub API; run explicitly for release verification"]
    fn live_github_release_check() {
        let result = tauri::async_runtime::block_on(check(env!("CARGO_PKG_VERSION"))).unwrap();
        assert_ne!(result.status, "noRelease");
        assert!(result.release.unwrap().page_url.starts_with(RELEASES_PAGE));
    }
}
