use std::io::{BufRead, Write};

use serde_json::Value;

use crate::error::{AppError, AppResult};

const MAX_MESSAGE_BYTES: usize = 32 * 1024 * 1024;

pub fn read_message(reader: &mut impl BufRead) -> AppResult<Option<Value>> {
    let mut content_length = None;
    loop {
        let mut header = String::new();
        let bytes = reader.read_line(&mut header)?;
        if bytes == 0 {
            return Ok(None);
        }
        let header = header.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = Some(value.trim().parse::<usize>().map_err(|error| {
                    AppError::Process(format!(
                        "clangd returned an invalid Content-Length: {error}"
                    ))
                })?);
            }
        }
    }

    let content_length = content_length.ok_or_else(|| {
        AppError::Process("clangd response did not include Content-Length".to_owned())
    })?;
    if content_length > MAX_MESSAGE_BYTES {
        return Err(AppError::Process(format!(
            "clangd response exceeded the {} MiB safety limit",
            MAX_MESSAGE_BYTES / 1024 / 1024
        )));
    }
    let mut body = vec![0_u8; content_length];
    reader.read_exact(&mut body)?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| AppError::Process(format!("clangd returned invalid JSON: {error}")))
}

pub fn write_message(writer: &mut impl Write, value: &Value) -> AppResult<()> {
    let body = serde_json::to_vec(value)
        .map_err(|error| AppError::Internal(format!("failed to serialize LSP message: {error}")))?;
    writer.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())?;
    writer.write_all(&body)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::{BufReader, Cursor};

    use serde_json::json;

    use super::*;

    #[test]
    fn roundtrips_framed_json_rpc_messages() {
        let message = json!({"jsonrpc": "2.0", "id": 7, "result": {"ok": true}});
        let mut bytes = Vec::new();
        write_message(&mut bytes, &message).expect("message should serialize");
        let mut reader = BufReader::new(Cursor::new(bytes));
        assert_eq!(
            read_message(&mut reader).expect("message should parse"),
            Some(message)
        );
    }

    #[test]
    fn accepts_case_insensitive_content_length_header() {
        let body = br#"{"jsonrpc":"2.0","method":"initialized"}"#;
        let frame = format!("content-length: {}\r\n\r\n", body.len())
            .into_bytes()
            .into_iter()
            .chain(body.iter().copied())
            .collect::<Vec<_>>();
        let mut reader = BufReader::new(Cursor::new(frame));
        assert!(read_message(&mut reader)
            .expect("message should parse")
            .is_some());
    }
}
