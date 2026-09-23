use reqwest::Method;
use serde::Serialize;
use std::collections::HashSet;

use crate::{
    error::{AppError, AppResult},
    templates::{
        TemplateCategory, TemplateDetail, TemplateFilter, TemplateInput, TemplateMetadata,
        TemplateSort,
    },
};

use super::ServerApi;

#[derive(Serialize)]
struct TemplateQuery<'a> {
    kind: &'a str,
    search: &'a str,
    favorite_only: bool,
    recent_only: bool,
    category_id: Option<i64>,
    sort: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CategoryInput<'a> {
    name: &'a str,
    parent_id: Option<i64>,
    sort_order: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CategoryMove {
    parent_id: Option<i64>,
    sort_order: i64,
}

#[derive(Serialize)]
struct FavoriteInput {
    favorite: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TemplateMove {
    category_id: Option<i64>,
    sort_order: i64,
}

pub async fn list_categories(api: &ServerApi) -> AppResult<Vec<TemplateCategory>> {
    api.get("/template-categories", true).await
}

pub async fn create_category(
    api: &ServerApi,
    name: &str,
    parent_id: Option<i64>,
) -> AppResult<TemplateCategory> {
    api.post(
        "/template-categories",
        &CategoryInput {
            name,
            parent_id,
            sort_order: 0,
        },
        true,
    )
    .await
}

pub async fn rename_category(api: &ServerApi, id: i64, name: &str) -> AppResult<()> {
    let category = list_categories(api)
        .await?
        .into_iter()
        .find(|category| category.id == id)
        .ok_or_else(|| AppError::Server("模板分类不存在。".to_owned()))?;
    let _: TemplateCategory = api
        .put(
            &format!("/template-categories/{id}"),
            &CategoryInput {
                name,
                parent_id: category.parent_id,
                sort_order: category.sort_order,
            },
        )
        .await?;
    Ok(())
}

pub async fn delete_category(api: &ServerApi, id: i64) -> AppResult<()> {
    api.send_empty::<()>(Method::DELETE, &format!("/template-categories/{id}"), None)
        .await
}

pub async fn move_category(
    api: &ServerApi,
    id: i64,
    parent_id: Option<i64>,
    target_index: i64,
) -> AppResult<()> {
    let _: TemplateCategory = api
        .put(
            &format!("/template-categories/{id}/move"),
            &CategoryMove {
                parent_id,
                sort_order: target_index.max(0),
            },
        )
        .await?;
    Ok(())
}

pub async fn list_templates(
    api: &ServerApi,
    filter: &TemplateFilter,
) -> AppResult<Vec<TemplateDetail>> {
    // Older LightCP server deployments only matched the selected category itself.
    // The local template library, however, has always treated a parent category as
    // the complete subtree. Fetch the otherwise-filtered list and apply the subtree
    // match here so current desktop builds keep that behavior before the server is
    // upgraded.
    let selected_category_id = filter.category_id;
    let mut templates: Vec<TemplateDetail> = api
        .get_query(
            "/templates",
            &TemplateQuery {
                kind: filter.kind.as_str(),
                search: &filter.search,
                favorite_only: filter.favorite_only,
                recent_only: filter.recent_only,
                category_id: None,
                sort: sort_name(filter.sort),
            },
        )
        .await?;

    if let Some(category_id) = selected_category_id {
        let categories = list_categories(api).await?;
        let category_ids = category_subtree_ids(category_id, &categories);
        templates.retain(|template| {
            template
                .metadata
                .category_id
                .is_some_and(|id| category_ids.contains(&id))
        });
    }

    Ok(templates)
}

fn category_subtree_ids(root_id: i64, categories: &[TemplateCategory]) -> HashSet<i64> {
    let mut result = HashSet::from([root_id]);
    loop {
        let previous_len = result.len();
        for category in categories {
            if category
                .parent_id
                .is_some_and(|parent_id| result.contains(&parent_id))
            {
                result.insert(category.id);
            }
        }
        if result.len() == previous_len {
            return result;
        }
    }
}

pub async fn search_completions(
    api: &ServerApi,
    query: &str,
    limit: usize,
) -> AppResult<Vec<TemplateDetail>> {
    let filter = TemplateFilter {
        kind: crate::templates::TemplateKind::Snippet,
        search: query.to_owned(),
        favorite_only: false,
        recent_only: false,
        category_id: None,
        sort: TemplateSort::RecentlyUsed,
    };
    let mut templates = list_templates(api, &filter).await?;
    templates.truncate(limit.min(100));
    Ok(templates)
}

pub async fn get_template(api: &ServerApi, id: i64) -> AppResult<TemplateDetail> {
    api.get(&format!("/templates/{id}"), true).await
}

pub async fn get_templates(api: &ServerApi, ids: &[i64]) -> AppResult<Vec<TemplateDetail>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let all: Vec<TemplateDetail> = api.get("/templates", true).await?;
    Ok(all
        .into_iter()
        .filter(|template| ids.contains(&template.metadata.id))
        .collect())
}

pub async fn create_template(api: &ServerApi, input: &TemplateInput) -> AppResult<TemplateDetail> {
    api.post("/templates", input, true).await
}

pub async fn update_template(
    api: &ServerApi,
    id: i64,
    input: &TemplateInput,
) -> AppResult<TemplateDetail> {
    let current = get_template(api, id).await?;
    let mut body = serde_json::to_value(input)
        .map_err(|error| AppError::Internal(format!("could not serialize template: {error}")))?;
    body.as_object_mut()
        .ok_or_else(|| AppError::Internal("template payload was not an object".to_owned()))?
        .insert("sortOrder".to_owned(), current.metadata.sort_order.into());
    api.put(&format!("/templates/{id}"), &body).await
}

pub async fn delete_template(api: &ServerApi, id: i64) -> AppResult<()> {
    api.send_empty::<()>(Method::DELETE, &format!("/templates/{id}"), None)
        .await
}

pub async fn set_favorite(api: &ServerApi, id: i64, favorite: bool) -> AppResult<()> {
    api.send_empty(
        Method::PUT,
        &format!("/templates/{id}/favorite"),
        Some(&FavoriteInput { favorite }),
    )
    .await
}

pub async fn record_use(api: &ServerApi, id: i64) -> AppResult<()> {
    api.send_empty::<()>(Method::POST, &format!("/templates/{id}/use"), None)
        .await
}

pub async fn move_template(
    api: &ServerApi,
    id: i64,
    category_id: Option<i64>,
    target_index: i64,
) -> AppResult<()> {
    api.send_empty(
        Method::PUT,
        &format!("/templates/{id}/move"),
        Some(&TemplateMove {
            category_id,
            sort_order: target_index.max(0),
        }),
    )
    .await
}

pub fn metadata(detail: TemplateDetail) -> TemplateMetadata {
    detail.metadata
}

fn sort_name(sort: TemplateSort) -> &'static str {
    match sort {
        TemplateSort::Manual => "manual",
        TemplateSort::Name => "name",
        TemplateSort::RecentlyUsed => "recentlyUsed",
        TemplateSort::UsageCount => "usageCount",
        TemplateSort::Updated => "updated",
        TemplateSort::Created => "created",
    }
}

#[cfg(test)]
mod tests {
    use super::category_subtree_ids;
    use crate::templates::TemplateCategory;

    fn category(id: i64, parent_id: Option<i64>) -> TemplateCategory {
        TemplateCategory {
            id,
            name: format!("category-{id}"),
            parent_id,
            sort_order: 0,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn category_subtree_contains_all_descendants_only() {
        let categories = vec![
            category(1, None),
            category(2, Some(1)),
            category(3, Some(2)),
            category(4, None),
            category(5, Some(4)),
        ];

        let ids = category_subtree_ids(1, &categories);

        assert_eq!(ids, [1, 2, 3].into_iter().collect());
    }
}
