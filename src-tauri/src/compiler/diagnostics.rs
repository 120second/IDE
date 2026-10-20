use super::CompileDiagnostic;
use crate::lsp::{LspPosition, LspRange};
use serde_json::Value;
use std::path::{Path, PathBuf};

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
    // Recent GCC versions pretty-print JSON over multiple lines. Linker text
    // may follow the JSON array, so parse complete values, then the remainder.
    let mut remainder = stderr.trim_start();
    while remainder.starts_with('[') {
        let mut stream = serde_json::Deserializer::from_str(remainder).into_iter::<Value>();
        let Some(Ok(Value::Array(items))) = stream.next() else {
            break;
        };
        for item in items {
            parse_json(&item, source, &mut result);
            if result.len() >= 1999 {
                break;
            }
        }
        remainder = remainder[stream.byte_offset()..].trim_start();
    }
    for line in remainder.lines() {
        if result.len() >= 1999 {
            break;
        }
        if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(line) {
            for item in items {
                parse_json(&item, source, &mut result);
            }
            continue;
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
            let mut parts = location.rsplitn(3, ':');
            let (Some(column), Some(row), Some(file)) = (parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            if let (Ok(row), Ok(column)) = (row.parse::<u32>(), column.parse::<u32>()) {
                result.push(positioned(
                    source,
                    file,
                    (row, column, None),
                    message,
                    severity,
                    "",
                ));
            }
            break;
        }
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
        if stderr.contains("undefined reference") || stderr.contains("collect2:") {
            error.source = "链接器".into();
        }
        result.push(error);
    }
    result.truncate(2000);
    result
}

fn parse_json(value: &Value, source: &Path, result: &mut Vec<CompileDiagnostic>) {
    if result.len() >= 1999 {
        return;
    }
    let severity = match value["kind"].as_str().unwrap_or("error") {
        "warning" => 2,
        "note" => 3,
        _ => 1,
    };
    let message = value["message"].as_str().unwrap_or("编译错误");
    let code = value["option"].as_str().unwrap_or("");
    if let Some(caret) = value.pointer("/locations/0/caret") {
        result.push(positioned(
            source,
            caret["file"].as_str().unwrap_or(""),
            (
                caret["line"].as_u64().unwrap_or(1) as u32,
                caret["column"].as_u64().unwrap_or(1) as u32,
                caret["byte-column"].as_u64().map(|n| n as u32),
            ),
            message,
            severity,
            code,
        ));
    } else {
        let mut diagnostic = task_error(source, message, code);
        diagnostic.severity = severity;
        result.push(diagnostic);
    }
    if let Some(children) = value["children"].as_array() {
        for child in children.iter().take(100) {
            parse_json(child, source, result);
        }
    }
}

fn positioned(
    source: &Path,
    file: &str,
    position: (u32, u32, Option<u32>),
    message: &str,
    severity: u8,
    code: &str,
) -> CompileDiagnostic {
    let (row, column, byte_column) = position;
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
    let character = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| {
            let line = text.lines().nth(row.saturating_sub(1) as usize)?;
            Some(if let Some(byte_column) = byte_column {
                line.char_indices()
                    .take_while(|(offset, _)| *offset < byte_column.saturating_sub(1) as usize)
                    .map(|(_, c)| c.len_utf16() as u32)
                    .sum()
            } else {
                line.chars()
                    .take(column.saturating_sub(1) as usize)
                    .map(|c| c.len_utf16() as u32)
                    .sum()
            })
        })
        .unwrap_or(column.saturating_sub(1));
    CompileDiagnostic {
        path: path.to_string_lossy().into_owned(),
        range: LspRange {
            start: LspPosition {
                line: row.saturating_sub(1),
                character,
            },
            end: LspPosition {
                line: row.saturating_sub(1),
                character: character + 1,
            },
        },
        severity,
        message: message.chars().take(8000).collect(),
        source: "编译器".into(),
        code: code.into(),
        file_level: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
    }
}
