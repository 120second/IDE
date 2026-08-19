use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TestcaseKind {
    Sample,
    Custom,
    Hack,
}

impl TestcaseKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Sample => "sample",
            Self::Custom => "custom",
            Self::Hack => "hack",
        }
    }

    pub(crate) fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "sample" => Ok(Self::Sample),
            "custom" => Ok(Self::Custom),
            "hack" => Ok(Self::Hack),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Testcase {
    pub id: i64,
    pub source_path: String,
    pub kind: TestcaseKind,
    pub name: String,
    pub input: String,
    pub expected_output: String,
    pub enabled: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestcaseInput {
    pub source_path: String,
    pub kind: TestcaseKind,
    pub name: String,
    pub input: String,
    pub expected_output: String,
    pub enabled: bool,
}
