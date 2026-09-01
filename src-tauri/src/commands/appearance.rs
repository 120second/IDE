use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::State;

use crate::{
    error::{AppError, AppResult, CommandError},
    state::AppState,
};

const MAX_BACKGROUND_BYTES: u64 = 32 * 1024 * 1024;
const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "avif"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundImageSelection {
    path: String,
    name: String,
}

#[tauri::command]
pub fn install_background_image(
    path: String,
    state: State<'_, AppState>,
) -> Result<BackgroundImageSelection, CommandError> {
    install_background_image_into(Path::new(&path), &state.paths.data_dir)
        .map_err(CommandError::from)
}

fn install_background_image_into(
    source: &Path,
    data_dir: &Path,
) -> AppResult<BackgroundImageSelection> {
    let metadata = fs::metadata(source)?;
    if !metadata.is_file() {
        return Err(AppError::Configuration(
            "background image must be a regular file".to_owned(),
        ));
    }
    if metadata.len() > MAX_BACKGROUND_BYTES {
        return Err(AppError::Configuration(
            "background image must not exceed 32 MiB".to_owned(),
        ));
    }

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| SUPPORTED_EXTENSIONS.contains(&value.as_str()))
        .ok_or_else(|| {
            AppError::Configuration(
                "background image must use PNG, JPEG, WebP, or AVIF format".to_owned(),
            )
        })?;
    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("背景图片")
        .chars()
        .take(256)
        .collect::<String>();

    let background_dir = data_dir.join("backgrounds");
    fs::create_dir_all(&background_dir)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Internal(format!("system clock is invalid: {error}")))?
        .as_millis();
    let destination = background_dir.join(format!("background-{timestamp}.{extension}"));
    fs::copy(source, &destination)?;
    remove_previous_backgrounds(&background_dir, &destination);

    Ok(BackgroundImageSelection {
        path: destination.to_string_lossy().into_owned(),
        name: original_name,
    })
}

fn remove_previous_backgrounds(background_dir: &Path, keep: &Path) {
    let Ok(entries) = fs::read_dir(background_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep || !is_managed_background(&path) {
            continue;
        }
        if let Err(error) = fs::remove_file(&path) {
            log::warn!(
                "could not remove previous background image {}: {error}",
                path.display()
            );
        }
    }
}

fn is_managed_background(path: &Path) -> bool {
    path.file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.starts_with("background-"))
        && path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .is_some_and(|value| SUPPORTED_EXTENSIONS.contains(&value.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temporary_directory(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "lightcp-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be available")
                .as_nanos()
        ))
    }

    #[test]
    fn imports_supported_background_into_managed_directory() {
        let root = temporary_directory("background-import");
        fs::create_dir_all(&root).expect("temporary directory should be created");
        let source = root.join("wallpaper.png");
        fs::write(&source, b"test-image").expect("source should be written");

        let selection = install_background_image_into(&source, &root)
            .expect("supported image should be imported");
        let installed = PathBuf::from(&selection.path);

        assert_eq!(selection.name, "wallpaper.png");
        assert!(installed.starts_with(root.join("backgrounds")));
        assert_eq!(
            fs::read(installed).expect("copy should exist"),
            b"test-image"
        );
        fs::remove_dir_all(root).expect("temporary directory should be removed");
    }

    #[test]
    fn rejects_unsupported_background_extension() {
        let root = temporary_directory("background-reject");
        fs::create_dir_all(&root).expect("temporary directory should be created");
        let source = root.join("wallpaper.txt");
        fs::write(&source, b"not-an-image").expect("source should be written");

        assert!(install_background_image_into(&source, &root).is_err());
        fs::remove_dir_all(root).expect("temporary directory should be removed");
    }
}
