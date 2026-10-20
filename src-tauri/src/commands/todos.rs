use crate::{
    error::CommandError,
    state::AppState,
    todos::{self, ProblemTodo},
};
use tauri::State;

#[tauri::command(async)]
pub fn list_problem_todos(state: State<'_, AppState>) -> Result<Vec<ProblemTodo>, CommandError> {
    todos::list(&state.paths.database_file).map_err(Into::into)
}

#[tauri::command(async)]
pub fn save_problem_todo(
    todo: ProblemTodo,
    state: State<'_, AppState>,
) -> Result<ProblemTodo, CommandError> {
    todos::save(&state.paths.database_file, todo).map_err(Into::into)
}

#[tauri::command(async)]
pub fn delete_problem_todo(id: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    todos::delete(&state.paths.database_file, &id).map_err(Into::into)
}

#[tauri::command(async)]
pub fn open_problem_todo_url(url: String) -> Result<(), CommandError> {
    let parsed = url::Url::parse(&url)
        .map_err(|error| crate::error::AppError::Configuration(error.to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(
            crate::error::AppError::Configuration("题目链接仅支持 HTTP 或 HTTPS。".into()).into(),
        );
    }
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(parsed.as_str())
        .spawn()
        .map_err(crate::error::AppError::from)?;
    Ok(())
}
