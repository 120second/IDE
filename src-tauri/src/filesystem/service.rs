use std::{
    cmp::Ordering,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use crate::error::{AppError, AppResult};
use crate::paths::is_within;

use super::{
    EntryKind, FileContent, FileEntry, FileRevision, PathResult, WorkspaceFileMatch,
    WorkspaceFileResponse, WorkspaceInfo, WriteTextResult,
};

const MAX_TEXT_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SEARCH_FILES: usize = 20_000;
const MAX_FILE_RESULTS: usize = 200;
const MAX_FILE_QUERY_CHARS: usize = 128;

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

pub fn find_workspace_files(root: &Path, query: &str) -> AppResult<WorkspaceFileResponse> {
    let started = Instant::now();
    let query = query.trim();
    if query.chars().count() > MAX_FILE_QUERY_CHARS {
        return Err(operation_error(format!(
            "file query exceeds the {MAX_FILE_QUERY_CHARS} character limit"
        )));
    }
    let canonical_root = dunce::canonicalize(root)?;
    let mut pending = vec![canonical_root.clone()];
    let mut candidates = Vec::new();
    let mut files_scanned = 0usize;
    let mut scan_limit_hit = false;

    while let Some(directory) = pending.pop() {
        let mut entries = match fs::read_dir(&directory) {
            Ok(entries) => entries.filter_map(Result::ok).collect::<Vec<_>>(),
            Err(_) => continue,
        };
        entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
        for entry in entries {
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                if !ignored_search_directory(&entry.file_name().to_string_lossy()) {
                    pending.push(path);
                }
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            if files_scanned >= MAX_SEARCH_FILES {
                scan_limit_hit = true;
                break;
            }
            files_scanned += 1;
            let relative_path = path
                .strip_prefix(&canonical_root)
                .map(path_text)
                .unwrap_or_else(|_| path_text(&path));
            if let Some(score) = file_match_score(&relative_path, query) {
                candidates.push((
                    score,
                    WorkspaceFileMatch {
                        path: path_text(&path),
                        relative_path,
                    },
                ));
            }
        }
        if scan_limit_hit {
            break;
        }
    }

    candidates.sort_by(|(left_score, left), (right_score, right)| {
        left_score.cmp(right_score).then_with(|| {
            left.relative_path
                .to_lowercase()
                .cmp(&right.relative_path.to_lowercase())
        })
    });
    let result_limit_hit = candidates.len() > MAX_FILE_RESULTS;
    candidates.truncate(MAX_FILE_RESULTS);
    Ok(WorkspaceFileResponse {
        results: candidates.into_iter().map(|(_, result)| result).collect(),
        limit_hit: scan_limit_hit || result_limit_hit,
        files_scanned,
        duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    })
}

fn file_match_score(relative_path: &str, query: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(1_000 + relative_path.len());
    }
    let path = relative_path.to_lowercase();
    let query = query.to_lowercase();
    let name = relative_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(relative_path)
        .to_lowercase();
    if name == query {
        return Some(0);
    }
    if name.starts_with(&query) {
        return Some(10 + name.len().saturating_sub(query.len()));
    }
    if let Some(index) = name.find(&query) {
        return Some(30 + index);
    }
    if let Some(index) = path.find(&query) {
        return Some(60 + index);
    }

    let mut matched = 0usize;
    let mut gap_score = 0usize;
    let query_chars = query.chars().collect::<Vec<_>>();
    for (index, character) in path.chars().enumerate() {
        if query_chars
            .get(matched)
            .is_some_and(|expected| *expected == character)
        {
            gap_score += index;
            matched += 1;
            if matched == query_chars.len() {
                return Some(120 + gap_score);
            }
        }
    }
    None
}

fn ignored_search_directory(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git" | ".hg" | ".svn" | "node_modules" | "target" | "dist" | "build" | ".cache"
    ) || name.to_ascii_lowercase().starts_with("cmake-build-")
}

pub fn read_text_file(root: &Path, path: &str) -> AppResult<FileContent> {
    let file = checked_existing(root, path)?;
    if !file.is_file() {
        return Err(operation_error(format!(
            "path is not a file: {}",
            file.display()
        )));
    }
    for _ in 0..3 {
        let path_metadata_before = fs::metadata(&file)?;
        ensure_text_size(&file, &path_metadata_before)?;
        let mut handle = fs::File::open(&file)?;
        let opened_metadata = handle.metadata()?;
        if file_revision(&path_metadata_before)? != file_revision(&opened_metadata)? {
            continue;
        }

        let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
        Read::by_ref(&mut handle)
            .take(MAX_TEXT_FILE_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
            return Err(operation_error(format!(
                "text file exceeds the {} MiB limit while being read: {}",
                MAX_TEXT_FILE_BYTES / 1024 / 1024,
                file.display()
            )));
        }
        let handle_metadata_after = handle.metadata()?;
        let path_metadata_after = fs::metadata(&file)?;
        let revision = file_revision(&path_metadata_after)?;
        if revision != file_revision(&opened_metadata)?
            || revision != file_revision(&handle_metadata_after)?
        {
            continue;
        }
        ensure_text_size(&file, &path_metadata_after)?;
        let content = String::from_utf8(bytes).map_err(|error| {
            operation_error(format!(
                "file is not valid UTF-8 ({}): {error}",
                file.display()
            ))
        })?;

        return Ok(FileContent {
            path: path_text(&file),
            content,
            modified_at: modified_millis(&path_metadata_after),
            revision,
        });
    }

    Err(operation_error(format!(
        "file changed repeatedly while being read: {}",
        file.display()
    )))
}

pub fn get_text_file_revision(root: &Path, path: &str) -> AppResult<FileRevision> {
    let file = checked_existing(root, path)?;
    if !file.is_file() {
        return Err(operation_error(format!(
            "path is not a file: {}",
            file.display()
        )));
    }
    Ok(FileRevision {
        path: path_text(&file),
        revision: file_revision(&fs::metadata(&file)?)?,
    })
}

pub fn write_text_file(
    root: &Path,
    path: &str,
    content: &str,
    expected_revision: &str,
) -> AppResult<WriteTextResult> {
    let file = checked_existing(root, path)?;
    if !file.is_file() {
        return Err(operation_error(format!(
            "path is not a file: {}",
            file.display()
        )));
    }
    let original_metadata = fs::metadata(&file)?;
    let current_revision = file_revision(&original_metadata)?;
    if current_revision != expected_revision {
        return Ok(WriteTextResult {
            status: "conflict",
            path: path_text(&file),
            revision: current_revision,
        });
    }

    let (temporary_path, mut temporary_file) = create_save_temporary(&file)?;
    let result = (|| -> AppResult<WriteTextResult> {
        temporary_file.set_permissions(original_metadata.permissions())?;
        temporary_file.write_all(content.as_bytes())?;
        temporary_file.sync_all()?;
        drop(temporary_file);

        let revision_before_replace = file_revision(&fs::metadata(&file)?)?;
        if revision_before_replace != expected_revision {
            return Ok(WriteTextResult {
                status: "conflict",
                path: path_text(&file),
                revision: revision_before_replace,
            });
        }

        atomic_replace(&temporary_path, &file)?;
        sync_parent_directory(&file)?;
        let revision = file_revision(&fs::metadata(&file)?)?;
        Ok(WriteTextResult {
            status: "saved",
            path: path_text(&file),
            revision,
        })
    })();
    if temporary_path.exists() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn ensure_text_size(file: &Path, metadata: &fs::Metadata) -> AppResult<()> {
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(operation_error(format!(
            "text file exceeds the {} MiB limit: {}",
            MAX_TEXT_FILE_BYTES / 1024 / 1024,
            file.display()
        )));
    }
    Ok(())
}

fn file_revision(metadata: &fs::Metadata) -> AppResult<String> {
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| operation_error(format!("file modification time is invalid: {error}")))?;
    Ok(format!("{}:{}", modified.as_nanos(), metadata.len()))
}

fn create_save_temporary(target: &Path) -> AppResult<(PathBuf, fs::File)> {
    let parent = target.parent().ok_or_else(|| {
        operation_error(format!(
            "file has no parent directory: {}",
            target.display()
        ))
    })?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| operation_error(format!("system clock is invalid: {error}")))?
        .as_nanos();
    for attempt in 0..100_u32 {
        let temporary = parent.join(format!(
            ".lightcp-save-{}-{nonce}-{attempt}.tmp",
            std::process::id()
        ));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => return Ok((temporary, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(operation_error(format!(
        "could not allocate a temporary save file beside {}",
        target.display()
    )))
}

#[cfg(windows)]
fn atomic_replace(source: &Path, target: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
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

#[cfg(not(windows))]
fn atomic_replace(source: &Path, target: &Path) -> AppResult<()> {
    fs::rename(source, target)?;
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(target: &Path) -> AppResult<()> {
    let parent = target.parent().ok_or_else(|| {
        operation_error(format!(
            "file has no parent directory: {}",
            target.display()
        ))
    })?;
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_target: &Path) -> AppResult<()> {
    Ok(())
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
        let initial = read_text_file(&workspace, &created.path).expect("initial file revision");
        let written = write_text_file(
            &workspace,
            &created.path,
            "int main() { return 0; }\n",
            &initial.revision,
        )
        .expect("unicode file should be written");
        assert_eq!(written.status, "saved");
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

    #[test]
    fn conditional_atomic_save_rejects_a_stale_revision() {
        let workspace = temporary_directory("conditional-save");
        let path = workspace.join("main.cpp");
        fs::write(&path, "original\n").expect("initial file");
        let path = path_text(&path);
        let initial = read_text_file(&workspace, &path).expect("initial revision");

        fs::write(&path, "external change\n").expect("external write");
        let conflict = write_text_file(&workspace, &path, "editor change\n", &initial.revision)
            .expect("conflict result");

        assert_eq!(conflict.status, "conflict");
        assert_eq!(
            fs::read_to_string(&path).expect("preserved external content"),
            "external change\n"
        );
        fs::remove_dir_all(workspace).expect("temporary directory should be removed");
    }

    #[test]
    fn atomic_save_returns_the_revision_that_was_written() {
        let workspace = temporary_directory("atomic-save");
        let path = workspace.join("main.cpp");
        fs::write(&path, "before\n").expect("initial file");
        let path = path_text(&path);
        let initial = read_text_file(&workspace, &path).expect("initial revision");

        let saved =
            write_text_file(&workspace, &path, "after\n", &initial.revision).expect("atomic save");
        let reread = read_text_file(&workspace, &path).expect("saved file");

        assert_eq!(saved.status, "saved");
        assert_eq!(saved.revision, reread.revision);
        assert_eq!(reread.content, "after\n");
        assert!(fs::read_dir(&workspace)
            .expect("workspace entries")
            .all(|entry| !entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .starts_with(".lightcp-save-")));
        fs::remove_dir_all(workspace).expect("temporary directory should be removed");
    }

    #[test]
    fn quick_open_ranks_file_names_and_supports_subsequence_queries() {
        let workspace = temporary_directory("quick-open");
        let source = workspace.join("solutions");
        fs::create_dir(&source).expect("solutions directory");
        fs::write(source.join("main.cpp"), "int main() {}\n").expect("main source");
        fs::write(source.join("matrix.cpp"), "// matrix\n").expect("matrix source");
        fs::write(workspace.join("README.md"), "docs\n").expect("readme");

        let exact = find_workspace_files(&workspace, "main.cpp").expect("exact file query");
        assert_eq!(
            exact
                .results
                .first()
                .map(|item| item.relative_path.as_str()),
            Some("solutions\\main.cpp")
        );

        let subsequence = find_workspace_files(&workspace, "mtx").expect("subsequence query");
        assert!(subsequence
            .results
            .iter()
            .any(|item| item.relative_path.ends_with("matrix.cpp")));

        fs::remove_dir_all(workspace).expect("temporary directory should be removed");
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
