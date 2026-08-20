use std::{
    cmp::Ordering,
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use crate::error::{AppError, AppResult};
use crate::paths::is_within;

use super::{EntryKind, FileContent, FileEntry, PathResult, WorkspaceInfo};

const MAX_TEXT_FILE_BYTES: u64 = 16 * 1024 * 1024;

pub fn canonical_workspace(path: &str) -> AppResult<(PathBuf, WorkspaceInfo)> {
    let canonical = dunce::canonicalize(path)?;
    if !canonical.is_dir() {
        return Err(operation_error(format!(
            "workspace path is not a directory: {}",
            canonical.display()
        )));
    }

    let name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| canonical.to_string_lossy().into_owned());
    let info = WorkspaceInfo {
        name,
        path: path_text(&canonical),
    };
    Ok((canonical, info))
}

pub fn list_directory(root: &Path, path: &str) -> AppResult<Vec<FileEntry>> {
    let directory = checked_existing(root, path)?;
    if !directory.is_dir() {
        return Err(operation_error(format!(
            "path is not a directory: {}",
            directory.display()
        )));
    }

    let mut entries = Vec::new();
    for result in fs::read_dir(&directory)? {
        let entry = match result {
            Ok(entry) => entry,
            Err(error) => {
                log::warn!(
                    "failed to read a directory entry in {}: {error}",
                    directory.display()
                );
                continue;
            }
        };
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) => {
                log::warn!(
                    "failed to read metadata for {}: {error}",
                    entry.path().display()
                );
                continue;
            }
        };
        let file_type = metadata.file_type();
        let kind = if file_type.is_symlink() {
            EntryKind::Symlink
        } else if file_type.is_dir() {
            EntryKind::Directory
        } else {
            EntryKind::File
        };

        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path_text(&entry.path()),
            kind,
            size: file_type.is_file().then_some(metadata.len()),
            modified_at: modified_millis(&metadata),
        });
    }

    entries.sort_by(|left, right| {
        let left_directory = matches!(left.kind, EntryKind::Directory);
        let right_directory = matches!(right.kind, EntryKind::Directory);
        match right_directory.cmp(&left_directory) {
            Ordering::Equal => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
            ordering => ordering,
        }
    });

    Ok(entries)
}

pub fn read_text_file(root: &Path, path: &str) -> AppResult<FileContent> {
    let file = checked_existing(root, path)?;
    if !file.is_file() {
        return Err(operation_error(format!(
            "path is not a file: {}",
            file.display()
        )));
    }
    let metadata = fs::metadata(&file)?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(operation_error(format!(
            "text file exceeds the {} MiB limit: {}",
            MAX_TEXT_FILE_BYTES / 1024 / 1024,
            file.display()
        )));
    }

    let bytes = fs::read(&file)?;
    let content = String::from_utf8(bytes).map_err(|error| {
        operation_error(format!(
            "file is not valid UTF-8 ({}): {error}",
            file.display()
        ))
    })?;

    Ok(FileContent {
        path: path_text(&file),
        content,
        modified_at: modified_millis(&metadata),
    })
}

pub fn write_text_file(root: &Path, path: &str, content: &str) -> AppResult<PathResult> {
    let file = checked_existing(root, path)?;
    if !file.is_file() {
        return Err(operation_error(format!(
            "path is not a file: {}",
            file.display()
        )));
    }
    fs::write(&file, content.as_bytes())?;
    Ok(PathResult {
        path: path_text(&file),
    })
}

pub fn create_file(root: &Path, parent: &str, name: &str, content: &str) -> AppResult<PathResult> {
    let parent = checked_existing(root, parent)?;
    ensure_directory(&parent)?;
    let target = new_child_path(&parent, name)?;
    ensure_missing(&target)?;
    fs::write(&target, content.as_bytes())?;
    Ok(PathResult {
        path: path_text(&target),
    })
}

pub fn create_directory(root: &Path, parent: &str, name: &str) -> AppResult<PathResult> {
    let parent = checked_existing(root, parent)?;
    ensure_directory(&parent)?;
    let target = new_child_path(&parent, name)?;
    ensure_missing(&target)?;
    fs::create_dir(&target)?;
    Ok(PathResult {
        path: path_text(&target),
    })
}

pub fn rename_entry(root: &Path, path: &str, new_name: &str) -> AppResult<PathResult> {
    let original = PathBuf::from(path);
    let canonical = checked_existing(root, path)?;
    ensure_mutable_entry(root, &original, &canonical)?;
    let parent = original
        .parent()
        .ok_or_else(|| operation_error(format!("path has no parent: {path}")))?;
    let target = new_child_path(parent, new_name)?;
    ensure_missing(&target)?;
    fs::rename(&original, &target)?;
    Ok(PathResult {
        path: path_text(&target),
    })
}

pub fn delete_entry(root: &Path, path: &str) -> AppResult<()> {
    let original = PathBuf::from(path);
    let canonical = checked_existing(root, path)?;
    ensure_mutable_entry(root, &original, &canonical)?;
    let metadata = fs::symlink_metadata(&original)?;
    if metadata.is_dir() {
        fs::remove_dir_all(&original)?;
    } else {
        fs::remove_file(&original)?;
    }
    Ok(())
}

pub fn move_entry(root: &Path, source: &str, target_directory: &str) -> AppResult<PathResult> {
    let source_path = PathBuf::from(source);
    let canonical_source = checked_existing(root, source)?;
    ensure_mutable_entry(root, &source_path, &canonical_source)?;
    let target_directory = checked_existing(root, target_directory)?;
    ensure_directory(&target_directory)?;

    if target_directory.starts_with(&canonical_source) {
        return Err(operation_error("a directory cannot be moved into itself"));
    }

    let name = source_path
        .file_name()
        .ok_or_else(|| operation_error(format!("source path has no file name: {source}")))?;
    let target = target_directory.join(name);
    ensure_missing(&target)?;
    fs::rename(&source_path, &target)?;
    Ok(PathResult {
        path: path_text(&target),
    })
}

fn checked_existing(root: &Path, input: &str) -> AppResult<PathBuf> {
    let canonical = dunce::canonicalize(input)?;
    if !is_within(root, &canonical) {
        return Err(operation_error(format!(
            "path is outside the active workspace: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn ensure_mutable_entry(root: &Path, original: &Path, canonical: &Path) -> AppResult<()> {
    if canonical == root {
        return Err(operation_error("the workspace root cannot be modified"));
    }
    if fs::symlink_metadata(original)?.file_type().is_symlink() {
        return Err(operation_error("mutating symbolic links is not supported"));
    }
    Ok(())
}

fn ensure_directory(path: &Path) -> AppResult<()> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(operation_error(format!(
            "path is not a directory: {}",
            path.display()
        )))
    }
}

fn ensure_missing(path: &Path) -> AppResult<()> {
    if path.exists() {
        Err(operation_error(format!(
            "path already exists: {}",
            path.display()
        )))
    } else {
        Ok(())
    }
}

fn new_child_path(parent: &Path, name: &str) -> AppResult<PathBuf> {
    let trimmed = name.trim();
    let path = Path::new(trimmed);
    let mut components = path.components();
    let valid_component = matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
        && trimmed != "."
        && trimmed != "..";
    if !valid_component {
        return Err(operation_error(format!("invalid file name: {name}")));
    }
    Ok(parent.join(trimmed))
}

fn modified_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn path_text(path: &Path) -> String {
    dunce::simplified(path).to_string_lossy().into_owned()
}

fn operation_error(message: impl Into<String>) -> AppError {
    AppError::FileSystemOperation(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_listing_reads_only_one_level() {
        let root = temporary_directory("lazy-list");
        let child = root.join("child");
        fs::create_dir(&child).expect("child directory should be created");
        fs::write(child.join("nested.cpp"), "int nested;").expect("nested file should be created");
        fs::write(root.join("main.cpp"), "int main() {} ").expect("root file should be created");

        let entries = list_directory(&root, &path_text(&root)).expect("root should list");
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|entry| entry.name == "child"));
        assert!(!entries.iter().any(|entry| entry.name == "nested.cpp"));

        fs::remove_dir_all(root).expect("temporary directory should be removed");
    }

    #[test]
    fn invalid_child_names_are_rejected() {
        let parent = Path::new("C:\\workspace");
        assert!(new_child_path(parent, "../escape.cpp").is_err());
        assert!(new_child_path(parent, "folder/file.cpp").is_err());
        assert!(new_child_path(parent, "main.cpp").is_ok());
    }

    #[test]
    fn file_lifecycle_supports_chinese_and_spaces() {
        let temporary_root = temporary_directory("unicode-lifecycle");
        let workspace = temporary_root.join("中文 竞赛目录");
        fs::create_dir(&workspace).expect("workspace should be created");
        let workspace = dunce::canonicalize(&workspace).expect("workspace should canonicalize");
        let workspace_text = path_text(&workspace);

        let created = create_file(&workspace, &workspace_text, "解法 1.cpp", "")
            .expect("unicode file should be created");
        write_text_file(&workspace, &created.path, "int main() { return 0; }\n")
            .expect("unicode file should be written");
        let content =
            read_text_file(&workspace, &created.path).expect("unicode file should be readable");
        assert!(content.content.contains("return 0"));

        let renamed = rename_entry(&workspace, &created.path, "最终 解法.cpp")
            .expect("unicode file should be renamed");
        let directory = create_directory(&workspace, &workspace_text, "子 目录")
            .expect("unicode directory should be created");
        let moved = move_entry(&workspace, &renamed.path, &directory.path)
            .expect("file should move into unicode directory");

        let children = list_directory(&workspace, &directory.path)
            .expect("unicode directory should be listed");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].path, moved.path);

        delete_entry(&workspace, &moved.path).expect("moved file should be deleted");
        delete_entry(&workspace, &directory.path).expect("directory should be deleted");
        fs::remove_dir_all(temporary_root).expect("temporary directory should be removed");
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "lightcp-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after Unix epoch")
                .as_nanos()
        ));
        fs::create_dir(&path).expect("temporary directory should be created");
        dunce::canonicalize(path).expect("temporary directory should canonicalize")
    }
}
