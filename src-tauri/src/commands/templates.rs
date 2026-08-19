use tauri::State;

use crate::{
    error::CommandError,
    state::AppState,
    templates::{
        self as template_core, TemplateCategory, TemplateDetail, TemplateFilter, TemplateInput,
        TemplateMetadata, TemplateVersionDetail, TemplateVersionMetadata,
    },
};

#[tauri::command(async)]
pub fn list_template_categories(
    state: State<'_, AppState>,
) -> Result<Vec<TemplateCategory>, CommandError> {
    template_core::list_categories(&state.paths.database_file).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn create_template_category(
    name: String,
    parent_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<TemplateCategory, CommandError> {
    template_core::create_category(&state.paths.database_file, &name, parent_id)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn rename_template_category(
    id: i64,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    template_core::rename_category(&state.paths.database_file, id, &name)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn delete_template_category(id: i64, state: State<'_, AppState>) -> Result<(), CommandError> {
    template_core::delete_category(&state.paths.database_file, id).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn move_template_category(
    id: i64,
    parent_id: Option<i64>,
    target_index: usize,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    template_core::move_category(&state.paths.database_file, id, parent_id, target_index)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn list_templates(
    filter: TemplateFilter,
    state: State<'_, AppState>,
) -> Result<Vec<TemplateMetadata>, CommandError> {
    template_core::list_templates(&state.paths.database_file, &filter).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn get_template(id: i64, state: State<'_, AppState>) -> Result<TemplateDetail, CommandError> {
    template_core::get_template(&state.paths.database_file, id).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn create_template(
    input: TemplateInput,
    state: State<'_, AppState>,
) -> Result<TemplateDetail, CommandError> {
    template_core::create_template(&state.paths.database_file, &input).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn update_template(
    id: i64,
    input: TemplateInput,
    state: State<'_, AppState>,
) -> Result<TemplateDetail, CommandError> {
    template_core::update_template(&state.paths.database_file, id, &input)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn delete_template(id: i64, state: State<'_, AppState>) -> Result<(), CommandError> {
    template_core::delete_template(&state.paths.database_file, id).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn set_template_favorite(
    id: i64,
    favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    template_core::set_favorite(&state.paths.database_file, id, favorite)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn record_template_use(id: i64, state: State<'_, AppState>) -> Result<(), CommandError> {
    template_core::record_use(&state.paths.database_file, id).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn move_template(
    id: i64,
    category_id: Option<i64>,
    target_index: usize,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    template_core::move_template(&state.paths.database_file, id, category_id, target_index)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn list_template_versions(
    template_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<TemplateVersionMetadata>, CommandError> {
    template_core::list_versions(&state.paths.database_file, template_id)
        .map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn get_template_version(
    version_id: i64,
    state: State<'_, AppState>,
) -> Result<TemplateVersionDetail, CommandError> {
    template_core::get_version(&state.paths.database_file, version_id).map_err(CommandError::from)
}

#[tauri::command(async)]
pub fn restore_template_version(
    template_id: i64,
    version_id: i64,
    state: State<'_, AppState>,
) -> Result<TemplateDetail, CommandError> {
    template_core::restore_version(&state.paths.database_file, template_id, version_id)
        .map_err(CommandError::from)
}
