use crate::{
    error::{AppError, CommandError},
    generator::{
        self as generator_core, GenerateRequest, GenerateResult, ValidationResult,
        VisualGenerateRequest, VisualGenerateResult, VisualGeneratorProfile,
        VisualValidationResult,
    },
    state::AppState,
};
use tauri::State;

#[tauri::command]
pub fn validate_generator_dsl(dsl: String) -> ValidationResult {
    generator_core::validate(&dsl)
}

#[tauri::command]
pub async fn generate_random_cases(
    request: GenerateRequest,
) -> Result<GenerateResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || generator_core::generate(&request))
        .await
        .map_err(|error| {
            CommandError::from(AppError::Internal(format!(
                "generator task could not be joined: {error}"
            )))
        })
}

#[tauri::command]
pub fn validate_visual_generator(profile: VisualGeneratorProfile) -> VisualValidationResult {
    generator_core::validate_visual(&profile)
}

#[tauri::command]
pub async fn generate_visual_cases(
    request: VisualGenerateRequest,
) -> Result<VisualGenerateResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || generator_core::generate_visual(&request))
        .await
        .map_err(|error| {
            CommandError::from(AppError::Internal(format!(
                "visual generator task could not be joined: {error}"
            )))
        })
}

#[tauri::command]
pub fn load_generator_profile(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<Option<VisualGeneratorProfile>, CommandError> {
    let root = state.active_workspace_root().map_err(CommandError::from)?;
    generator_core::load_profile(&state.paths.database_file, &root, &source_path)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn save_generator_profile(
    source_path: String,
    profile: VisualGeneratorProfile,
    state: State<'_, AppState>,
) -> Result<VisualGeneratorProfile, CommandError> {
    let root = state.active_workspace_root().map_err(CommandError::from)?;
    generator_core::save_profile(&state.paths.database_file, &root, &source_path, &profile)
        .map_err(CommandError::from)
}
