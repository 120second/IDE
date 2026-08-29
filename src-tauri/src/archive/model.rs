use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveStatus {
    Unfinished,
    Completed,
    Review,
    Mastered,
}

impl ArchiveStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Unfinished => "unfinished",
            Self::Completed => "completed",
            Self::Review => "review",
            Self::Mastered => "mastered",
        }
    }

    pub(crate) fn from_text(value: &str) -> Self {
        match value {
            "completed" => Self::Completed,
            "review" => Self::Review,
            "mastered" => Self::Mastered,
            _ => Self::Unfinished,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFile {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub platform: String,
    pub status: ArchiveStatus,
    pub note: String,
    pub favorite: bool,
    pub archived: bool,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened: Option<String>,
    pub review_step: Option<i64>,
    pub next_review_at: Option<String>,
    pub last_reviewed_at: Option<String>,
    pub review_completed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveInput {
    pub path: String,
    pub title: String,
    #[serde(default)]
    pub platform: String,
    pub status: ArchiveStatus,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveQuery {
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub inbox_only: bool,
    #[serde(default)]
    pub favorite_only: bool,
    #[serde(default)]
    pub recent_only: bool,
    #[serde(default)]
    pub review_only: bool,
    pub platform: Option<String>,
    pub status: Option<ArchiveStatus>,
    pub tag: Option<String>,
    pub collection_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBulkInput {
    pub file_ids: Vec<i64>,
    #[serde(default)]
    pub add_tags: Vec<String>,
    pub platform: Option<String>,
    pub status: Option<ArchiveStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFacets {
    pub inbox_count: i64,
    pub favorite_count: i64,
    pub recent_count: i64,
    pub completed_count: i64,
    pub review_count: i64,
    pub due_review_count: i64,
    pub platforms: Vec<NamedCount>,
    pub tags: Vec<NamedCount>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCollectionInput {
    pub name: String,
    pub platform: Option<String>,
    pub status: Option<ArchiveStatus>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCollection {
    pub id: i64,
    pub name: String,
    pub platform: Option<String>,
    pub status: Option<ArchiveStatus>,
    pub tags: Vec<String>,
    pub count: i64,
    pub created_at: String,
    pub updated_at: String,
}
