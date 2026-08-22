use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const MAX_TABS: usize = 64;
const MAX_TAB_CONTENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOTAL_CONTENT_BYTES: usize = 128 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES: u64 = (MAX_TOTAL_CONTENT_BYTES + 2 * 1024 * 1024) as u64;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorRecoverySelection {
    pub anchor: usize,
    pub head: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorRecoveryTab {
    pub id: String,
    pub title: String,
    pub path: Option<String>,
    pub dirty: bool,
    pub deleted: bool,
    pub external_modified: bool,
    pub disk_revision: Option<String>,
    pub external_revision: Option<String>,
    pub eol: LineEnding,
    pub content: Option<String>,
    pub selection: EditorRecoverySelection,
    pub scroll_top: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorRecoverySnapshot {
    pub version: u8,
    pub workspace_path: Option<String>,
    pub active_tab_id: Option<String>,
    pub tabs: Vec<EditorRecoveryTab>,
}

pub fn load(path: &Path) -> AppResult<Option<EditorRecoverySnapshot>> {
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_SNAPSHOT_BYTES {
        return Err(recovery_error(format!(
            "editor recovery snapshot exceeds the {} MiB limit",
            MAX_SNAPSHOT_BYTES / 1024 / 1024
        )));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)?
        .take(MAX_SNAPSHOT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(recovery_error(
            "editor recovery snapshot grew beyond its size limit",
        ));
    }
    let snapshot = serde_json::from_slice::<EditorRecoverySnapshot>(&bytes).map_err(|error| {
        recovery_error(format!(
            "failed to parse editor recovery snapshot {}: {error}",
            path.display()
        ))
    })?;
    validate(&snapshot)?;
    Ok(Some(snapshot))
}

pub fn save(path: &Path, snapshot: &EditorRecoverySnapshot) -> AppResult<()> {
    validate(snapshot)?;
    let bytes = serde_json::to_vec(snapshot).map_err(|error| {
        AppError::Internal(format!(
            "failed to serialize editor recovery snapshot: {error}"
        ))
    })?;
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(recovery_error(
            "serialized editor recovery snapshot is too large",
        ));
    }
    atomic_write(path, &bytes)
}

fn validate(snapshot: &EditorRecoverySnapshot) -> AppResult<()> {
    if snapshot.version != 1 {
        return Err(recovery_error(
            "unsupported editor recovery snapshot version",
        ));
    }
    if snapshot.tabs.len() > MAX_TABS {
        return Err(recovery_error(format!(
            "editor recovery snapshot contains more than {MAX_TABS} tabs"
        )));
    }
    if snapshot
        .workspace_path
        .as_deref()
        .is_some_and(|path| path.len() > 4096)
        || snapshot
            .active_tab_id
            .as_deref()
            .is_some_and(|id| id.len() > 256)
    {
        return Err(recovery_error("editor recovery metadata is too long"));
    }
    let mut total_content = 0_usize;
    let mut ids = HashSet::new();
    for tab in &snapshot.tabs {
        if tab.id.is_empty()
            || !ids.insert(tab.id.as_str())
            || tab.id.len() > 256
            || tab.title.is_empty()
            || tab.title.len() > 512
            || tab.path.as_deref().is_some_and(|path| path.len() > 4096)
            || tab
                .disk_revision
                .as_deref()
                .is_some_and(|revision| revision.len() > 256)
            || tab
                .external_revision
                .as_deref()
                .is_some_and(|revision| revision.len() > 256)
            || !tab.scroll_top.is_finite()
            || tab.scroll_top < 0.0
        {
            return Err(recovery_error("editor recovery tab metadata is invalid"));
        }
        if (tab.dirty || tab.deleted || tab.path.is_none()) && tab.content.is_none() {
            return Err(recovery_error(format!(
                "editor recovery content is missing for {}",
                tab.title
            )));
        }
        if let Some(content) = &tab.content {
            if content.len() > MAX_TAB_CONTENT_BYTES {
                return Err(recovery_error(format!(
                    "editor recovery content for {} exceeds 16 MiB",
                    tab.title
                )));
            }
            total_content = total_content.saturating_add(content.len());
            if total_content > MAX_TOTAL_CONTENT_BYTES {
                return Err(recovery_error(
                    "editor recovery content exceeds 128 MiB in total",
                ));
            }
        }
    }
    Ok(())
}

fn atomic_write(target: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = target.parent().ok_or_else(|| {
        recovery_error(format!("recovery file has no parent: {}", target.display()))
    })?;
    fs::create_dir_all(parent)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| recovery_error(format!("system clock is invalid: {error}")))?
        .as_nanos();
    let temporary = parent.join(format!(
        ".lightcp-recovery-{}-{nonce}.tmp",
        std::process::id()
    ));
    let result = (|| -> AppResult<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&temporary, target)?;
        sync_parent_directory(target)
    })();
    if temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(windows)]
fn atomic_replace(source: &Path, target: &Path) -> AppResult<()> {
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = wide_path(source);
    let target = wide_path(target);
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, target: &Path) -> AppResult<()> {
    fs::rename(source, target)?;
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(target: &Path) -> AppResult<()> {
    let parent = target.parent().ok_or_else(|| {
        recovery_error(format!("recovery file has no parent: {}", target.display()))
    })?;
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_target: &Path) -> AppResult<()> {
    Ok(())
}

fn recovery_error(message: impl Into<String>) -> AppError {
    AppError::FileSystemOperation(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_snapshot_round_trips_atomically() {
        let directory = temporary_directory("roundtrip");
        let path = directory.join("editor-session.json");
        let snapshot = sample_snapshot("int main() {}\r\n");

        save(&path, &snapshot).expect("save recovery snapshot");
        let loaded = load(&path)
            .expect("load recovery snapshot")
            .expect("snapshot exists");

        assert_eq!(loaded.tabs.len(), 1);
        assert_eq!(loaded.tabs[0].content.as_deref(), Some("int main() {}\r\n"));
        assert!(fs::read_dir(&directory)
            .expect("recovery directory")
            .all(|entry| !entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .starts_with(".lightcp-recovery-")));
        fs::remove_dir_all(directory).expect("cleanup recovery directory");
    }

    #[test]
    fn invalid_snapshot_does_not_replace_the_last_valid_generation() {
        let directory = temporary_directory("preserve-valid");
        let path = directory.join("editor-session.json");
        let valid = sample_snapshot("saved");
        save(&path, &valid).expect("initial recovery snapshot");
        let mut invalid = sample_snapshot("new");
        invalid.version = 2;

        assert!(save(&path, &invalid).is_err());
        let loaded = load(&path)
            .expect("load recovery snapshot")
            .expect("snapshot exists");
        assert_eq!(loaded.tabs[0].content.as_deref(), Some("saved"));
        fs::remove_dir_all(directory).expect("cleanup recovery directory");
    }

    fn sample_snapshot(content: &str) -> EditorRecoverySnapshot {
        EditorRecoverySnapshot {
            version: 1,
            workspace_path: Some(r"C:\Code".to_owned()),
            active_tab_id: Some("tab-1".to_owned()),
            tabs: vec![EditorRecoveryTab {
                id: "tab-1".to_owned(),
                title: "main.cpp".to_owned(),
                path: Some(r"C:\Code\main.cpp".to_owned()),
                dirty: true,
                deleted: false,
                external_modified: false,
                disk_revision: Some("1:1".to_owned()),
                external_revision: None,
                eol: LineEnding::Crlf,
                content: Some(content.to_owned()),
                selection: EditorRecoverySelection { anchor: 1, head: 1 },
                scroll_top: 12.0,
            }],
        }
    }

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "lightcp-recovery-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        fs::create_dir(&path).expect("temporary recovery directory");
        path
    }
}
