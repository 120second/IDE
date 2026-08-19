use std::path::Path;

use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use tauri::{AppHandle, Emitter};

use crate::archive;
use crate::error::{AppError, AppResult};

use super::WorkspaceChange;

pub struct WorkspaceWatcher {
    _watcher: RecommendedWatcher,
}

impl WorkspaceWatcher {
    pub fn start(root: &Path, database_path: &Path, app: AppHandle) -> AppResult<Self> {
        let mut pending_rename = None;
        let watched_root = root.to_path_buf();
        let archive_database = database_path.to_path_buf();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<Event>| match result {
                Ok(event) => emit_event(
                    &app,
                    event,
                    &mut pending_rename,
                    &archive_database,
                    &watched_root,
                ),
                Err(error) => log::error!("workspace watcher error: {error}"),
            })
            .map_err(|error| AppError::FileSystemOperation(error.to_string()))?;

        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|error| AppError::FileSystemOperation(error.to_string()))?;

        log::info!(
            "watching workspace with native filesystem events: {}",
            root.display()
        );
        Ok(Self { _watcher: watcher })
    }
}

fn emit_event(
    app: &AppHandle,
    event: Event,
    pending_rename: &mut Option<String>,
    database_path: &Path,
    root: &Path,
) {
    for payload in changes_for_event(event, pending_rename) {
        if let Err(error) = sync_archive_change(database_path, root, &payload) {
            log::warn!("failed to synchronize archive metadata for file event: {error}");
        }
        if let Err(error) = app.emit("workspace-changed", payload) {
            log::warn!("failed to emit workspace event: {error}");
        }
    }
}

fn sync_archive_change(
    database_path: &Path,
    root: &Path,
    change: &WorkspaceChange,
) -> AppResult<()> {
    match change.kind {
        "created" => {
            for path in &change.paths {
                archive::register_path(database_path, root, path)?;
            }
        }
        "deleted" => {
            for path in &change.paths {
                archive::sync_deleted_path(database_path, root, path)?;
            }
        }
        "renamed" if change.paths.len() >= 2 => {
            archive::sync_renamed_path(database_path, root, &change.paths[0], &change.paths[1])?;
        }
        _ => {}
    }
    Ok(())
}

fn changes_for_event(event: Event, pending_rename: &mut Option<String>) -> Vec<WorkspaceChange> {
    let paths = event
        .paths
        .iter()
        .map(|path| dunce::simplified(path).to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    match event.kind {
        EventKind::Create(_) => {
            *pending_rename = None;
            vec![WorkspaceChange {
                kind: "created",
                paths,
            }]
        }
        EventKind::Remove(_) => {
            *pending_rename = None;
            vec![WorkspaceChange {
                kind: "deleted",
                paths,
            }]
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            let Some(path) = paths.first().cloned() else {
                return Vec::new();
            };
            *pending_rename = Some(path.clone());
            // Windows emits From and To separately. Marking From as deleted also
            // correctly covers moves out of the watched workspace. A following
            // paired rename restores the tab with its new path.
            vec![WorkspaceChange {
                kind: "deleted",
                paths: vec![path],
            }]
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            let Some(next) = paths.first().cloned() else {
                return Vec::new();
            };
            if let Some(previous) = pending_rename.take() {
                vec![WorkspaceChange {
                    kind: "renamed",
                    paths: vec![previous, next],
                }]
            } else {
                vec![WorkspaceChange {
                    kind: "created",
                    paths: vec![next],
                }]
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if paths.len() >= 2 => {
            *pending_rename = None;
            vec![WorkspaceChange {
                kind: "renamed",
                paths,
            }]
        }
        EventKind::Modify(ModifyKind::Name(_)) => {
            *pending_rename = None;
            vec![WorkspaceChange {
                kind: "changed",
                paths,
            }]
        }
        EventKind::Modify(_) => {
            *pending_rename = None;
            vec![WorkspaceChange {
                kind: "changed",
                paths,
            }]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn windows_style_rename_events_are_paired() {
        let mut pending = None;
        let removed = changes_for_event(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
                .add_path(PathBuf::from(r"C:\题目\old.cpp")),
            &mut pending,
        );
        assert_eq!(removed[0].kind, "deleted");

        let renamed = changes_for_event(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
                .add_path(PathBuf::from(r"C:\题目\new.cpp")),
            &mut pending,
        );
        assert_eq!(renamed[0].kind, "renamed");
        assert_eq!(renamed[0].paths.len(), 2);
        assert!(renamed[0].paths[1].ends_with("new.cpp"));
        assert!(pending.is_none());
    }
}
