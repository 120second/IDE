use tauri::State;

use crate::{performance::PerformanceSnapshot, state::AppState};

#[tauri::command]
pub fn get_performance_snapshot(state: State<'_, AppState>) -> PerformanceSnapshot {
    let active_process_count = usize::from(state.runner.active_run_id().is_some())
        + usize::from(state.debugger.is_active())
        + usize::from(state.stress.active_session_id().is_some())
        + usize::from(state.lsp.is_active());
    state.performance.snapshot(active_process_count)
}
