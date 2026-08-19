use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TemplateKind {
    Snippet,
    File,
}

impl TemplateKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Snippet => "snippet",
            Self::File => "file",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TemplateSort {
    Manual,
    Name,
    RecentlyUsed,
    UsageCount,
    Updated,
    Created,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateFilter {
    pub kind: TemplateKind,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub favorite_only: bool,
    #[serde(default)]
    pub recent_only: bool,
    pub category_id: Option<i64>,
    pub sort: TemplateSort,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCategory {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateMetadata {
    pub id: i64,
    pub kind: TemplateKind,
    pub name: String,
    pub trigger: String,
    pub aliases: Vec<String>,
    pub description: String,
    pub language: String,
    pub category_id: Option<i64>,
    pub favorite: bool,
    pub sort_order: i64,
    pub use_count: i64,
    pub last_used: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDetail {
    #[serde(flatten)]
    pub metadata: TemplateMetadata,
    pub code: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInput {
    pub kind: TemplateKind,
    pub name: String,
    #[serde(default)]
    pub trigger: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_language")]
    pub language: String,
    pub category_id: Option<i64>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub code: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVersionMetadata {
    pub id: i64,
    pub template_id: i64,
    pub version_number: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVersionDetail {
    pub id: i64,
    pub template_id: i64,
    pub version_number: i64,
    pub kind: TemplateKind,
    pub name: String,
    pub trigger: String,
    pub aliases: Vec<String>,
    pub description: String,
    pub language: String,
    pub category_id: Option<i64>,
    pub favorite: bool,
    pub code: String,
    pub created_at: String,
}

fn default_language() -> String {
    "cpp".to_owned()
}
