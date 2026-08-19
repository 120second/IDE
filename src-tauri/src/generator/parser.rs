use super::model::{
    Alphabet, Expression, ExpressionValue, GeneratorDiagnostic, GraphKind, Program, Statement,
    StatementKind,
};

const MAX_DSL_BYTES: usize = 1024 * 1024;
const MAX_DSL_LINES: usize = 5_000;
const MAX_NESTING: usize = 64;

#[derive(Debug)]
struct SourceLine {
    number: usize,
    indent: usize,
    text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TokenKind {
    Word(String),
    Number(i64),
    Symbol(char),
}

#[derive(Debug, Clone)]
struct Token {
    kind: TokenKind,
    column: usize,
}

pub(crate) fn parse(source: &str) -> Result<Program, GeneratorDiagnostic> {
    if source.len() > MAX_DSL_BYTES {
        return Err(GeneratorDiagnostic::new(1, 1, "生成规则不能超过 1 MiB。"));
    }
    let lines = source_lines(source)?;
    if lines.is_empty() {
        return Err(GeneratorDiagnostic::new(1, 1, "生成规则不能为空。"));
    }
    if lines[0].indent != 0 {
        return Err(GeneratorDiagnostic::new(
            lines[0].number,
            1,
            "顶层语句不能缩进。",
        ));
    }
    let (statements, next) = parse_block(&lines, 0, 0, 0)?;
    if next != lines.len() {
        let line = &lines[next];
        return Err(GeneratorDiagnostic::new(
            line.number,
            line.indent + 1,
            "缩进层级不正确。",
        ));
    }
    Ok(Program { statements })
}

fn source_lines(source: &str) -> Result<Vec<SourceLine>, GeneratorDiagnostic> {
    let mut result = Vec::new();
    for (index, raw) in source.lines().enumerate() {
        if index >= MAX_DSL_LINES {
            return Err(GeneratorDiagnostic::new(
                index + 1,
                1,
                format!("生成规则不能超过 {MAX_DSL_LINES} 行。"),
            ));
        }
        if let Some(tab) = raw.find('\t') {
            return Err(GeneratorDiagnostic::new(
                index + 1,
                tab + 1,
                "请使用空格缩进，不能使用制表符。",
            ));
        }
        let without_comment = raw.split_once('#').map_or(raw, |(head, _)| head);
        if without_comment.trim().is_empty() {
            continue;
        }
        let indent = without_comment.len() - without_comment.trim_start().len();
        result.push(SourceLine {
            number: index + 1,
            indent,
            text: without_comment.trim().to_owned(),
        });
    }
    Ok(result)
}

fn parse_block(
    lines: &[SourceLine],
    mut index: usize,
    indent: usize,
    depth: usize,
) -> Result<(Vec<Statement>, usize), GeneratorDiagnostic> {
    let mut statements = Vec::new();
    while index < lines.len() {
        let line = &lines[index];
        if line.indent < indent {
            break;
        }
        if line.indent > indent {
            return Err(GeneratorDiagnostic::new(
                line.number,
                line.indent + 1,
                "这里出现了多余的缩进。只有 repeat 的内容需要缩进。",
            ));
        }

        if line.text.starts_with("repeat ") || line.text.starts_with("repeat:") {
            if depth >= MAX_NESTING {
                return Err(GeneratorDiagnostic::new(
                    line.number,
                    line.indent + 1,
                    format!("repeat 最多嵌套 {MAX_NESTING} 层。"),
                ));
            }
            let tokens = tokenize(line)?;
            let mut cursor = Cursor::new(line, tokens);
            cursor.expect_word("repeat")?;
            let count = cursor.expression()?;
            cursor.expect_symbol(':')?;
            cursor.finish()?;
            let body_index = index + 1;
            if body_index >= lines.len() || lines[body_index].indent <= indent {
                return Err(GeneratorDiagnostic::new(
                    line.number,
                    line.text.len() + line.indent + 1,
                    "repeat 后面至少需要一条缩进语句。",
                ));
            }
            let body_indent = lines[body_index].indent;
            let (body, next) = parse_block(lines, body_index, body_indent, depth + 1)?;
            statements.push(Statement {
                line: line.number,
                column: line.indent + 1,
                name: None,
                kind: StatementKind::Repeat { count, body },
            });
            index = next;
            continue;
        }

        statements.push(parse_named_statement(line)?);
        index += 1;
    }
    Ok((statements, index))
}

fn parse_named_statement(line: &SourceLine) -> Result<Statement, GeneratorDiagnostic> {
    let tokens = tokenize(line)?;
    let mut cursor = Cursor::new(line, tokens);
    let (name, name_column) = cursor.word("这里需要变量名。")?;
    if !valid_identifier(&name) {
        return Err(GeneratorDiagnostic::new(
            line.number,
            name_column,
            "变量名只能包含字母、数字和下划线，且不能以数字开头。",
        ));
    }
    cursor.expect_symbol(':')?;
    let (kind_name, kind_column) = cursor.word("冒号后面需要数据类型。")?;
    let kind = match kind_name.as_str() {
        "int" => {
            let (minimum, maximum) = cursor.range()?;
            StatementKind::Integer { minimum, maximum }
        }
        "array" => {
            let length = cursor.bracket_expression()?;
            cursor.expect_word("int")?;
            let (minimum, maximum) = cursor.range()?;
            StatementKind::Array {
                length,
                minimum,
                maximum,
                unique: false,
            }
        }
        "matrix" => {
            let rows = cursor.bracket_expression()?;
            let columns = cursor.bracket_expression()?;
            cursor.expect_word("int")?;
            let (minimum, maximum) = cursor.range()?;
            StatementKind::Matrix {
                rows,
                columns,
                minimum,
                maximum,
            }
        }
        "pair" => {
            cursor.expect_word("int")?;
            let (first_minimum, first_maximum) = cursor.range()?;
            cursor.expect_word("int")?;
            let (second_minimum, second_maximum) = cursor.range()?;
            StatementKind::Pair {
                first_minimum,
                first_maximum,
                second_minimum,
                second_maximum,
            }
        }
        "string" => {
            let length = cursor.bracket_expression()?;
            let (alphabet_name, column) = cursor.word("string 后需要 binary 或 lowercase。")?;
            let alphabet = alphabet(&alphabet_name).ok_or_else(|| {
                GeneratorDiagnostic::new(
                    line.number,
                    column,
                    "字符串字符集只能是 binary 或 lowercase。",
                )
            })?;
            StatementKind::String { length, alphabet }
        }
        "permutation" => StatementKind::Permutation {
            length: cursor.call_one_argument()?,
        },
        "unique_array" => {
            cursor.expect_symbol('(')?;
            let length = cursor.expression()?;
            cursor.expect_symbol(',')?;
            let minimum = cursor.expression()?;
            cursor.expect_symbol(',')?;
            let maximum = cursor.expression()?;
            cursor.expect_symbol(')')?;
            StatementKind::Array {
                length,
                minimum,
                maximum,
                unique: true,
            }
        }
        "binary_string" | "lowercase_string" => StatementKind::String {
            length: cursor.call_one_argument()?,
            alphabet: if kind_name == "binary_string" {
                Alphabet::Binary
            } else {
                Alphabet::Lowercase
            },
        },
        "tree" => StatementKind::Tree {
            nodes: cursor.call_one_argument()?,
            weight: None,
        },
        "weighted_tree" => {
            cursor.expect_symbol('(')?;
            let nodes = cursor.expression()?;
            cursor.expect_symbol(',')?;
            cursor.expect_word("weight")?;
            cursor.expect_symbol('=')?;
            let weight = Some(cursor.range()?);
            cursor.expect_symbol(')')?;
            StatementKind::Tree { nodes, weight }
        }
        "simple_graph" | "connected_graph" | "dag" => {
            cursor.expect_symbol('(')?;
            let nodes = cursor.expression()?;
            cursor.expect_symbol(',')?;
            let edges = cursor.expression()?;
            cursor.expect_symbol(')')?;
            let kind = match kind_name.as_str() {
                "simple_graph" => GraphKind::Simple,
                "connected_graph" => GraphKind::Connected,
                _ => GraphKind::Dag,
            };
            StatementKind::Graph { nodes, edges, kind }
        }
        _ => {
            return Err(GeneratorDiagnostic::new(
                line.number,
                kind_column,
                format!("不支持的数据类型“{kind_name}”。"),
            ));
        }
    };
    cursor.finish()?;
    Ok(Statement {
        line: line.number,
        column: name_column,
        name: Some(name),
        kind,
    })
}

fn alphabet(value: &str) -> Option<Alphabet> {
    match value {
        "binary" => Some(Alphabet::Binary),
        "lowercase" => Some(Alphabet::Lowercase),
        _ => None,
    }
}

fn valid_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn tokenize(line: &SourceLine) -> Result<Vec<Token>, GeneratorDiagnostic> {
    let mut tokens = Vec::new();
    let bytes = line.text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte.is_ascii_whitespace() {
            index += 1;
            continue;
        }
        let column = line.indent + index + 1;
        if byte.is_ascii_alphabetic() || byte == b'_' {
            let start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            tokens.push(Token {
                kind: TokenKind::Word(line.text[start..index].to_owned()),
                column,
            });
            continue;
        }
        if byte.is_ascii_digit()
            || (byte == b'-' && index + 1 < bytes.len() && bytes[index + 1].is_ascii_digit())
        {
            let start = index;
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            let value = line.text[start..index].parse::<i64>().map_err(|_| {
                GeneratorDiagnostic::new(line.number, column, "整数超出了 int64 可表示范围。")
            })?;
            tokens.push(Token {
                kind: TokenKind::Number(value),
                column,
            });
            continue;
        }
        if b":[](),=".contains(&byte) {
            tokens.push(Token {
                kind: TokenKind::Symbol(byte as char),
                column,
            });
            index += 1;
            continue;
        }
        return Err(GeneratorDiagnostic::new(
            line.number,
            column,
            format!("无法识别字符“{}”。", byte as char),
        ));
    }
    Ok(tokens)
}

struct Cursor<'a> {
    line: &'a SourceLine,
    tokens: Vec<Token>,
    index: usize,
}

impl<'a> Cursor<'a> {
    fn new(line: &'a SourceLine, tokens: Vec<Token>) -> Self {
        Self {
            line,
            tokens,
            index: 0,
        }
    }

    fn current(&self) -> Option<&Token> {
        self.tokens.get(self.index)
    }

    fn word(&mut self, message: &str) -> Result<(String, usize), GeneratorDiagnostic> {
        match self.current().cloned() {
            Some(Token {
                kind: TokenKind::Word(value),
                column,
            }) => {
                self.index += 1;
                Ok((value, column))
            }
            Some(token) => Err(GeneratorDiagnostic::new(
                self.line.number,
                token.column,
                message,
            )),
            None => Err(self.end_error(message)),
        }
    }

    fn expect_word(&mut self, expected: &str) -> Result<(), GeneratorDiagnostic> {
        let (actual, column) = self.word(&format!("这里需要“{expected}”。"))?;
        if actual == expected {
            Ok(())
        } else {
            Err(GeneratorDiagnostic::new(
                self.line.number,
                column,
                format!("这里需要“{expected}”，实际是“{actual}”。"),
            ))
        }
    }

    fn expect_symbol(&mut self, expected: char) -> Result<(), GeneratorDiagnostic> {
        match self.current().cloned() {
            Some(Token {
                kind: TokenKind::Symbol(actual),
                column: _,
            }) if actual == expected => {
                self.index += 1;
                Ok(())
            }
            Some(token) => Err(GeneratorDiagnostic::new(
                self.line.number,
                token.column,
                format!("这里需要“{expected}”。"),
            )),
            None => Err(self.end_error(&format!("行末缺少“{expected}”。"))),
        }
    }

    fn expression(&mut self) -> Result<Expression, GeneratorDiagnostic> {
        match self.current().cloned() {
            Some(Token {
                kind: TokenKind::Number(value),
                column,
            }) => {
                self.index += 1;
                Ok(Expression {
                    line: self.line.number,
                    column,
                    value: ExpressionValue::Literal(value),
                })
            }
            Some(Token {
                kind: TokenKind::Word(value),
                column,
            }) => {
                self.index += 1;
                Ok(Expression {
                    line: self.line.number,
                    column,
                    value: ExpressionValue::Variable(value),
                })
            }
            Some(token) => Err(GeneratorDiagnostic::new(
                self.line.number,
                token.column,
                "这里需要整数或已定义变量。",
            )),
            None => Err(self.end_error("行末缺少整数或变量。")),
        }
    }

    fn bracket_expression(&mut self) -> Result<Expression, GeneratorDiagnostic> {
        self.expect_symbol('[')?;
        let expression = self.expression()?;
        self.expect_symbol(']')?;
        Ok(expression)
    }

    fn range(&mut self) -> Result<(Expression, Expression), GeneratorDiagnostic> {
        self.expect_symbol('[')?;
        let minimum = self.expression()?;
        self.expect_symbol(',')?;
        let maximum = self.expression()?;
        self.expect_symbol(']')?;
        Ok((minimum, maximum))
    }

    fn call_one_argument(&mut self) -> Result<Expression, GeneratorDiagnostic> {
        self.expect_symbol('(')?;
        let value = self.expression()?;
        self.expect_symbol(')')?;
        Ok(value)
    }

    fn finish(&self) -> Result<(), GeneratorDiagnostic> {
        if let Some(token) = self.current() {
            Err(GeneratorDiagnostic::new(
                self.line.number,
                token.column,
                "这一行末尾还有无法解析的内容。",
            ))
        } else {
            Ok(())
        }
    }

    fn end_error(&self, message: &str) -> GeneratorDiagnostic {
        GeneratorDiagnostic::new(
            self.line.number,
            self.line.indent + self.line.text.len() + 1,
            message,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_repeat_and_references() {
        let program = parse("q : int [1, 3]\nrepeat q:\n  l : int [1, q]\n  r : int [l, q]")
            .expect("DSL should parse");
        assert_eq!(program.statements.len(), 2);
        match &program.statements[1].kind {
            StatementKind::Repeat { body, .. } => assert_eq!(body.len(), 2),
            _ => panic!("expected repeat"),
        }
    }

    #[test]
    fn reports_precise_syntax_location() {
        let error = parse("n : int [1 10]").expect_err("missing comma should fail");
        assert_eq!(error.line, 1);
        assert_eq!(error.column, 12);
    }
}
