use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompileProfile {
    Release,
    Debug,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompilerConfig {
    pub compiler_path: String,
    pub standard: String,
    pub release_args: Vec<String>,
    pub debug_args: Vec<String>,
    pub max_output_bytes: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileRequest {
    #[serde(default)]
    pub client_task_id: Option<String>,
    pub source_path: String,
    pub profile: CompileProfile,
    pub config: CompilerConfig,
    #[serde(default)]
    pub expected_source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileDiagnostic {
    pub path: String,
    pub range: crate::lsp::LspRange,
    pub severity: u8,
    pub message: String,
    pub source: String,
    pub code: String,
    pub file_level: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub command: Vec<String>,
    pub working_directory: String,
    pub task_id: String,
    pub diagnostics: Vec<CompileDiagnostic>,
    pub source_changed: bool,
    pub success: bool,
    pub executable_path: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub output_truncated: bool,
}
