use tauri::State;

use crate::{
    error::CommandError,
    state::AppState,
    testcase::{self as testcase_core, Testcase, TestcaseInput},
};

#[tauri::command(async)]
pub fn list_testcases(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<Testcase>, CommandError> {
    let root = state.active_workspace_root().map_err(CommandError::from)?;
    testcase_core::list(&state.paths.database_file, &root, &source_path).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn create_testcase(
    input: TestcaseInput,
    state: State<'_, AppState>,
) -> Result<Testcase, CommandError> {
    let root = state.active_workspace_root().map_err(CommandError::from)?;
    testcase_core::create(&state.paths.database_file, &root, &input).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn update_testcase(
    id: i64,
    input: TestcaseInput,
    state: State<'_, AppState>,
) -> Result<Testcase, CommandError> {
    let root = state.active_workspace_root().map_err(CommandError::from)?;
    testcase_core::update(&state.paths.database_file, &root, id, &input).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn duplicate_testcase(id: i64, state: State<'_, AppState>) -> Result<Testcase, CommandError> {
    let root = state.active_workspace_root().map_err(CommandError::from)?;
    testcase_core::duplicate(&state.paths.database_file, &root, id).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn delete_testcase(id: i64, state: State<'_, AppState>) -> Result<(), CommandError> {
    let root = state.active_workspace_root().map_err(CommandError::from)?;
    testcase_core::delete(&state.paths.database_file, &root, id).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn move_testcase(
    id: i64,
    target_index: i64,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let root = state.active_workspace_root().map_err(CommandError::from)?;
    testcase_core::move_to(&state.paths.database_file, &root, id, target_index)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn compare_testcase_output(actual: String, expected: String) -> bool {
    testcase_core::compare_output(&actual, &expected)
}
