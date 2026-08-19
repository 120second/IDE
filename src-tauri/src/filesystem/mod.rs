mod model;
mod service;
mod watcher;

use std::path::PathBuf;

pub use model::{EntryKind, FileContent, FileEntry, PathResult, WorkspaceChange, WorkspaceInfo};
pub use service::{
    canonical_workspace, create_directory, create_file, delete_entry, list_directory, move_entry,
    read_text_file, rename_entry, write_text_file,
};
pub use watcher::WorkspaceWatcher;

#[derive(Default)]
pub struct WorkspaceRuntime {
    pub root: Option<PathBuf>,
    pub watcher: Option<WorkspaceWatcher>,
}
