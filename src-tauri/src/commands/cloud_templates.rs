use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use serde::Serialize;
use tauri::State;

use crate::{
    error::{AppError, AppResult, CommandError},
    server_api::{templates as cloud, ServerApi},
    state::AppState,
    templates::{
        self as local, TemplateCategory, TemplateDetail, TemplateFilter, TemplateInput,
        TemplateKind, TemplateMetadata, TemplateSort,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTemplateImportResult {
    categories_created: usize,
    categories_reused: usize,
    templates_created: usize,
    templates_skipped: usize,
    histories_skipped: bool,
}

#[tauri::command]
pub async fn cloud_import_local_templates(
    state: State<'_, AppState>,
) -> Result<LocalTemplateImportResult, CommandError> {
    import_local_templates(&state.server_api, &state.paths.database_file)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_sync_templates_to_local(
    state: State<'_, AppState>,
) -> Result<LocalTemplateImportResult, CommandError> {
    sync_cloud_templates_to_local(&state.server_api, &state.paths.database_file)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_list_template_categories(
    state: State<'_, AppState>,
) -> Result<Vec<TemplateCategory>, CommandError> {
    cloud::list_categories(&state.server_api)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_create_template_category(
    name: String,
    parent_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<TemplateCategory, CommandError> {
    cloud::create_category(&state.server_api, &name, parent_id)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_rename_template_category(
    id: i64,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    cloud::rename_category(&state.server_api, id, &name)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_delete_template_category(
    id: i64,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    cloud::delete_category(&state.server_api, id)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_move_template_category(
    id: i64,
    parent_id: Option<i64>,
    target_index: i64,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    cloud::move_category(&state.server_api, id, parent_id, target_index)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_list_templates(
    filter: TemplateFilter,
    state: State<'_, AppState>,
) -> Result<Vec<TemplateMetadata>, CommandError> {
    cloud::list_templates(&state.server_api, &filter)
        .await
        .map(|items| items.into_iter().map(cloud::metadata).collect())
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_search_template_completions(
    query: String,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<TemplateDetail>, CommandError> {
    cloud::search_completions(&state.server_api, &query, limit)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_get_template(
    id: i64,
    state: State<'_, AppState>,
) -> Result<TemplateDetail, CommandError> {
    cloud::get_template(&state.server_api, id)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_get_templates(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<TemplateDetail>, CommandError> {
    cloud::get_templates(&state.server_api, &ids)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_create_template(
    input: TemplateInput,
    state: State<'_, AppState>,
) -> Result<TemplateDetail, CommandError> {
    cloud::create_template(&state.server_api, &input)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_update_template(
    id: i64,
    input: TemplateInput,
    state: State<'_, AppState>,
) -> Result<TemplateDetail, CommandError> {
    cloud::update_template(&state.server_api, id, &input)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_delete_template(
    id: i64,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    cloud::delete_template(&state.server_api, id)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_set_template_favorite(
    id: i64,
    favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    cloud::set_favorite(&state.server_api, id, favorite)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_record_template_use(
    id: i64,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    cloud::record_use(&state.server_api, id)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn cloud_move_template(
    id: i64,
    category_id: Option<i64>,
    target_index: i64,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    cloud::move_template(&state.server_api, id, category_id, target_index)
        .await
        .map_err(CommandError::from)
}

async fn import_local_templates(
    api: &ServerApi,
    database_path: &Path,
) -> AppResult<LocalTemplateImportResult> {
    let local_categories = local::list_categories(database_path)?;
    let mut local_templates = Vec::new();
    for kind in [TemplateKind::File, TemplateKind::Snippet] {
        let filter = TemplateFilter {
            kind,
            search: String::new(),
            favorite_only: false,
            recent_only: false,
            category_id: None,
            sort: TemplateSort::Manual,
        };
        let metadata = local::list_templates(database_path, &filter)?;
        let ids = metadata
            .iter()
            .map(|template| template.id)
            .collect::<Vec<_>>();
        local_templates.extend(local::get_templates(database_path, &ids)?);
    }

    let mut cloud_categories = cloud::list_categories(api).await?;
    let mut category_map = HashMap::<i64, i64>::new();
    let mut claimed_cloud_categories = HashSet::<i64>::new();
    let mut pending_categories = local_categories;
    let mut categories_created = 0;
    let mut categories_reused = 0;

    while !pending_categories.is_empty() {
        let previous_count = pending_categories.len();
        let mut still_pending = Vec::new();
        for local_category in pending_categories {
            let parent_id = match local_category.parent_id {
                Some(local_parent_id) => match category_map.get(&local_parent_id).copied() {
                    Some(cloud_parent_id) => Some(cloud_parent_id),
                    None => {
                        still_pending.push(local_category);
                        continue;
                    }
                },
                None => None,
            };

            let existing = cloud_categories.iter().find(|candidate| {
                !claimed_cloud_categories.contains(&candidate.id)
                    && candidate.parent_id == parent_id
                    && candidate.name == local_category.name
            });
            let cloud_id = if let Some(existing) = existing {
                categories_reused += 1;
                existing.id
            } else {
                let mut created =
                    cloud::create_category(api, &local_category.name, parent_id).await?;
                if created.sort_order != local_category.sort_order {
                    cloud::move_category(api, created.id, parent_id, local_category.sort_order)
                        .await?;
                    created.sort_order = local_category.sort_order;
                }
                let cloud_id = created.id;
                cloud_categories.push(created);
                categories_created += 1;
                cloud_id
            };
            claimed_cloud_categories.insert(cloud_id);
            category_map.insert(local_category.id, cloud_id);
        }
        if still_pending.len() == previous_count {
            return Err(AppError::Internal(
                "local template categories could not be ordered for import".to_owned(),
            ));
        }
        pending_categories = still_pending;
    }

    let mut existing_templates = Vec::new();
    for kind in [TemplateKind::File, TemplateKind::Snippet] {
        existing_templates.extend(
            cloud::list_templates(
                api,
                &TemplateFilter {
                    kind,
                    search: String::new(),
                    favorite_only: false,
                    recent_only: false,
                    category_id: None,
                    sort: TemplateSort::Manual,
                },
            )
            .await?,
        );
    }
    let mut existing_fingerprints = HashMap::<String, usize>::new();
    for template in &existing_templates {
        *existing_fingerprints
            .entry(template_fingerprint(
                template,
                template.metadata.category_id,
            ))
            .or_default() += 1;
    }

    let mut templates_created = 0;
    let mut templates_skipped = 0;
    for local_template in local_templates {
        let category_id = match local_template.metadata.category_id {
            Some(local_category_id) => Some(
                category_map
                    .get(&local_category_id)
                    .copied()
                    .ok_or_else(|| {
                        AppError::Internal(format!(
                            "local category {local_category_id} was not mapped"
                        ))
                    })?,
            ),
            None => None,
        };
        let fingerprint = template_fingerprint(&local_template, category_id);
        if let Some(count) = existing_fingerprints.get_mut(&fingerprint) {
            if *count > 0 {
                *count -= 1;
                templates_skipped += 1;
                continue;
            }
        }

        let input = TemplateInput {
            kind: local_template.metadata.kind,
            name: local_template.metadata.name,
            trigger: local_template.metadata.trigger,
            aliases: local_template.metadata.aliases,
            description: local_template.metadata.description,
            language: local_template.metadata.language,
            category_id,
            favorite: local_template.metadata.favorite,
            code: local_template.code,
        };
        let created = cloud::create_template(api, &input).await?;
        if created.metadata.sort_order != local_template.metadata.sort_order {
            cloud::move_template(
                api,
                created.metadata.id,
                category_id,
                local_template.metadata.sort_order,
            )
            .await?;
        }
        templates_created += 1;
    }

    Ok(LocalTemplateImportResult {
        categories_created,
        categories_reused,
        templates_created,
        templates_skipped,
        histories_skipped: true,
    })
}

async fn sync_cloud_templates_to_local(
    api: &ServerApi,
    database_path: &Path,
) -> AppResult<LocalTemplateImportResult> {
    let cloud_categories = cloud::list_categories(api).await?;
    let mut local_categories = local::list_categories(database_path)?;
    let mut category_map = HashMap::<i64, i64>::new();
    let mut claimed_local_categories = HashSet::<i64>::new();
    let mut pending_categories = cloud_categories;
    let mut categories_created = 0;
    let mut categories_reused = 0;

    while !pending_categories.is_empty() {
        let previous_count = pending_categories.len();
        let mut still_pending = Vec::new();
        for cloud_category in pending_categories {
            let parent_id = match cloud_category.parent_id {
                Some(cloud_parent_id) => match category_map.get(&cloud_parent_id).copied() {
                    Some(local_parent_id) => Some(local_parent_id),
                    None => {
                        still_pending.push(cloud_category);
                        continue;
                    }
                },
                None => None,
            };

            let existing = local_categories.iter().find(|candidate| {
                !claimed_local_categories.contains(&candidate.id)
                    && candidate.parent_id == parent_id
                    && candidate.name == cloud_category.name
            });
            let local_id = if let Some(existing) = existing {
                categories_reused += 1;
                existing.id
            } else {
                let mut created =
                    local::create_category(database_path, &cloud_category.name, parent_id)?;
                if created.sort_order != cloud_category.sort_order {
                    local::move_category(
                        database_path,
                        created.id,
                        parent_id,
                        cloud_category.sort_order.max(0) as usize,
                    )?;
                    created.sort_order = cloud_category.sort_order;
                }
                let local_id = created.id;
                local_categories.push(created);
                categories_created += 1;
                local_id
            };
            claimed_local_categories.insert(local_id);
            category_map.insert(cloud_category.id, local_id);
        }
        if still_pending.len() == previous_count {
            return Err(AppError::Internal(
                "cloud template categories could not be ordered for sync".to_owned(),
            ));
        }
        pending_categories = still_pending;
    }

    let mut existing_templates = Vec::new();
    for kind in [TemplateKind::File, TemplateKind::Snippet] {
        let metadata = local::list_templates(
            database_path,
            &TemplateFilter {
                kind,
                search: String::new(),
                favorite_only: false,
                recent_only: false,
                category_id: None,
                sort: TemplateSort::Manual,
            },
        )?;
        let ids = metadata.iter().map(|template| template.id).collect::<Vec<_>>();
        existing_templates.extend(local::get_templates(database_path, &ids)?);
    }
    let mut existing_fingerprints = HashMap::<String, usize>::new();
    for template in &existing_templates {
        *existing_fingerprints
            .entry(template_fingerprint(template, template.metadata.category_id))
            .or_default() += 1;
    }

    let mut cloud_templates = Vec::new();
    for kind in [TemplateKind::File, TemplateKind::Snippet] {
        cloud_templates.extend(
            cloud::list_templates(
                api,
                &TemplateFilter {
                    kind,
                    search: String::new(),
                    favorite_only: false,
                    recent_only: false,
                    category_id: None,
                    sort: TemplateSort::Manual,
                },
            )
            .await?,
        );
    }

    let mut templates_created = 0;
    let mut templates_skipped = 0;
    for cloud_template in cloud_templates {
        let category_id = match cloud_template.metadata.category_id {
            Some(cloud_category_id) => Some(
                category_map
                    .get(&cloud_category_id)
                    .copied()
                    .ok_or_else(|| {
                        AppError::Internal(format!(
                            "cloud category {cloud_category_id} was not mapped"
                        ))
                    })?,
            ),
            None => None,
        };
        let fingerprint = template_fingerprint(&cloud_template, category_id);
        if let Some(count) = existing_fingerprints.get_mut(&fingerprint) {
            if *count > 0 {
                *count -= 1;
                templates_skipped += 1;
                continue;
            }
        }

        let input = TemplateInput {
            kind: cloud_template.metadata.kind,
            name: cloud_template.metadata.name,
            trigger: cloud_template.metadata.trigger,
            aliases: cloud_template.metadata.aliases,
            description: cloud_template.metadata.description,
            language: cloud_template.metadata.language,
            category_id,
            favorite: cloud_template.metadata.favorite,
            code: cloud_template.code,
        };
        let created = local::create_template(database_path, &input)?;
        if created.metadata.sort_order != cloud_template.metadata.sort_order {
            local::move_template(
                database_path,
                created.metadata.id,
                category_id,
                cloud_template.metadata.sort_order.max(0) as usize,
            )?;
        }
        templates_created += 1;
    }

    Ok(LocalTemplateImportResult {
        categories_created,
        categories_reused,
        templates_created,
        templates_skipped,
        histories_skipped: true,
    })
}

fn template_fingerprint(template: &TemplateDetail, category_id: Option<i64>) -> String {
    serde_json::to_string(&(
        template.metadata.kind,
        &template.metadata.name,
        &template.metadata.trigger,
        &template.metadata.aliases,
        &template.metadata.description,
        &template.metadata.language,
        category_id,
        template.metadata.favorite,
        &template.code,
    ))
    .expect("serializing a template fingerprint cannot fail")
}
