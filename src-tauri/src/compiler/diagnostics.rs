use super::CompileDiagnostic;
use crate::lsp::{LspPosition, LspRange};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

type SourceLines = HashMap<PathBuf, Option<Vec<String>>>;

pub fn task_error(source: &Path, message: impl Into<String>, code: &str) -> CompileDiagnostic {
    CompileDiagnostic {
        path: source.to_string_lossy().into_owned(),
        range: LspRange {
            start: LspPosition {
                line: 0,
                character: 0,
            },
            end: LspPosition {
                line: 0,
                character: 0,
            },
        },
        severity: 1,
        message: message.into(),
        source: "编译器".into(),
        code: code.into(),
        file_level: true,
    }
}

pub fn parse(stderr: &str, source: &Path, success: bool) -> Vec<CompileDiagnostic> {
    let mut result = Vec::new();
    let mut source_lines = SourceLines::new();
    let (items, remainder, incomplete) = split_output(stderr);
    for item in items {
        parse_json(&item, source, &mut result, &mut source_lines);
    }
    for line in remainder.lines() {
        if result.len() >= 1999 {
            break;
        }
        for (marker, severity) in [
            (": fatal error: ", 1),
            (": error: ", 1),
            (": warning: ", 2),
            (": note: ", 3),
        ] {
            let Some((location, message)) = line.split_once(marker) else {
                continue;
            };
            if let Some((file, row, column)) = text_location(location) {
                result.push(positioned(
                    source,
                    file,
                    // Clang's text diagnostic columns count UTF-8 bytes.
                    (row, column, Some(column), false),
                    message,
                    severity,
                    "",
                    &mut source_lines,
                ));
            } else {
                let mut diagnostic = task_error(source, message, "");
                diagnostic.severity = severity;
                result.push(diagnostic);
            }
            break;
        }
    }
    let linker_start = remainder.lines().position(is_linker_line);
    let linker_failed = !success && linker_start.is_some();
    if linker_failed {
        // A driver's final "ld returned 1" must not hide the preceding
        // undefined-symbol details merely because it parsed as an error.
        result.retain(|diagnostic| !(diagnostic.file_level && diagnostic.severity == 1));
        let mut diagnostic = task_error(
            source,
            remainder
                .lines()
                .skip(linker_start.unwrap_or(0))
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .chars()
                .take(8000)
                .collect::<String>(),
            "link_failed",
        );
        diagnostic.source = "链接器".into();
        result.push(diagnostic);
    }
    if !success && !result.iter().any(|d| d.severity == 1) {
        let mut error = task_error(
            source,
            if stderr.trim().is_empty() {
                "编译器未生成可执行文件。".into()
            } else {
                stderr.trim().chars().take(8000).collect::<String>()
            },
            "build_failed",
        );
        if linker_failed {
            error.source = "链接器".into();
        }
        result.push(error);
    }
    if incomplete || result.len() >= 1999 {
        let mut note = task_error(
            source,
            "编译诊断不完整：输出被截断、格式不完整或已达到诊断数量上限。已保留完整收到的错误。",
            "diagnostics_incomplete",
        );
        note.severity = 2;
        result.truncate(1999);
        result.push(note);
    }
    result.truncate(2000);
    result
}

fn is_linker_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    // Positioned Clang/GCC text is a compiler diagnostic, even when its
    // user-supplied message contains linker keywords.
    for marker in [": error: ", ": warning: ", ": note: "] {
        if let Some((location, _)) = line.split_once(marker) {
            if text_location(location).is_some() {
                return false;
            }
        }
    }
    let driver = [
        "ld:",
        "ld.exe:",
        "ld.lld:",
        "lld-link:",
        "collect2:",
        "collect2.exe:",
    ]
    .iter()
    .any(|name| lower.contains(name));
    let symbol = lower.contains("undefined reference") || lower.contains("undefined symbol");
    driver && (symbol || lower.contains("error:") || lower.contains("ld returned"))
        || symbol && (lower.contains(".o:") || lower.contains(".obj:"))
        || (lower.starts_with("clang") || lower.starts_with("g++") || lower.starts_with("gcc"))
            && lower.contains(": error: linker command failed")
        || [": error lnk2019", ": error lnk2001", ": fatal error lnk"]
            .iter()
            .any(|marker| lower.contains(marker))
}

// Extract complete top-level GCC diagnostic objects even if an array is cut
// short. JSON strings/escapes and nested children/ranges keep their boundaries.
fn split_output(text: &str) -> (Vec<Value>, String, bool) {
    let bytes = text.as_bytes();
    let mut items = Vec::new();
    let mut plain = String::new();
    let mut cursor = 0;
    let mut index = 0;
    let mut incomplete = false;
    while index < bytes.len() {
        let line_start = index == 0 || bytes[index - 1] == b'\n';
        if !line_start {
            index += 1;
            continue;
        }
        let start = index
            + bytes[index..]
                .iter()
                .take_while(|b| b.is_ascii_whitespace() && **b != b'\n')
                .count();
        if start >= bytes.len() || bytes[start] != b'[' {
            index += 1;
            continue;
        }
        let next = text[start + 1..].trim_start();
        if !next.starts_with('{') && !next.starts_with(']') {
            index += 1;
            continue;
        }
        let mut depth = 1usize;
        let mut quoted = false;
        let mut escaped = false;
        let mut object_start = None;
        let mut found = Vec::new();
        let mut end = start + 1;
        while end < bytes.len() && depth > 0 {
            let byte = bytes[end];
            if quoted {
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == b'"' {
                    quoted = false;
                }
            } else {
                match byte {
                    b'"' => quoted = true,
                    b'{' | b'[' => {
                        if depth == 1 && byte == b'{' {
                            object_start = Some(end);
                        }
                        depth += 1;
                    }
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 1 && byte == b'}' {
                            if let Some(begin) = object_start.take() {
                                if let Ok(value) = serde_json::from_str::<Value>(&text[begin..=end])
                                {
                                    if value.get("kind").is_some_and(Value::is_string)
                                        && found.len() < 2000
                                    {
                                        found.push(value);
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            end += 1;
        }
        let valid = !found.is_empty() || text[start..end].trim() == "[]";
        if valid {
            plain.push_str(&text[cursor..start]);
            plain.push('\n');
            incomplete |= depth != 0;
            items.extend(
                found
                    .into_iter()
                    .take(2000usize.saturating_sub(items.len())),
            );
            cursor = end;
            index = end;
        } else {
            index += 1;
        }
    }
    plain.push_str(&text[cursor..]);
    (items, plain, incomplete)
}

fn parse_json(
    value: &Value,
    source: &Path,
    result: &mut Vec<CompileDiagnostic>,
    source_lines: &mut SourceLines,
) {
    if result.len() >= 1999 {
        return;
    }
    if value["kind"].as_str() == Some("internal compiler error") {
        let mut diagnostic = task_error(
            source,
            format!(
                "编译器内部错误：{}。请检查工具链；这不是普通的源码语法错误。",
                value["message"].as_str().unwrap_or("unknown error")
            ),
            "compiler_internal_error",
        );
        diagnostic.source = "工具链".into();
        result.push(diagnostic);
        return;
    }
    let severity = match value["kind"].as_str().unwrap_or("error") {
        "warning" => 2,
        "note" => 3,
        _ => 1,
    };
    let message = value["message"].as_str().unwrap_or("编译错误");
    let code = value["option"].as_str().unwrap_or("");
    let origin = value["column-origin"].as_i64().unwrap_or(1);
    let column = |value: &Value| {
        value.as_i64().map(|column| {
            column
                .saturating_sub(origin)
                .saturating_add(1)
                .clamp(1, u32::MAX as i64) as u32
        })
    };
    if let Some(caret) = value.pointer("/locations/0/caret") {
        result.push(positioned(
            source,
            caret["file"].as_str().unwrap_or(""),
            (
                caret["line"].as_u64().unwrap_or(1) as u32,
                column(&caret["column"]).unwrap_or(1),
                column(&caret["byte-column"]),
                true,
            ),
            message,
            severity,
            code,
            source_lines,
        ));
    } else {
        let mut diagnostic = task_error(source, message, code);
        diagnostic.severity = severity;
        result.push(diagnostic);
    }
    if let Some(children) = value["children"].as_array() {
        for child in children.iter().take(100) {
            parse_json(child, source, result, source_lines);
        }
    }
}

fn positioned(
    source: &Path,
    file: &str,
    position: (u32, u32, Option<u32>, bool),
    message: &str,
    severity: u8,
    code: &str,
    source_lines: &mut SourceLines,
) -> CompileDiagnostic {
    let (row, column, byte_column, gcc_columns) = position;
    if row == 0 || file.starts_with('<') && file.ends_with('>') {
        let mut diagnostic = task_error(source, format!("{file}: {message}"), code);
        diagnostic.severity = severity;
        return diagnostic;
    }
    let path = if file.is_empty() {
        source.to_path_buf()
    } else {
        let file = PathBuf::from(file);
        if file.is_absolute() {
            file
        } else {
            source.parent().unwrap_or(Path::new(".")).join(file)
        }
    };
    let path = dunce::canonicalize(&path).unwrap_or(path);
    // Read and split each file once, including when GCC emits many errors.
    let lines = source_lines.entry(path.clone()).or_insert_with(|| {
        std::fs::read_to_string(&path).ok().map(|text| {
            super::service::normalize_line_endings(&text)
                .split('\n')
                .map(str::to_owned)
                .collect()
        })
    });
    let line = lines
        .as_ref()
        .and_then(|lines| lines.get(row.saturating_sub(1) as usize))
        .map(String::as_str);
    let character = line
        .map(|line| {
            // GCC omits the UTF-8 BOM from its columns; Clang includes its
            // three bytes. CodeMirror retains it as one UTF-16 character.
            let (line, prefix) = if gcc_columns && row == 1 {
                line.strip_prefix('\u{feff}')
                    .map_or((line, 0u32), |line| (line, 1u32))
            } else {
                (line, 0u32)
            };
            prefix
                + if let Some(byte_column) = byte_column {
                    line.char_indices()
                        .take_while(|(offset, _)| *offset < byte_column.saturating_sub(1) as usize)
                        .map(|(_, c)| c.len_utf16() as u32)
                        .sum::<u32>()
                } else {
                    line.chars()
                        .take(column.saturating_sub(1) as usize)
                        .map(|c| c.len_utf16() as u32)
                        .sum::<u32>()
                }
        })
        .unwrap_or(column.saturating_sub(1));
    let mut offset = 0;
    let token_width = line
        .map(|line| {
            line.chars()
                .skip_while(|c| {
                    if offset < character {
                        offset += c.len_utf16() as u32;
                        true
                    } else {
                        false
                    }
                })
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .map(|c| c.len_utf16() as u32)
                .sum::<u32>()
        })
        .unwrap_or(0)
        .max(1);
    CompileDiagnostic {
        path: path.to_string_lossy().into_owned(),
        range: LspRange {
            start: LspPosition {
                line: row.saturating_sub(1),
                character,
            },
            end: LspPosition {
                line: row.saturating_sub(1),
                character: character + token_width,
            },
        },
        severity,
        message: message.chars().take(8000).collect(),
        source: "编译器".into(),
        code: code.into(),
        file_level: false,
    }
}

fn text_location(location: &str) -> Option<(&str, u32, u32)> {
    let (prefix, last) = location.rsplit_once(':')?;
    let last = last.parse().ok()?;
    if let Some((file, row)) = prefix.rsplit_once(':') {
        if let Ok(row) = row.parse() {
            return Some((file, row, last));
        }
    }
    Some((prefix, last, 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_and_truncated_json_preserves_complete_objects_without_fake_link_errors() {
        let source = Path::new("main.cpp");
        let item = serde_json::json!({"kind":"error","message":"static assertion failed: undefined reference { [ \\\"","locations":[{"caret":{"file":"main.cpp","line":2,"column":5}}]});
        let object = serde_json::to_string_pretty(&item).unwrap();
        for input in [
            format!("Using built-in specs.\n[{object}]\n"),
            format!("[{object},{{\"kind\":\"error\""),
        ] {
            let result = parse(&input, source, false);
            assert!(result
                .iter()
                .any(|d| !d.file_level && d.range.start.line == 1));
            assert!(!result
                .iter()
                .any(|d| d.source == "链接器" || d.message.is_empty()));
        }
        let result = parse(&format!("[{object},{{\"kind\":\"error\""), source, false);
        assert!(result.iter().any(|d| d.code == "diagnostics_incomplete"));
        let clang = parse("main.cpp:1:15: error: static assertion failed: undefined reference\n1 error generated.", source, false);
        assert_eq!(clang.len(), 1);
        assert!(!clang[0].file_level);
        assert_eq!(clang[0].source, "编译器");
    }
    #[test]
    fn parses_gcc_json_and_keeps_linker_errors() {
        let source = std::env::temp_dir().join("diagnostic.cpp");
        let json = r#"[{"kind":"error","message":"missing identifier","locations":[{"caret":{"file":"diagnostic.cpp","line":3,"column":5}}]}]"#;
        let result = parse(json, &source, false);
        assert_eq!(result[0].range.start.line, 2);
        assert_eq!(result[0].range.start.character, 4);
        assert!(!result[0].file_level);
        let pretty =
            serde_json::to_string_pretty(&serde_json::from_str::<Value>(json).unwrap()).unwrap();
        assert!(!parse(&pretty, &source, false)[0].file_level);
        let result = parse("ld: undefined reference to add_subtree", &source, false);
        assert!(result[0].file_level);
        assert!(result[0].message.contains("add_subtree"));
        let result = parse("[]\nld: undefined reference to add_subtree\ncollect2.exe: error: ld returned 1 exit status", &source, false);
        assert!(result
            .iter()
            .any(|d| d.source == "链接器" && d.message.contains("add_subtree")));
    }

    #[test]
    fn text_diagnostics_convert_utf8_columns_and_mark_the_whole_identifier() {
        let root = std::env::temp_dir().join(format!("lightcp-columns-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("中文.cpp");
        let line = "int main(){ /* 中文😀 */ add_subtree(1,1); }";
        std::fs::write(&source, line).unwrap();
        let byte = line.find("add_subtree").unwrap();
        let result = parse(
            &format!(
                "{}:1:{}: error: undeclared identifier",
                source.display(),
                byte + 1
            ),
            &source,
            false,
        );
        assert_eq!(
            result[0].range.start.character,
            line[..byte].encode_utf16().count() as u32
        );
        assert_eq!(
            result[0].range.end.character - result[0].range.start.character,
            11
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn command_line_warnings_and_line_only_diagnostics_remain_visible() {
        let source = Path::new("main.cpp");
        let warnings = parse("clang++: warning: argument unused during compilation\nmain.cpp:3: warning: line-only warning", source, true);
        assert_eq!(warnings.len(), 2);
        assert_eq!(warnings[0].severity, 2);
        assert!(warnings[0].file_level);
        assert_eq!(warnings[1].range.start.line, 2);
        assert!(!warnings[1].file_level);
        let json = r#"[{"kind":"error","message":"invalid macro","locations":[{"caret":{"file":"<command-line>","line":0,"column":1}}]}]"#;
        assert!(parse(json, source, false)[0].file_level);
        let crash = r#"[{"kind":"internal compiler error","message":"Illegal instruction","locations":[{"caret":{"file":"concepts","line":334,"column":17}}]}]"#;
        let result = parse(crash, source, false);
        assert!(result[0].file_level);
        assert_eq!(result[0].source, "工具链");
    }
}
