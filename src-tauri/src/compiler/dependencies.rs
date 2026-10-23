use super::{service, CompileDependency, CompileProfile, CompileRequest};
use crate::{error::AppResult, process_tree::ProcessTree};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize},
        Arc,
    },
    time::Duration,
};

const MAX_BYTES: usize = 64 * 1024 * 1024;
pub(super) struct Snapshot {
    files: BTreeMap<PathBuf, Option<Vec<u8>>>,
    pub(super) complete: bool,
}
pub(super) struct Manifest(pub(super) PathBuf);
impl Manifest {
    pub(super) fn new() -> AppResult<Self> {
        let path = std::env::temp_dir().join(format!("lightcp-deps-{}.d", uuid::Uuid::new_v4()));
        Ok(Self(
            service::compatible_compiler_output(&path)?.with_extension("d"),
        ))
    }
}
impl Drop for Manifest {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub(super) fn inspect(
    source: &Path,
    request: &CompileRequest,
    stop: &AtomicBool,
    timeout: Duration,
) -> AppResult<Option<Snapshot>> {
    let manifest = Manifest::new()?;
    let compiler = request.config.compiler_path.trim();
    let args = match request.profile {
        CompileProfile::Release => &request.config.release_args,
        CompileProfile::Debug => &request.config.debug_args,
    };
    let mut command = Command::new(if compiler.is_empty() { "g++" } else { compiler });
    command
        .arg(format!(
            "-std={}",
            if request.config.standard.trim().is_empty() {
                "c++20"
            } else {
                request.config.standard.trim()
            }
        ))
        .args(args.iter().filter(|arg| !arg.trim().is_empty()))
        .args(["-M", "-MG", "-MT", "lightcp", "-MF"])
        .arg(&manifest.0)
        .arg(source)
        .current_dir(source.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    service::configure_hidden(&mut command);
    let Ok(mut child) = command.spawn() else {
        return Ok(None);
    };
    let tree = ProcessTree::attach(&mut child)?;
    let reader = child.stderr.take().map(|stderr| {
        service::spawn_limited_reader(
            stderr,
            65536,
            Arc::new(AtomicUsize::new(0)),
            Arc::new(AtomicBool::new(false)),
        )
    });
    let status = service::wait_for_compiler(&mut child, &tree, stop, timeout);
    drop(tree);
    if let Some(reader) = reader {
        service::join_reader(reader)?;
    }
    // GCC can still emit useful dependencies after #error. Preserve them so
    // unsaved inputs are checked, without treating a failed scan as complete.
    let complete = status?.success();
    let Ok(metadata) = fs::metadata(&manifest.0) else {
        return Ok(None);
    };
    if metadata.len() > 2 * 1024 * 1024 {
        return Ok(None);
    }
    let Ok(text) = fs::read_to_string(&manifest.0) else {
        return Ok(None);
    };
    let Some(paths) = parse_manifest(&text, source.parent().unwrap_or(Path::new("."))) else {
        return Ok(None);
    };
    if !paths.iter().any(|path| path == source) {
        return Ok(None);
    }
    let mut files = BTreeMap::new();
    let mut used = 0;
    for path in paths.into_iter().chain([source.to_owned()]) {
        if files.contains_key(&path) {
            continue;
        }
        let Some(contents) = read_bounded(&path, MAX_BYTES - used) else {
            return Ok(None);
        };
        used += contents.as_ref().map_or(0, Vec::len);
        files.insert(path, contents);
    }
    Ok(Some(Snapshot { files, complete }))
}

fn read_bounded(path: &Path, remaining: usize) -> Option<Option<Vec<u8>>> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Some(None),
        Err(_) => return None,
    };
    if file.metadata().ok()?.len() > remaining as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(remaining as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() <= remaining).then_some(Some(bytes))
}

impl Snapshot {
    pub(super) fn matches_manifest(&self, manifest: &Path, directory: &Path) -> bool {
        let Ok(metadata) = fs::metadata(manifest) else {
            return false;
        };
        if metadata.len() > 2 * 1024 * 1024 {
            return false;
        }
        let Some(paths) = fs::read_to_string(manifest)
            .ok()
            .and_then(|text| parse_manifest(&text, directory))
        else {
            return false;
        };
        let actual = paths.into_iter().collect::<std::collections::BTreeSet<_>>();
        self.files
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>()
            == actual
    }
    pub(super) fn unchanged(&self) -> bool {
        self.files
            .iter()
            .all(|(path, bytes)| read_bounded(path, MAX_BYTES).as_ref() == Some(bytes))
    }
    pub(super) fn describe(&self) -> Vec<CompileDependency> {
        self.files
            .iter()
            .map(|(path, bytes)| CompileDependency {
                path: path.to_string_lossy().into_owned(),
                content_hash: bytes
                    .as_ref()
                    .and_then(|bytes| std::str::from_utf8(bytes).ok())
                    .map(|text| {
                        format!(
                            "{:x}",
                            Sha256::digest(service::normalize_line_endings(text).as_bytes())
                        )
                    }),
            })
            .collect()
    }
}

fn parse_manifest(text: &str, directory: &Path) -> Option<Vec<PathBuf>> {
    if !text.ends_with('\n') {
        return None;
    }
    let text = text.replace("\\\r\n", " ").replace("\\\n", " ");
    let mut paths = Vec::new();
    for rule in text.lines() {
        let Some((targets, list)) = rule
            .split_once(": ")
            .or_else(|| rule.split_once(":\t"))
            .or_else(|| rule.strip_suffix(':').map(|target| (target, "")))
        else {
            continue;
        };
        // -MP adds empty header targets. Only the managed build target owns
        // prerequisites; target names must never become input filenames.
        if !targets.split_whitespace().any(|target| target == "lightcp") {
            continue;
        }
        let mut token = String::new();
        let mut chars = list.chars().peekable();
        while let Some(c) = chars.next() {
            if (c == '\\'
                && chars
                    .peek()
                    .is_some_and(|c| matches!(c, ' ' | '\t' | '#' | '\\' | ':')))
                || c == '$' && chars.peek() == Some(&'$')
            {
                token.push(chars.next()?);
            } else if c == '#' {
                break;
            } else if c.is_whitespace() {
                if !token.is_empty() {
                    paths.push(std::mem::take(&mut token));
                }
            } else {
                token.push(c);
            }
        }
        if !token.is_empty() {
            paths.push(token);
        }
    }
    if paths.is_empty() || paths.len() > 8192 {
        return None;
    }
    Some(
        paths
            .into_iter()
            .map(|path| {
                let path = PathBuf::from(path);
                let path = if path.is_absolute() {
                    path
                } else {
                    directory.join(path)
                };
                dunce::canonicalize(&path).unwrap_or(path)
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn make_paths_preserve_windows_separators_spaces_and_dollars() {
        let paths = parse_manifest(
            "lightcp: C:\\Code\\main.cpp \\\r\n C:\\Code\\value\\ space.h C:\\Code\\price$$.h\n",
            Path::new("D:/root"),
        )
        .unwrap();
        assert_eq!(paths[0], Path::new("C:\\Code\\main.cpp"));
        assert_eq!(paths[1], Path::new("C:\\Code\\value space.h"));
        assert_eq!(paths[2], Path::new("C:\\Code\\price$.h"));
    }

    #[test]
    fn make_phony_targets_and_comments_are_not_dependencies() {
        let paths = parse_manifest("lightcp: main.cpp \\\n value\\ space.h price$$.h hash\\#name.h # comment\n\nvalue\\ space.h:\nprice$$.h:\nhash\\#name.h:\n", Path::new("D:/nonexistent")).unwrap();
        assert_eq!(paths.len(), 4);
        assert_eq!(paths[1], Path::new("D:/nonexistent/value space.h"));
        assert_eq!(paths[3], Path::new("D:/nonexistent/hash#name.h"));
        assert!(parse_manifest("lightcp: main.cpp", Path::new(".")).is_none());
    }
}
