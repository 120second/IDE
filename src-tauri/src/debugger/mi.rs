//! Standalone GDB/MI record parsing. Human-readable console text is never
//! interpreted by the debugger; it is forwarded to the UI as a stream.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MiAsyncKind {
    Exec,
    Status,
    Notify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MiStreamKind {
    Console,
    Target,
    Log,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MiResult {
    pub variable: String,
    pub value: MiValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MiListItem {
    Value(MiValue),
    Result(MiResult),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MiValue {
    Const(String),
    Tuple(Vec<MiResult>),
    List(Vec<MiListItem>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MiRecord {
    Result {
        token: Option<u64>,
        class: String,
        results: Vec<MiResult>,
    },
    Async {
        token: Option<u64>,
        kind: MiAsyncKind,
        class: String,
        results: Vec<MiResult>,
    },
    Stream {
        kind: MiStreamKind,
        text: String,
    },
    Prompt,
}

impl MiValue {
    pub fn as_const(&self) -> Option<&str> {
        match self {
            Self::Const(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_tuple(&self) -> Option<&[MiResult]> {
        match self {
            Self::Tuple(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_list(&self) -> Option<&[MiListItem]> {
        match self {
            Self::List(value) => Some(value),
            _ => None,
        }
    }
}

pub fn field<'a>(results: &'a [MiResult], name: &str) -> Option<&'a MiValue> {
    results
        .iter()
        .find(|result| result.variable == name)
        .map(|result| &result.value)
}

pub fn const_field<'a>(results: &'a [MiResult], name: &str) -> Option<&'a str> {
    field(results, name).and_then(MiValue::as_const)
}

pub fn parse_record(line: &str) -> Result<MiRecord, String> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line == "(gdb)" || line == "(gdb) " {
        return Ok(MiRecord::Prompt);
    }
    let mut parser = Parser::new(line);
    let token = parser.parse_token();
    let marker = parser.next().ok_or_else(|| "empty MI record".to_owned())?;
    match marker {
        '^' => parser.parse_result_record(token),
        '*' | '+' | '=' => parser.parse_async_record(token, marker),
        '~' | '@' | '&' => parser.parse_stream_record(marker),
        _ => Err(format!("unsupported MI record marker {marker:?}")),
    }
}

struct Parser<'a> {
    source: &'a [u8],
    position: usize,
}

impl<'a> Parser<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source: source.as_bytes(),
            position: 0,
        }
    }

    fn peek(&self) -> Option<char> {
        self.source.get(self.position).copied().map(char::from)
    }

    fn next(&mut self) -> Option<char> {
        let value = self.peek()?;
        self.position += 1;
        Some(value)
    }

    fn parse_token(&mut self) -> Option<u64> {
        let start = self.position;
        while self.peek().is_some_and(|value| value.is_ascii_digit()) {
            self.position += 1;
        }
        if self.position == start {
            None
        } else {
            std::str::from_utf8(&self.source[start..self.position])
                .ok()?
                .parse()
                .ok()
        }
    }

    fn parse_result_record(&mut self, token: Option<u64>) -> Result<MiRecord, String> {
        let class = self.parse_identifier()?;
        let results = self.parse_results()?;
        self.ensure_end()?;
        Ok(MiRecord::Result {
            token,
            class,
            results,
        })
    }

    fn parse_async_record(&mut self, token: Option<u64>, marker: char) -> Result<MiRecord, String> {
        let kind = match marker {
            '*' => MiAsyncKind::Exec,
            '+' => MiAsyncKind::Status,
            '=' => MiAsyncKind::Notify,
            _ => unreachable!(),
        };
        let class = self.parse_identifier()?;
        let results = self.parse_results()?;
        self.ensure_end()?;
        Ok(MiRecord::Async {
            token,
            kind,
            class,
            results,
        })
    }

    fn parse_stream_record(&mut self, marker: char) -> Result<MiRecord, String> {
        let kind = match marker {
            '~' => MiStreamKind::Console,
            '@' => MiStreamKind::Target,
            '&' => MiStreamKind::Log,
            _ => unreachable!(),
        };
        let text = self.parse_c_string()?;
        self.ensure_end()?;
        Ok(MiRecord::Stream { kind, text })
    }

    fn parse_results(&mut self) -> Result<Vec<MiResult>, String> {
        let mut results = Vec::new();
        while self.peek() == Some(',') {
            self.position += 1;
            results.push(self.parse_result()?);
        }
        Ok(results)
    }

    fn parse_result(&mut self) -> Result<MiResult, String> {
        let variable = self.parse_identifier()?;
        self.expect('=')?;
        Ok(MiResult {
            variable,
            value: self.parse_value()?,
        })
    }

    fn parse_value(&mut self) -> Result<MiValue, String> {
        match self.peek() {
            Some('"') => self.parse_c_string().map(MiValue::Const),
            Some('{') => self.parse_tuple(),
            Some('[') => self.parse_list(),
            other => Err(format!("expected MI value, found {other:?}")),
        }
    }

    fn parse_tuple(&mut self) -> Result<MiValue, String> {
        self.expect('{')?;
        let mut results = Vec::new();
        if self.peek() != Some('}') {
            results.push(self.parse_result()?);
            while self.peek() == Some(',') {
                self.position += 1;
                results.push(self.parse_result()?);
            }
        }
        self.expect('}')?;
        Ok(MiValue::Tuple(results))
    }

    fn parse_list(&mut self) -> Result<MiValue, String> {
        self.expect('[')?;
        let mut values = Vec::new();
        while self.peek() != Some(']') {
            if self.peek().is_none() {
                return Err("unterminated MI list".to_owned());
            }
            let saved = self.position;
            let item = match self.parse_identifier() {
                Ok(variable) if self.peek() == Some('=') => {
                    self.position += 1;
                    MiListItem::Result(MiResult {
                        variable,
                        value: self.parse_value()?,
                    })
                }
                _ => {
                    self.position = saved;
                    MiListItem::Value(self.parse_value()?)
                }
            };
            values.push(item);
            if self.peek() == Some(',') {
                self.position += 1;
            } else if self.peek() != Some(']') {
                return Err("expected ',' or ']' in MI list".to_owned());
            }
        }
        self.expect(']')?;
        Ok(MiValue::List(values))
    }

    fn parse_identifier(&mut self) -> Result<String, String> {
        let start = self.position;
        while self
            .peek()
            .is_some_and(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.'))
        {
            self.position += 1;
        }
        if start == self.position {
            return Err(format!("expected MI identifier at byte {}", self.position));
        }
        Ok(String::from_utf8_lossy(&self.source[start..self.position]).into_owned())
    }

    fn parse_c_string(&mut self) -> Result<String, String> {
        self.expect('"')?;
        let mut bytes = Vec::new();
        loop {
            let value = self
                .source
                .get(self.position)
                .copied()
                .ok_or_else(|| "unterminated MI C string".to_owned())?;
            self.position += 1;
            match value {
                b'"' => break,
                b'\\' => {
                    let escaped = self
                        .source
                        .get(self.position)
                        .copied()
                        .ok_or_else(|| "unterminated MI escape".to_owned())?;
                    self.position += 1;
                    match escaped {
                        b'n' => bytes.push(b'\n'),
                        b'r' => bytes.push(b'\r'),
                        b't' => bytes.push(b'\t'),
                        b'b' => bytes.push(8),
                        b'f' => bytes.push(12),
                        b'v' => bytes.push(11),
                        b'a' => bytes.push(7),
                        b'\\' => bytes.push(b'\\'),
                        b'"' => bytes.push(b'"'),
                        b'0'..=b'7' => {
                            let mut octal = u32::from(escaped - b'0');
                            for _ in 0..2 {
                                let Some(next) = self.source.get(self.position).copied() else {
                                    break;
                                };
                                if !(b'0'..=b'7').contains(&next) {
                                    break;
                                }
                                self.position += 1;
                                octal = octal * 8 + u32::from(next - b'0');
                            }
                            bytes.push((octal & 0xff) as u8);
                        }
                        other => bytes.push(other),
                    }
                }
                other => bytes.push(other),
            }
        }
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn expect(&mut self, expected: char) -> Result<(), String> {
        match self.next() {
            Some(actual) if actual == expected => Ok(()),
            actual => Err(format!("expected {expected:?}, found {actual:?}")),
        }
    }

    fn ensure_end(&self) -> Result<(), String> {
        if self.position == self.source.len() {
            Ok(())
        } else {
            Err(format!("unexpected MI content at byte {}", self.position))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_result_records_with_nested_values() {
        let record = parse_record(
            r#"17^done,stack=[frame={level="0",func="solve",file="main.cpp",line="12"}],value="a\n\"b""#,
        ).unwrap();
        let MiRecord::Result {
            token,
            class,
            results,
        } = record
        else {
            panic!("expected result record");
        };
        assert_eq!(token, Some(17));
        assert_eq!(class, "done");
        assert_eq!(const_field(&results, "value"), Some("a\n\"b"));
        assert_eq!(
            field(&results, "stack").unwrap().as_list().unwrap().len(),
            1
        );
    }

    #[test]
    fn parses_async_stop_and_target_stream() {
        let stopped = parse_record(
            r#"*stopped,reason="breakpoint-hit",thread-id="1",frame={func="main",line="7"}"#,
        )
        .unwrap();
        let MiRecord::Async {
            kind,
            class,
            results,
            ..
        } = stopped
        else {
            panic!("expected async record");
        };
        assert_eq!(kind, MiAsyncKind::Exec);
        assert_eq!(class, "stopped");
        assert_eq!(const_field(&results, "reason"), Some("breakpoint-hit"));
        assert_eq!(
            parse_record(r#"@"answer: 42\n""#).unwrap(),
            MiRecord::Stream {
                kind: MiStreamKind::Target,
                text: "answer: 42\n".to_owned()
            }
        );
    }

    #[test]
    fn parses_breakpoint_lists_and_octal_escapes() {
        let record = parse_record(
            r#"3^done,BreakpointTable={body=[bkpt={number="1",fullname="C:\134work\134main.cpp",line="9"}]}"#,
        ).unwrap();
        let MiRecord::Result { results, .. } = record else {
            panic!("expected result record")
        };
        let body = field(&results, "BreakpointTable")
            .and_then(MiValue::as_tuple)
            .and_then(|table| field(table, "body"))
            .and_then(MiValue::as_list)
            .unwrap();
        assert_eq!(body.len(), 1);
    }

    #[test]
    fn rejects_truncated_records() {
        assert!(parse_record(r#"1^done,value="unterminated"#).is_err());
        assert!(parse_record("*stopped,frame={line=\"2\"").is_err());
    }
}
