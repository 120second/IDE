use std::{
    collections::HashMap,
    path::Path,
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use tauri::{AppHandle, Emitter};

use crate::archive;
use crate::error::{AppError, AppResult};
use crate::performance::PerformanceMetrics;

use super::WorkspaceChange;

pub struct WorkspaceWatcher {
    _watcher: RecommendedWatcher,
    sender: mpsc::Sender<WatchMessage>,
    worker: Option<thread::JoinHandle<()>>,
}

enum WatchMessage {
    Event(notify::Result<Event>),
    Stop,
}

const WATCH_BATCH_INTERVAL: Duration = Duration::from_millis(75);

impl WorkspaceWatcher {
    pub fn start(
        root: &Path,
        database_path: &Path,
        app: AppHandle,
        performance: Arc<PerformanceMetrics>,
    ) -> AppResult<Self> {
        let watched_root = root.to_path_buf();
        let archive_database = database_path.to_path_buf();
        let (sender, receiver) = mpsc::channel();
        let callback_sender = sender.clone();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            let _ = callback_sender.send(WatchMessage::Event(result));
        })
        .map_err(|error| AppError::FileSystemOperation(error.to_string()))?;

        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|error| AppError::FileSystemOperation(error.to_string()))?;

        log::info!(
            "watching workspace with native filesystem events: {}",
            root.display()
        );
        let worker = thread::spawn(move || {
            watch_worker(receiver, app, archive_database, watched_root, performance);
        });
        Ok(Self {
            _watcher: watcher,
            sender,
            worker: Some(worker),
        })
    }
}

impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
        let _ = self.sender.send(WatchMessage::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn watch_worker(
    receiver: mpsc::Receiver<WatchMessage>,
    app: AppHandle,
    database_path: std::path::PathBuf,
    root: std::path::PathBuf,
    performance: Arc<PerformanceMetrics>,
) {
    let mut pending_rename = None;
    loop {
        let first = match receiver.recv() {
            Ok(WatchMessage::Event(result)) => result,
            Ok(WatchMessage::Stop) | Err(_) => return,
        };
        let mut events = vec![first];
        let deadline = Instant::now() + WATCH_BATCH_INTERVAL;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match receiver.recv_timeout(remaining) {
                Ok(WatchMessage::Event(result)) => events.push(result),
                Ok(WatchMessage::Stop) => return,
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }

        let mut changes = Vec::new();
        for result in events {
            match result {
                Ok(event) => changes.extend(changes_for_event(event, &mut pending_rename)),
                Err(error) => log::error!("workspace watcher error: {error}"),
            }
        }
        let changes = coalesce_changes(changes);
        if changes.is_empty() {
            continue;
        }
        for change in &changes {
            if let Err(error) = sync_archive_change(&database_path, &root, change) {
                log::warn!("failed to synchronize archive metadata for file event: {error}");
            }
        }
        performance.record_ipc_event();
        if let Err(error) = app.emit("workspace-changed", changes) {
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
        "created" => archive::register_paths(database_path, root, &change.paths)?,
        "deleted" => archive::sync_deleted_paths(database_path, root, &change.paths)?,
        "renamed" if change.paths.len() >= 2 => {
            archive::sync_renamed_path(database_path, root, &change.paths[0], &change.paths[1])?;
        }
        _ => {}
    }
    Ok(())
}

fn coalesce_changes(changes: Vec<WorkspaceChange>) -> Vec<WorkspaceChange> {
    let mut grouped: HashMap<&'static str, HashMap<String, String>> = HashMap::new();
    let mut renamed = Vec::new();
    for change in changes {
        if change.kind == "renamed" {
            if let Some(previous) = change.paths.first() {
                if let Some(deleted) = grouped.get_mut("deleted") {
                    deleted.remove(&path_key(previous));
                }
            }
            renamed.push(change);
            continue;
        }
        let paths = grouped.entry(change.kind).or_default();
        for path in change.paths {
            paths.insert(path_key(&path), path);
        }
    }
    let created_paths = grouped
        .get("created")
        .map(|paths| paths.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for created in created_paths {
        if let Some(changed) = grouped.get_mut("changed") {
            changed.remove(&created);
        }
    }
    let replacements = grouped
        .get("created")
        .map(|created| {
            created
                .keys()
                .filter(|path| {
                    grouped
                        .get("deleted")
                        .is_some_and(|deleted| deleted.contains_key(*path))
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for path in replacements {
        let original = grouped
            .get_mut("created")
            .and_then(|created| created.remove(&path));
        if let Some(deleted) = grouped.get_mut("deleted") {
            deleted.remove(&path);
        }
        if let Some(original) = original {
            grouped.entry("changed").or_default().insert(path, original);
        }
    }
    for kind in ["deleted", "created", "changed"] {
        let Some(paths) = grouped.remove(kind) else {
            continue;
        };
        if !paths.is_empty() {
            renamed.push(WorkspaceChange {
                kind,
                paths: paths.into_values().collect(),
            });
        }
    }
    renamed
}

fn path_key(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

fn changes_for_event(event: Event, pending_rename: &mut Option<String>) -> Vec<WorkspaceChange> {
    let mut paths = event
        .paths
        .iter()
        .map(|path| dunce::simplified(path).to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let contained_save_temporary = paths.iter().any(|path| is_save_temporary(path));
    paths.retain(|path| !is_save_temporary(path));
    if paths.is_empty() {
        return Vec::new();
    }
    if contained_save_temporary && matches!(&event.kind, EventKind::Modify(ModifyKind::Name(_))) {
        *pending_rename = None;
        return vec![WorkspaceChange {
            kind: "changed",
            paths,
        }];
    }

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

fn is_save_temporary(path: &str) -> bool {
    path.replace('/', "\\")
        .rsplit('\\')
        .next()
        .is_some_and(|name| name.starts_with(".lightcp-save-") && name.ends_with(".tmp"))
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

    #[test]
    fn watcher_changes_are_coalesced_into_one_ipc_batch() {
        let changes = (0..5_000)
            .map(|index| WorkspaceChange {
                kind: "changed",
                paths: vec![format!(r"C:\题目\{index}.cpp")],
            })
            .collect();
        let batched = coalesce_changes(changes);
        assert_eq!(batched.len(), 1);
        assert_eq!(batched[0].paths.len(), 5_000);
    }

    #[test]
    fn atomic_file_replacement_is_reported_as_change() {
        let path = r"C:\题目\main.cpp".to_owned();
        let batched = coalesce_changes(vec![
            WorkspaceChange {
                kind: "deleted",
                paths: vec![path.clone()],
            },
            WorkspaceChange {
                kind: "created",
                paths: vec![path.clone()],
            },
        ]);
        assert_eq!(batched.len(), 1);
        assert_eq!(batched[0].kind, "changed");
        assert_eq!(batched[0].paths, vec![path]);
    }

    #[test]
    fn internal_save_temporary_is_hidden_from_workspace_events() {
        let mut pending = None;
        let temporary = changes_for_event(
            Event::new(EventKind::Create(notify::event::CreateKind::File))
                .add_path(PathBuf::from(r"C:\题目\.lightcp-save-1-2-0.tmp")),
            &mut pending,
        );
        assert!(temporary.is_empty());

        let replacement = changes_for_event(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
                .add_path(PathBuf::from(r"C:\题目\.lightcp-save-1-2-0.tmp"))
                .add_path(PathBuf::from(r"C:\题目\main.cpp")),
            &mut pending,
        );
        assert_eq!(replacement.len(), 1);
        assert_eq!(replacement[0].kind, "changed");
        assert_eq!(replacement[0].paths, vec![r"C:\题目\main.cpp"]);
    }
}
