use serde::Serialize;
use tauri::State;

use crate::{error::CommandError, state::AppState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    status: &'static str,
    application: &'static str,
    version: &'static str,
    database_schema_version: i64,
}

#[tauri::command]
pub fn health_check(state: State<'_, AppState>) -> Result<HealthStatus, CommandError> {
    log::debug!(
        "health_check requested; data directory: {}",
        state.paths.data_dir.display()
    );

    Ok(HealthStatus {
        status: "ready",
        application: "LightCP",
        version: env!("CARGO_PKG_VERSION"),
        database_schema_version: state.database_schema_version,
    })
}
