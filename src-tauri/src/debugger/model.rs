use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DebugSessionState {
    #[default]
    Idle,
    Starting,
    Running,
    Stopped,
    Exited,
    Error,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugBreakpointInput {
    pub id: String,
    pub file: String,
    pub line: u32,
    #[serde(default = "enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub condition: String,
}

fn enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugBreakpoint {
    pub id: String,
    pub file: String,
    pub line: u32,
    pub enabled: bool,
    pub condition: String,
    pub verified: bool,
    pub gdb_number: Option<String>,
    pub message: String,
}

impl From<&DebugBreakpointInput> for DebugBreakpoint {
    fn from(value: &DebugBreakpointInput) -> Self {
        Self {
            id: value.id.clone(),
            file: value.file.clone(),
            line: value.line,
            enabled: value.enabled,
            condition: value.condition.clone(),
            verified: false,
            gdb_number: None,
            message: String::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStartRequest {
    pub gdb_path: String,
    pub executable_path: String,
    pub source_path: String,
    pub working_directory: String,
    #[serde(default)]
    pub stdin: String,
    #[serde(default)]
    pub breakpoints: Vec<DebugBreakpointInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugFrame {
    pub level: u32,
    pub address: String,
    pub function: String,
    pub file: String,
    pub full_name: String,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariable {
    pub name: String,
    pub expression: String,
    pub value: String,
    pub type_name: String,
    pub num_children: u32,
    pub has_children: bool,
    pub variable_object: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariablePage {
    pub parent_expression: String,
    pub variable_object: String,
    pub from: u32,
    pub total: u32,
    pub has_more: bool,
    pub children: Vec<DebugVariable>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugWatchValue {
    pub expression: String,
    pub value: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionSnapshot {
    pub session_id: String,
    pub state: DebugSessionState,
    pub reason: String,
    pub selected_frame: u32,
    pub frames: Vec<DebugFrame>,
    pub variables: Vec<DebugVariable>,
    pub watches: Vec<DebugWatchValue>,
    pub breakpoints: Vec<DebugBreakpoint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DebugEvent {
    State {
        session_id: String,
        state: DebugSessionState,
        reason: String,
    },
    Output {
        session_id: String,
        stream: String,
        text: String,
    },
    Breakpoints {
        session_id: String,
        breakpoints: Vec<DebugBreakpoint>,
    },
}
