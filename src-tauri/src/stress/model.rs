use serde::{Deserialize, Serialize};

use crate::{compiler::CompilerConfig, generator::VisualGeneratorProfile};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StressStatus {
    Compiling,
    Running,
    Failed,
    Stopped,
    Completed,
    Error,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StressRunRequest {
    pub session_id: String,
    pub solution_path: String,
    pub brute_path: String,
    pub generator_profile: VisualGeneratorProfile,
    pub iterations: u64,
    pub infinite: bool,
    pub seed: String,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
    pub compiler_config: CompilerConfig,
    #[serde(default)]
    pub start_case: u64,
    #[serde(default)]
    pub initial_passed: u64,
    #[serde(default)]
    pub initial_failed: u64,
    #[serde(default)]
    pub initial_elapsed_ms: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StressStats {
    pub total_cases: u64,
    pub passed: u64,
    pub failed: u64,
    pub elapsed_ms: u64,
    pub cases_per_second: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StressCasePassed {
    pub index: u64,
    pub seed: String,
    pub solution_time_ms: u64,
    pub brute_time_ms: u64,
    pub stats: StressStats,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StressFailure {
    pub index: u64,
    pub seed: String,
    pub next_seed: String,
    pub reason: String,
    pub input: String,
    pub solution_output: String,
    pub brute_output: String,
    pub solution_stderr: String,
    pub brute_stderr: String,
    pub solution_exit_code: Option<i32>,
    pub brute_exit_code: Option<i32>,
    pub solution_time_ms: u64,
    pub brute_time_ms: u64,
    pub stats: StressStats,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replay: Option<StressReplayContext>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StressReplayContext {
    pub app_version: String,
    pub solution_name: String,
    pub brute_name: String,
    pub solution_source: String,
    pub brute_source: String,
    pub generator_profile: VisualGeneratorProfile,
    pub compiler_config: CompilerConfig,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StressSummary {
    pub session_id: String,
    pub status: StressStatus,
    pub message: String,
    pub next_seed: String,
    pub stats: StressStats,
    pub failure: Option<StressFailure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_result: Option<StressFailure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StressEvent {
    State {
        session_id: String,
        status: StressStatus,
        message: String,
    },
    CasePassed {
        session_id: String,
        result: StressCasePassed,
    },
    CasesPassed {
        session_id: String,
        results: Vec<StressCasePassed>,
    },
    Failure {
        session_id: String,
        failure: Box<StressFailure>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn events_include_camel_case_session_ids() {
        for event in [
            StressEvent::State {
                session_id: "s".into(),
                status: StressStatus::Running,
                message: "running".into(),
            },
            StressEvent::CasesPassed {
                session_id: "s".into(),
                results: Vec::new(),
            },
        ] {
            let json = serde_json::to_value(event).unwrap();
            assert_eq!(json["sessionId"], "s");
            assert!(json.get("session_id").is_none());
        }
    }
}
