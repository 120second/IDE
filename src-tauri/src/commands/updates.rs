use crate::updates::{self, UpdateCheck};

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<UpdateCheck, String> {
    updates::check(&app.package_info().version.to_string()).await
}

#[tauri::command(async)]
pub fn open_update_url(url: String) -> Result<(), String> {
    let parsed = updates::validate_update_url(&url)?;
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(parsed.as_str())
        .spawn()
        .map_err(|_| "无法打开浏览器，请稍后重试。".to_owned())?;
    Ok(())
}
