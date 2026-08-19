use std::{collections::HashSet, path::Path};

use rusqlite::{params, params_from_iter, types::Value, OptionalExtension, Row, Transaction};

use crate::{
    database::connect,
    error::{AppError, AppResult},
};

use super::{
    TemplateCategory, TemplateDetail, TemplateFilter, TemplateInput, TemplateKind,
    TemplateMetadata, TemplateSort, TemplateVersionDetail, TemplateVersionMetadata,
};

const VERSION_LIMIT: i64 = 20;
const METADATA_COLUMNS: &str = "id, kind, name, trigger, aliases, description, language,
    category_id, favorite, sort_order, use_count, last_used, created_at, updated_at";

pub fn list_categories(database_path: &Path) -> AppResult<Vec<TemplateCategory>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, name, parent_id, sort_order, created_at, updated_at
         FROM template_categories
         ORDER BY parent_id, sort_order, id",
    )?;
    let rows = statement.query_map([], map_category)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn create_category(
    database_path: &Path,
    name: &str,
    parent_id: Option<i64>,
) -> AppResult<TemplateCategory> {
    let name = required_name(name, "category")?;
    let connection = connect(database_path)?;
    validate_category(&connection, parent_id)?;
    let sort_order: i64 = connection.query_row(
        "SELECT COALESCE(MAX(sort_order) + 1, 0)
         FROM template_categories WHERE parent_id IS ?1",
        params![parent_id],
        |row| row.get(0),
    )?;
    connection.execute(
        "INSERT INTO template_categories (name, parent_id, sort_order)
         VALUES (?1, ?2, ?3)",
        params![name, parent_id, sort_order],
    )?;
    get_category(&connection, connection.last_insert_rowid())
}

pub fn rename_category(database_path: &Path, id: i64, name: &str) -> AppResult<()> {
    let name = required_name(name, "category")?;
    let connection = connect(database_path)?;
    let changed = connection.execute(
        "UPDATE template_categories
         SET name = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, name],
    )?;
    ensure_changed(changed, "template category", id)
}

pub fn delete_category(database_path: &Path, id: i64) -> AppResult<()> {
    let connection = connect(database_path)?;
    let changed = connection.execute("DELETE FROM template_categories WHERE id = ?1", [id])?;
    ensure_changed(changed, "template category", id)
}

pub fn move_category(
    database_path: &Path,
    id: i64,
    parent_id: Option<i64>,
    target_index: usize,
) -> AppResult<()> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    validate_category(&transaction, Some(id))?;
    validate_category(&transaction, parent_id)?;
    if parent_id == Some(id) || category_is_descendant(&transaction, id, parent_id)? {
        return Err(template_error("a category cannot be moved into itself"));
    }

    let previous_parent: Option<i64> = transaction.query_row(
        "SELECT parent_id FROM template_categories WHERE id = ?1",
        [id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE template_categories
         SET parent_id = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, parent_id],
    )?;
    normalize_category_order(&transaction, previous_parent, None, None)?;
    normalize_category_order(&transaction, parent_id, Some(id), Some(target_index))?;
    transaction.commit()?;
    Ok(())
}

pub fn list_templates(
    database_path: &Path,
    filter: &TemplateFilter,
) -> AppResult<Vec<TemplateMetadata>> {
    let connection = connect(database_path)?;
    let mut sql = format!("SELECT {METADATA_COLUMNS} FROM templates WHERE kind = ?1");
    let mut values = vec![Value::Text(filter.kind.as_str().to_owned())];

    let search = filter.search.trim();
    if !search.is_empty() {
        values.push(Value::Text(format!("%{search}%")));
        let index = values.len();
        sql.push_str(&format!(
            " AND (name LIKE ?{index} OR trigger LIKE ?{index} OR aliases LIKE ?{index} OR description LIKE ?{index})"
        ));
    }
    if filter.favorite_only {
        sql.push_str(" AND favorite = 1");
    }
    if filter.recent_only {
        sql.push_str(" AND last_used IS NOT NULL");
    }
    if let Some(category_id) = filter.category_id {
        values.push(Value::Integer(category_id));
        sql.push_str(&format!(" AND category_id = ?{}", values.len()));
    }
    sql.push_str(match filter.sort {
        TemplateSort::Manual => " ORDER BY sort_order, id",
        TemplateSort::Name => " ORDER BY name COLLATE NOCASE, id",
        TemplateSort::RecentlyUsed => " ORDER BY last_used IS NULL, last_used DESC, id",
        TemplateSort::UsageCount => " ORDER BY use_count DESC, name COLLATE NOCASE, id",
        TemplateSort::Updated => " ORDER BY updated_at DESC, id",
        TemplateSort::Created => " ORDER BY created_at DESC, id",
    });

    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values), map_metadata)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn get_template(database_path: &Path, id: i64) -> AppResult<TemplateDetail> {
    let connection = connect(database_path)?;
    get_template_from_connection(&connection, id)
}

pub fn create_template(database_path: &Path, input: &TemplateInput) -> AppResult<TemplateDetail> {
    let input = SanitizedInput::new(input)?;
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    validate_category(&transaction, input.category_id)?;
    let sort_order = next_template_sort_order(&transaction, input.kind, input.category_id)?;
    transaction.execute(
        "INSERT INTO templates (
            kind, name, trigger, aliases, description, language,
            category_id, favorite, sort_order, code
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            input.kind.as_str(),
            input.name,
            input.trigger,
            input.aliases,
            input.description,
            input.language,
            input.category_id,
            input.favorite,
            sort_order,
            input.code,
        ],
    )?;
    let id = transaction.last_insert_rowid();
    insert_snapshot(&transaction, id)?;
    transaction.commit()?;
    get_template_from_connection(&connection, id)
}

pub fn update_template(
    database_path: &Path,
    id: i64,
    input: &TemplateInput,
) -> AppResult<TemplateDetail> {
    let input = SanitizedInput::new(input)?;
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    validate_category(&transaction, input.category_id)?;

    let current: Option<(TemplateKind, Option<i64>, i64)> = transaction
        .query_row(
            "SELECT kind, category_id, sort_order FROM templates WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    kind_from_text(&row.get::<_, String>(0)?),
                    row.get(1)?,
                    row.get(2)?,
                ))
            },
        )
        .optional()?;
    let Some((current_kind, current_category, current_sort)) = current else {
        return Err(template_error(format!("template {id} does not exist")));
    };
    let sort_order = if current_kind != input.kind || current_category != input.category_id {
        next_template_sort_order(&transaction, input.kind, input.category_id)?
    } else {
        current_sort
    };

    transaction.execute(
        "UPDATE templates SET
            kind = ?2, name = ?3, trigger = ?4, aliases = ?5,
            description = ?6, language = ?7, category_id = ?8,
            favorite = ?9, sort_order = ?10, code = ?11,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![
            id,
            input.kind.as_str(),
            input.name,
            input.trigger,
            input.aliases,
            input.description,
            input.language,
            input.category_id,
            input.favorite,
            sort_order,
            input.code,
        ],
    )?;
    insert_snapshot(&transaction, id)?;
    prune_versions(&transaction, id)?;
    transaction.commit()?;
    get_template_from_connection(&connection, id)
}

pub fn delete_template(database_path: &Path, id: i64) -> AppResult<()> {
    let connection = connect(database_path)?;
    let changed = connection.execute("DELETE FROM templates WHERE id = ?1", [id])?;
    ensure_changed(changed, "template", id)
}

pub fn set_favorite(database_path: &Path, id: i64, favorite: bool) -> AppResult<()> {
    let connection = connect(database_path)?;
    let changed = connection.execute(
        "UPDATE templates SET favorite = ?2,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, favorite],
    )?;
    ensure_changed(changed, "template", id)
}

pub fn record_use(database_path: &Path, id: i64) -> AppResult<()> {
    let connection = connect(database_path)?;
    let changed = connection.execute(
        "UPDATE templates SET
            use_count = use_count + 1,
            last_used = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        [id],
    )?;
    ensure_changed(changed, "template", id)
}

pub fn move_template(
    database_path: &Path,
    id: i64,
    category_id: Option<i64>,
    target_index: usize,
) -> AppResult<()> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    validate_category(&transaction, category_id)?;
    let (kind, previous_category): (TemplateKind, Option<i64>) = transaction
        .query_row(
            "SELECT kind, category_id FROM templates WHERE id = ?1",
            [id],
            |row| Ok((kind_from_text(&row.get::<_, String>(0)?), row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| template_error(format!("template {id} does not exist")))?;
    transaction.execute(
        "UPDATE templates SET category_id = ?2,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, category_id],
    )?;
    normalize_template_order(&transaction, kind, previous_category, None, None)?;
    normalize_template_order(
        &transaction,
        kind,
        category_id,
        Some(id),
        Some(target_index),
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn list_versions(
    database_path: &Path,
    template_id: i64,
) -> AppResult<Vec<TemplateVersionMetadata>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, template_id, version_number, name, created_at
         FROM template_versions WHERE template_id = ?1
         ORDER BY version_number DESC",
    )?;
    let rows = statement.query_map([template_id], |row| {
        Ok(TemplateVersionMetadata {
            id: row.get(0)?,
            template_id: row.get(1)?,
            version_number: row.get(2)?,
            name: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn get_version(database_path: &Path, version_id: i64) -> AppResult<TemplateVersionDetail> {
    let connection = connect(database_path)?;
    connection
        .query_row(
            "SELECT id, template_id, version_number, kind, name, trigger, aliases,
                description, language, category_id, favorite, code, created_at
             FROM template_versions WHERE id = ?1",
            [version_id],
            map_version,
        )
        .optional()?
        .ok_or_else(|| template_error(format!("template version {version_id} does not exist")))
}

pub fn restore_version(
    database_path: &Path,
    template_id: i64,
    version_id: i64,
) -> AppResult<TemplateDetail> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let version = transaction
        .query_row(
            "SELECT id, template_id, version_number, kind, name, trigger, aliases,
                description, language, category_id, favorite, code, created_at
             FROM template_versions WHERE id = ?1 AND template_id = ?2",
            params![version_id, template_id],
            map_version,
        )
        .optional()?
        .ok_or_else(|| template_error("the requested version does not belong to this template"))?;
    // Historical categories may have been deleted since the snapshot was made.
    // Restoring the remaining fields is still useful, so fall back to uncategorized.
    let restored_category_id = match version.category_id {
        Some(id) if category_exists(&transaction, id)? => Some(id),
        _ => None,
    };
    transaction.execute(
        "UPDATE templates SET
            kind = ?2, name = ?3, trigger = ?4, aliases = ?5,
            description = ?6, language = ?7, category_id = ?8,
            favorite = ?9, code = ?10,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![
            template_id,
            version.kind.as_str(),
            version.name,
            version.trigger,
            aliases_json(&version.aliases),
            version.description,
            version.language,
            restored_category_id,
            version.favorite,
            version.code,
        ],
    )?;
    insert_snapshot(&transaction, template_id)?;
    prune_versions(&transaction, template_id)?;
    transaction.commit()?;
    get_template_from_connection(&connection, template_id)
}

fn get_category(connection: &rusqlite::Connection, id: i64) -> AppResult<TemplateCategory> {
    connection
        .query_row(
            "SELECT id, name, parent_id, sort_order, created_at, updated_at
             FROM template_categories WHERE id = ?1",
            [id],
            map_category,
        )
        .optional()?
        .ok_or_else(|| template_error(format!("template category {id} does not exist")))
}

fn get_template_from_connection(
    connection: &rusqlite::Connection,
    id: i64,
) -> AppResult<TemplateDetail> {
    let sql = format!("SELECT {METADATA_COLUMNS}, code FROM templates WHERE id = ?1");
    connection
        .query_row(&sql, [id], |row| {
            Ok(TemplateDetail {
                metadata: map_metadata(row)?,
                code: row.get(14)?,
            })
        })
        .optional()?
        .ok_or_else(|| template_error(format!("template {id} does not exist")))
}

fn map_category(row: &Row<'_>) -> rusqlite::Result<TemplateCategory> {
    Ok(TemplateCategory {
        id: row.get(0)?,
        name: row.get(1)?,
        parent_id: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn map_metadata(row: &Row<'_>) -> rusqlite::Result<TemplateMetadata> {
    let aliases = row.get::<_, String>(4)?;
    Ok(TemplateMetadata {
        id: row.get(0)?,
        kind: kind_from_text(&row.get::<_, String>(1)?),
        name: row.get(2)?,
        trigger: row.get(3)?,
        aliases: parse_aliases(&aliases),
        description: row.get(5)?,
        language: row.get(6)?,
        category_id: row.get(7)?,
        favorite: row.get(8)?,
        sort_order: row.get(9)?,
        use_count: row.get(10)?,
        last_used: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn map_version(row: &Row<'_>) -> rusqlite::Result<TemplateVersionDetail> {
    let aliases = row.get::<_, String>(6)?;
    Ok(TemplateVersionDetail {
        id: row.get(0)?,
        template_id: row.get(1)?,
        version_number: row.get(2)?,
        kind: kind_from_text(&row.get::<_, String>(3)?),
        name: row.get(4)?,
        trigger: row.get(5)?,
        aliases: parse_aliases(&aliases),
        description: row.get(7)?,
        language: row.get(8)?,
        category_id: row.get(9)?,
        favorite: row.get(10)?,
        code: row.get(11)?,
        created_at: row.get(12)?,
    })
}

fn insert_snapshot(transaction: &Transaction<'_>, template_id: i64) -> AppResult<()> {
    let version_number: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(version_number) + 1, 1)
         FROM template_versions WHERE template_id = ?1",
        [template_id],
        |row| row.get(0),
    )?;
    let changed = transaction.execute(
        "INSERT INTO template_versions (
            template_id, version_number, kind, name, trigger, aliases,
            description, language, category_id, favorite, code
         )
         SELECT id, ?2, kind, name, trigger, aliases,
            description, language, category_id, favorite, code
         FROM templates WHERE id = ?1",
        params![template_id, version_number],
    )?;
    ensure_changed(changed, "template", template_id)
}

fn prune_versions(transaction: &Transaction<'_>, template_id: i64) -> AppResult<()> {
    transaction.execute(
        "DELETE FROM template_versions
         WHERE template_id = ?1 AND id NOT IN (
            SELECT id FROM template_versions
            WHERE template_id = ?1
            ORDER BY version_number DESC LIMIT ?2
         )",
        params![template_id, VERSION_LIMIT],
    )?;
    Ok(())
}

fn next_template_sort_order(
    transaction: &Transaction<'_>,
    kind: TemplateKind,
    category_id: Option<i64>,
) -> AppResult<i64> {
    transaction
        .query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0)
             FROM templates WHERE kind = ?1 AND category_id IS ?2",
            params![kind.as_str(), category_id],
            |row| row.get(0),
        )
        .map_err(AppError::from)
}

fn normalize_category_order(
    transaction: &Transaction<'_>,
    parent_id: Option<i64>,
    inserted_id: Option<i64>,
    target_index: Option<usize>,
) -> AppResult<()> {
    let mut statement = transaction.prepare(
        "SELECT id FROM template_categories
         WHERE parent_id IS ?1 AND id IS NOT ?2
         ORDER BY sort_order, id",
    )?;
    let mut ids = statement
        .query_map(params![parent_id, inserted_id], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    if let Some(id) = inserted_id {
        ids.insert(target_index.unwrap_or(ids.len()).min(ids.len()), id);
    }
    for (index, id) in ids.into_iter().enumerate() {
        transaction.execute(
            "UPDATE template_categories SET sort_order = ?2 WHERE id = ?1",
            params![id, index as i64],
        )?;
    }
    Ok(())
}

fn normalize_template_order(
    transaction: &Transaction<'_>,
    kind: TemplateKind,
    category_id: Option<i64>,
    inserted_id: Option<i64>,
    target_index: Option<usize>,
) -> AppResult<()> {
    let mut statement = transaction.prepare(
        "SELECT id FROM templates
         WHERE kind = ?1 AND category_id IS ?2 AND id IS NOT ?3
         ORDER BY sort_order, id",
    )?;
    let mut ids = statement
        .query_map(params![kind.as_str(), category_id, inserted_id], |row| {
            row.get::<_, i64>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    if let Some(id) = inserted_id {
        ids.insert(target_index.unwrap_or(ids.len()).min(ids.len()), id);
    }
    for (index, id) in ids.into_iter().enumerate() {
        transaction.execute(
            "UPDATE templates SET sort_order = ?2 WHERE id = ?1",
            params![id, index as i64],
        )?;
    }
    Ok(())
}

fn category_is_descendant(
    transaction: &Transaction<'_>,
    id: i64,
    possible_descendant: Option<i64>,
) -> AppResult<bool> {
    let Some(possible_descendant) = possible_descendant else {
        return Ok(false);
    };
    transaction
        .query_row(
            "WITH RECURSIVE descendants(id) AS (
                SELECT id FROM template_categories WHERE parent_id = ?1
                UNION ALL
                SELECT child.id FROM template_categories child
                JOIN descendants parent ON child.parent_id = parent.id
             )
             SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
            params![id, possible_descendant],
            |row| row.get(0),
        )
        .map_err(AppError::from)
}

fn validate_category(connection: &rusqlite::Connection, id: Option<i64>) -> AppResult<()> {
    let Some(id) = id else {
        return Ok(());
    };
    if category_exists(connection, id)? {
        Ok(())
    } else {
        Err(template_error(format!(
            "template category {id} does not exist"
        )))
    }
}

fn category_exists(connection: &rusqlite::Connection, id: i64) -> AppResult<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM template_categories WHERE id = ?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(AppError::from)
}

fn required_name<'a>(name: &'a str, kind: &str) -> AppResult<&'a str> {
    let name = name.trim();
    if name.is_empty() {
        Err(template_error(format!("{kind} name cannot be empty")))
    } else {
        Ok(name)
    }
}

fn ensure_changed(changed: usize, kind: &str, id: i64) -> AppResult<()> {
    if changed == 0 {
        Err(template_error(format!("{kind} {id} does not exist")))
    } else {
        Ok(())
    }
}

fn kind_from_text(kind: &str) -> TemplateKind {
    if kind == "snippet" {
        TemplateKind::Snippet
    } else {
        TemplateKind::File
    }
}

fn parse_aliases(aliases: &str) -> Vec<String> {
    serde_json::from_str(aliases).unwrap_or_default()
}

fn aliases_json(aliases: &[String]) -> String {
    serde_json::to_string(aliases).unwrap_or_else(|_| "[]".to_owned())
}

fn template_error(message: impl Into<String>) -> AppError {
    AppError::Configuration(message.into())
}

struct SanitizedInput {
    kind: TemplateKind,
    name: String,
    trigger: String,
    aliases: String,
    description: String,
    language: String,
    category_id: Option<i64>,
    favorite: bool,
    code: String,
}

impl SanitizedInput {
    fn new(input: &TemplateInput) -> AppResult<Self> {
        let name = required_name(&input.name, "template")?.to_owned();
        let language = required_name(&input.language, "template language")?.to_owned();
        let mut seen = HashSet::new();
        let aliases = input
            .aliases
            .iter()
            .map(|alias| alias.trim())
            .filter(|alias| !alias.is_empty())
            .filter(|alias| seen.insert(alias.to_lowercase()))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        Ok(Self {
            kind: input.kind,
            name,
            trigger: input.trigger.trim().to_owned(),
            aliases: aliases_json(&aliases),
            description: input.description.trim().to_owned(),
            language,
            category_id: input.category_id,
            favorite: input.favorite,
            code: input.code.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::UNIX_EPOCH};

    use crate::database;

    use super::*;

    #[test]
    fn categories_move_sort_and_reject_cycles() {
        let database_path = temporary_database("category-move");
        let root_a = create_category(&database_path, "图论", None).expect("root category");
        let root_b = create_category(&database_path, "数据结构", None).expect("root category");
        let child = create_category(&database_path, "网络流", Some(root_a.id)).expect("child");

        move_category(&database_path, root_b.id, None, 0).expect("root reorder");
        move_category(&database_path, child.id, Some(root_b.id), 0).expect("child move");
        assert!(move_category(&database_path, root_b.id, Some(child.id), 0).is_err());

        let categories = list_categories(&database_path).expect("categories list");
        assert_eq!(
            categories
                .iter()
                .find(|item| item.id == root_b.id)
                .unwrap()
                .sort_order,
            0
        );
        assert_eq!(
            categories
                .iter()
                .find(|item| item.id == child.id)
                .unwrap()
                .parent_id,
            Some(root_b.id)
        );
        cleanup_database(database_path);
    }

    #[test]
    fn chinese_alias_search_and_manual_template_sort_work() {
        let database_path = temporary_database("search-sort");
        let category = create_category(&database_path, "图论", None).expect("category");
        let first = create_template(
            &database_path,
            &snippet_input(
                "Dinic",
                &["最大流", "网络流"],
                Some(category.id),
                "struct Dinic {};",
            ),
        )
        .expect("first template");
        let second = create_template(
            &database_path,
            &snippet_input("MCMF", &["费用流"], Some(category.id), "struct MCMF {};"),
        )
        .expect("second template");

        let mut filter = default_filter();
        filter.search = "最大流".to_owned();
        let search = list_templates(&database_path, &filter).expect("search");
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].id, first.metadata.id);

        move_template(&database_path, second.metadata.id, Some(category.id), 0)
            .expect("manual reorder");
        filter.search.clear();
        filter.category_id = Some(category.id);
        let sorted = list_templates(&database_path, &filter).expect("manual list");
        assert_eq!(sorted[0].id, second.metadata.id);
        cleanup_database(database_path);
    }

    #[test]
    fn versions_are_capped_and_can_be_restored() {
        let database_path = temporary_database("version-restore");
        let category = create_category(&database_path, "Loops", None).expect("category");
        let mut detail = create_template(
            &database_path,
            &snippet_input("Loop", &["循环"], Some(category.id), "version 0"),
        )
        .expect("template");
        for version in 1..=24 {
            let mut input = snippet_input(
                "Loop",
                &["循环"],
                Some(category.id),
                &format!("version {version}"),
            );
            input.description = format!("saved {version}");
            detail = update_template(&database_path, detail.metadata.id, &input).expect("update");
        }

        let versions = list_versions(&database_path, detail.metadata.id).expect("versions");
        assert_eq!(versions.len(), VERSION_LIMIT as usize);
        let oldest_kept = versions.last().expect("oldest retained").id;
        let old_code = get_version(&database_path, oldest_kept)
            .expect("version detail")
            .code;
        delete_category(&database_path, category.id).expect("delete historical category");
        let restored =
            restore_version(&database_path, detail.metadata.id, oldest_kept).expect("restore");
        assert_eq!(restored.code, old_code);
        assert_eq!(restored.metadata.category_id, None);
        assert_eq!(
            list_versions(&database_path, detail.metadata.id)
                .unwrap()
                .len(),
            20
        );
        cleanup_database(database_path);
    }

    fn snippet_input(
        name: &str,
        aliases: &[&str],
        category_id: Option<i64>,
        code: &str,
    ) -> TemplateInput {
        TemplateInput {
            kind: TemplateKind::Snippet,
            name: name.to_owned(),
            trigger: name.to_lowercase(),
            aliases: aliases.iter().map(|alias| (*alias).to_owned()).collect(),
            description: String::new(),
            language: "cpp".to_owned(),
            category_id,
            favorite: false,
            code: code.to_owned(),
        }
    }

    fn default_filter() -> TemplateFilter {
        TemplateFilter {
            kind: TemplateKind::Snippet,
            search: String::new(),
            favorite_only: false,
            recent_only: false,
            category_id: None,
            sort: TemplateSort::Manual,
        }
    }

    fn temporary_database(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "lightcp-template-{label}-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        database::initialize(&path).expect("database initialization");
        path
    }

    fn cleanup_database(path: PathBuf) {
        let _ = fs::remove_file(path.with_extension("db-shm"));
        let _ = fs::remove_file(path.with_extension("db-wal"));
        fs::remove_file(path).expect("temporary database cleanup");
    }
}
