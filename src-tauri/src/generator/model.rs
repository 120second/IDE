use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GeneratorStrategy {
    Random,
    Minimum,
    Maximum,
    Small,
    Large,
    AllSame,
    HighDuplicate,
    Ascending,
    Descending,
    Extreme,
    Mixed,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TreeShape {
    Random,
    Chain,
    Star,
    Balanced,
    Broom,
    Mixed,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub dsl: String,
    pub strategy: GeneratorStrategy,
    pub tree_shape: TreeShape,
    /// Decimal text is used so JavaScript never rounds a uint64 seed.
    pub seed: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorDiagnostic {
    pub line: usize,
    pub column: usize,
    pub message: String,
}

impl GeneratorDiagnostic {
    pub(crate) fn new(line: usize, column: usize, message: impl Into<String>) -> Self {
        Self {
            line,
            column,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub diagnostic: Option<GeneratorDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCase {
    pub seed: String,
    pub input: String,
    pub size_bytes: usize,
    pub generation_time_micros: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    pub cases: Vec<GeneratedCase>,
    pub diagnostic: Option<GeneratorDiagnostic>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualGeneratorProfile {
    pub version: u32,
    pub nodes: Vec<VisualNode>,
    pub strategy: GeneratorStrategy,
    pub tree_shape: TreeShape,
    pub seed: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualGenerateRequest {
    pub profile: VisualGeneratorProfile,
    pub count: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum VisualNode {
    Line {
        id: String,
        fields: Vec<VisualField>,
    },
    Repeat {
        id: String,
        count: ValueExpression,
        children: Vec<VisualNode>,
    },
    Tree {
        id: String,
        nodes: ValueExpression,
        index_base: u8,
        shape: Option<TreeShape>,
        weight: Option<VisualRange>,
    },
    Graph {
        id: String,
        nodes: ValueExpression,
        edges: ValueExpression,
        index_base: u8,
        kind: VisualGraphKind,
    },
    Matrix {
        id: String,
        name: String,
        rows: ValueExpression,
        columns: ValueExpression,
        minimum: ValueExpression,
        maximum: ValueExpression,
        strategy: Option<GeneratorStrategy>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum VisualField {
    Integer {
        id: String,
        name: String,
        minimum: ValueExpression,
        maximum: ValueExpression,
    },
    Array {
        id: String,
        name: String,
        length: ValueExpression,
        minimum: ValueExpression,
        maximum: ValueExpression,
        strategy: Option<GeneratorStrategy>,
    },
    String {
        id: String,
        name: String,
        length: ValueExpression,
        alphabet: VisualAlphabet,
    },
    Permutation {
        id: String,
        name: String,
        length: ValueExpression,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ValueExpression {
    Constant { value: String },
    Variable { name: String, offset: i64 },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualRange {
    pub minimum: ValueExpression,
    pub maximum: ValueExpression,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VisualAlphabet {
    Binary,
    Lowercase,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VisualGraphKind {
    SimpleUndirected,
    ConnectedUndirected,
    Dag,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualDiagnostic {
    pub node_id: String,
    pub field_id: Option<String>,
    pub message: String,
}

impl VisualDiagnostic {
    pub(crate) fn node(node_id: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            node_id: node_id.into(),
            field_id: None,
            message: message.into(),
        }
    }

    pub(crate) fn field(
        node_id: impl Into<String>,
        field_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            node_id: node_id.into(),
            field_id: Some(field_id.into()),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualValidationResult {
    pub valid: bool,
    pub diagnostics: Vec<VisualDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualGenerateResult {
    pub cases: Vec<GeneratedCase>,
    pub diagnostics: Vec<VisualDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Program {
    pub statements: Vec<Statement>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Statement {
    pub line: usize,
    pub column: usize,
    pub name: Option<String>,
    pub kind: StatementKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StatementKind {
    Integer {
        minimum: Expression,
        maximum: Expression,
    },
    Array {
        length: Expression,
        minimum: Expression,
        maximum: Expression,
        unique: bool,
    },
    Pair {
        first_minimum: Expression,
        first_maximum: Expression,
        second_minimum: Expression,
        second_maximum: Expression,
    },
    Matrix {
        rows: Expression,
        columns: Expression,
        minimum: Expression,
        maximum: Expression,
    },
    String {
        length: Expression,
        alphabet: Alphabet,
    },
    Permutation {
        length: Expression,
    },
    Repeat {
        count: Expression,
        body: Vec<Statement>,
    },
    Tree {
        nodes: Expression,
        weight: Option<(Expression, Expression)>,
    },
    Graph {
        nodes: Expression,
        edges: Expression,
        kind: GraphKind,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Alphabet {
    Binary,
    Lowercase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GraphKind {
    Simple,
    Connected,
    Dag,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Expression {
    pub line: usize,
    pub column: usize,
    pub value: ExpressionValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ExpressionValue {
    Literal(i64),
    Variable(String),
}
