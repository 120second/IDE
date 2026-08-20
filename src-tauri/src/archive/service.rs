use std::{collections::HashSet, path::Path};

use rusqlite::{
    params, params_from_iter, types::Value, Connection, OptionalExtension, Row, Transaction,
};

use crate::{
    database::connect,
    error::{AppError, AppResult},
    filesystem::{EntryKind, FileEntry},
    paths::is_within,
};

use super::{
    ArchiveBulkInput, ArchiveFacets, ArchiveFile, ArchiveInput, ArchiveQuery, ArchiveStatus,
    DifficultyCount, NamedCount, SmartCollection, SmartCollectionInput,
};

const FILE_LIMIT: usize = 500;
const TAG_LIMIT: usize = 50;
const TAG_SEPARATOR: char = '\u{1f}';

pub fn register_entries(database_path: &Path, root: &Path, entries: &[FileEntry]) -> AppResult<()> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    for entry in entries {
        if matches!(entry.kind, EntryKind::File) {
            register_path_in_transaction(&transaction, root, &entry.path)?;
        }
    }
    transaction.commit()?;
    Ok(())
}

pub fn register_path(database_path: &Path, root: &Path, path: &str) -> AppResult<()> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    register_path_in_transaction(&transaction, root, path)?;
    transaction.commit()?;
    Ok(())
}

pub fn register_paths(database_path: &Path, root: &Path, paths: &[String]) -> AppResult<()> {
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    for path in paths {
        register_path_in_transaction(&transaction, root, path)?;
    }
    transaction.commit()?;
    Ok(())
}

pub fn record_opened(database_path: &Path, root: &Path, path: &str) -> AppResult<()> {
    if !is_cpp_path(path) {
        return Ok(());
    }
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    register_path_in_transaction(&transaction, root, path)?;
    transaction.execute(
        "UPDATE workspace_files
         SET last_opened = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), available = 1
         WHERE path = ?1 COLLATE NOCASE",
        [normalized_path(path)],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn archive_file(
    database_path: &Path,
    root: &Path,
    input: &ArchiveInput,
) -> AppResult<ArchiveFile> {
    let path = checked_cpp_path(root, &input.path)?;
    let title = required_text(&input.title, "title", 256)?;
    let platform = normalize_platform(&input.platform);
    let problem_id = limited_text(&input.problem_id, 128);
    let rating = validate_rating(input.rating)?;
    let note = limited_text(&input.note, 8_192);
    let tags = sanitize_tags(&input.tags)?;

    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    register_path_in_transaction(&transaction, root, &path)?;
    let file_id: i64 = transaction.query_row(
        "SELECT id FROM workspace_files WHERE path = ?1 COLLATE NOCASE",
        [&path],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE workspace_files SET
            title = ?2, platform = ?3, problem_id = ?4, rating = ?5,
            status = ?6, note = ?7, favorite = ?8, archived = 1, available = 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![
            file_id,
            title,
            platform,
            problem_id,
            rating,
            input.status.as_str(),
            note,
            input.favorite,
        ],
    )?;
    transaction.execute("DELETE FROM file_tags WHERE file_id = ?1", [file_id])?;
    attach_tags(&transaction, file_id, &tags)?;
    transaction.commit()?;
    get_file_by_id(&connection, file_id)
}

pub fn get_file_by_path(
    database_path: &Path,
    root: &Path,
    path: &str,
) -> AppResult<Option<ArchiveFile>> {
    let connection = connect(database_path)?;
    let root = path_text(root);
    let path = normalized_path(path);
    let mut statement = connection.prepare(&format!(
        "SELECT {}, {} FROM workspace_files wf
         LEFT JOIN file_tags ft ON ft.file_id = wf.id
         LEFT JOIN tags t ON t.id = ft.tag_id
         WHERE wf.workspace_root = ?1 COLLATE NOCASE AND wf.path = ?2 COLLATE NOCASE
         GROUP BY wf.id",
        file_columns(),
        tags_column()
    ))?;
    statement
        .query_row(params![root, path], map_archive_file)
        .optional()
        .map_err(AppError::from)
}

pub fn list_files(
    database_path: &Path,
    root: &Path,
    query: &ArchiveQuery,
) -> AppResult<Vec<ArchiveFile>> {
    let connection = connect(database_path)?;
    list_files_with_connection(&connection, root, query)
}

pub fn set_favorite(database_path: &Path, root: &Path, id: i64, favorite: bool) -> AppResult<()> {
    let connection = connect(database_path)?;
    let changed = connection.execute(
        "UPDATE workspace_files
         SET favorite = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1 AND workspace_root = ?2 COLLATE NOCASE AND available = 1",
        params![id, path_text(root), favorite],
    )?;
    ensure_changed(changed, "archive file", id)
}

pub fn bulk_update(database_path: &Path, root: &Path, input: &ArchiveBulkInput) -> AppResult<()> {
    let ids = input
        .file_ids
        .iter()
        .copied()
        .collect::<HashSet<_>>()
        .into_iter()
        .take(FILE_LIMIT)
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Err(archive_error("at least one file must be selected"));
    }
    let platform = input.platform.as_deref().map(normalize_platform);
    let rating = validate_rating(input.rating)?;
    let tags = sanitize_tags(&input.add_tags)?;
    let root = path_text(root);

    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    for id in ids {
        let exists = transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM workspace_files
                WHERE id = ?1 AND workspace_root = ?2 COLLATE NOCASE AND available = 1
             )",
            params![id, root],
            |row| row.get::<_, bool>(0),
        )?;
        if !exists {
            continue;
        }
        transaction.execute(
            "UPDATE workspace_files
             SET archived = 1,
                 platform = COALESCE(?2, platform),
                 rating = COALESCE(?3, rating),
                 status = COALESCE(?4, status),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![
                id,
                platform,
                rating,
                input.status.map(ArchiveStatus::as_str),
            ],
        )?;
        attach_tags(&transaction, id, &tags)?;
    }
    transaction.commit()?;
    Ok(())
}

pub fn list_tags(database_path: &Path, search: &str) -> AppResult<Vec<String>> {
    let connection = connect(database_path)?;
    let pattern = format!("%{}%", search.trim());
    let mut statement = connection.prepare(
        "SELECT name FROM tags
         WHERE ?1 = '%%' OR name LIKE ?1
         ORDER BY name COLLATE NOCASE
         LIMIT 100",
    )?;
    let rows = statement.query_map([pattern], |row| row.get(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn list_facets(database_path: &Path, root: &Path) -> AppResult<ArchiveFacets> {
    let connection = connect(database_path)?;
    let root = path_text(root);
    let count = |condition: &str| -> AppResult<i64> {
        connection
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM workspace_files
                     WHERE workspace_root = ?1 COLLATE NOCASE AND available = 1 AND {condition}"
                ),
                [&root],
                |row| row.get(0),
            )
            .map_err(AppError::from)
    };

    let platforms = grouped_counts(
        &connection,
        "SELECT platform, COUNT(*) FROM workspace_files
         WHERE workspace_root = ?1 COLLATE NOCASE AND available = 1 AND archived = 1
         GROUP BY platform ORDER BY COUNT(*) DESC, platform COLLATE NOCASE",
        &root,
    )?;
    let tags = grouped_counts(
        &connection,
        "SELECT t.name, COUNT(*)
         FROM tags t
         JOIN file_tags ft ON ft.tag_id = t.id
         JOIN workspace_files wf ON wf.id = ft.file_id
         WHERE wf.workspace_root = ?1 COLLATE NOCASE AND wf.available = 1 AND wf.archived = 1
         GROUP BY t.id ORDER BY COUNT(*) DESC, t.name COLLATE NOCASE LIMIT 100",
        &root,
    )?;

    let difficulty_specs = [
        ("≤1199", None, Some(1199)),
        ("1200–1599", Some(1200), Some(1599)),
        ("1600–1899", Some(1600), Some(1899)),
        ("1900–2099", Some(1900), Some(2099)),
        ("2100–2399", Some(2100), Some(2399)),
        ("2400+", Some(2400), None),
    ];
    let mut difficulties = Vec::with_capacity(difficulty_specs.len());
    for (label, minimum, maximum) in difficulty_specs {
        let value = connection.query_row(
            "SELECT COUNT(*) FROM workspace_files
             WHERE workspace_root = ?1 COLLATE NOCASE AND available = 1 AND archived = 1
               AND rating IS NOT NULL
               AND (?2 IS NULL OR rating >= ?2)
               AND (?3 IS NULL OR rating <= ?3)",
            params![root, minimum, maximum],
            |row| row.get(0),
        )?;
        difficulties.push(DifficultyCount {
            label: label.to_owned(),
            min_rating: minimum,
            max_rating: maximum,
            count: value,
        });
    }

    Ok(ArchiveFacets {
        inbox_count: count("archived = 0")?,
        favorite_count: count("archived = 1 AND favorite = 1")?,
        recent_count: count("archived = 1 AND last_opened IS NOT NULL")?,
        completed_count: count("archived = 1 AND status = 'completed'")?,
        review_count: count("archived = 1 AND status = 'review'")?,
        platforms,
        difficulties,
        tags,
    })
}

pub fn create_collection(
    database_path: &Path,
    root: &Path,
    input: &SmartCollectionInput,
) -> AppResult<SmartCollection> {
    let input = SanitizedCollection::new(input)?;
    let connection = connect(database_path)?;
    connection.execute(
        "INSERT INTO collections (
            workspace_root, name, platform, min_rating, max_rating, status, tags
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            path_text(root),
            input.name,
            input.platform,
            input.min_rating,
            input.max_rating,
            input.status.map(ArchiveStatus::as_str),
            serde_json::to_string(&input.tags).map_err(|error| archive_error(error.to_string()))?,
        ],
    )?;
    let id = connection.last_insert_rowid();
    get_collection(&connection, root, id)
}

pub fn update_collection(
    database_path: &Path,
    root: &Path,
    id: i64,
    input: &SmartCollectionInput,
) -> AppResult<SmartCollection> {
    let input = SanitizedCollection::new(input)?;
    let connection = connect(database_path)?;
    let changed = connection.execute(
        "UPDATE collections SET
            name = ?3, platform = ?4, min_rating = ?5, max_rating = ?6,
            status = ?7, tags = ?8,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1 AND workspace_root = ?2 COLLATE NOCASE",
        params![
            id,
            path_text(root),
            input.name,
            input.platform,
            input.min_rating,
            input.max_rating,
            input.status.map(ArchiveStatus::as_str),
            serde_json::to_string(&input.tags).map_err(|error| archive_error(error.to_string()))?,
        ],
    )?;
    ensure_changed(changed, "smart collection", id)?;
    get_collection(&connection, root, id)
}

pub fn delete_collection(database_path: &Path, root: &Path, id: i64) -> AppResult<()> {
    let connection = connect(database_path)?;
    let changed = connection.execute(
        "DELETE FROM collections WHERE id = ?1 AND workspace_root = ?2 COLLATE NOCASE",
        params![id, path_text(root)],
    )?;
    ensure_changed(changed, "smart collection", id)
}

pub fn list_collections(database_path: &Path, root: &Path) -> AppResult<Vec<SmartCollection>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, name, platform, min_rating, max_rating, status, tags, created_at, updated_at
         FROM collections WHERE workspace_root = ?1 COLLATE NOCASE
         ORDER BY name COLLATE NOCASE, id",
    )?;
    let rows = statement.query_map([path_text(root)], map_collection_record)?;
    let records = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    records
        .into_iter()
        .map(|record| collection_from_record(&connection, root, record))
        .collect()
}

pub fn sync_renamed_path(
    database_path: &Path,
    root: &Path,
    previous_path: &str,
    next_path: &str,
) -> AppResult<()> {
    let previous = normalized_path(previous_path);
    let next = normalized_path(next_path);
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let rows = {
        let mut statement = transaction.prepare(
            "SELECT id, path, archived FROM workspace_files
             WHERE workspace_root = ?1 COLLATE NOCASE",
        )?;
        let rows = statement.query_map([path_text(root)], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let mut changed = false;
    for (id, path, archived) in rows {
        if !same_or_child_path(&path, &previous) {
            continue;
        }
        let suffix = &path[previous.len()..];
        let target = format!("{next}{suffix}");
        transaction.execute(
            "DELETE FROM workspace_files
             WHERE path = ?1 COLLATE NOCASE AND id <> ?2 AND available = 0",
            params![target, id],
        )?;
        let title = file_title(&target);
        transaction.execute(
            "UPDATE workspace_files SET
                path = ?2,
                title = CASE WHEN ?3 = 0 THEN ?4 ELSE title END,
                available = 1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![id, target, archived, title],
        )?;
        changed = true;
    }
    if !changed {
        register_path_in_transaction(&transaction, root, &next)?;
    }
    transaction.commit()?;
    Ok(())
}

pub fn sync_deleted_path(database_path: &Path, root: &Path, deleted_path: &str) -> AppResult<()> {
    sync_deleted_paths(database_path, root, &[deleted_path.to_owned()])
}

pub fn sync_deleted_paths(
    database_path: &Path,
    root: &Path,
    deleted_paths: &[String],
) -> AppResult<()> {
    if deleted_paths.is_empty() {
        return Ok(());
    }
    let deleted = deleted_paths
        .iter()
        .map(|path| normalized_path(path).to_lowercase())
        .collect::<HashSet<_>>();
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let rows = {
        let mut statement = transaction.prepare(
            "SELECT id, path FROM workspace_files
             WHERE workspace_root = ?1 COLLATE NOCASE AND available = 1",
        )?;
        let rows = statement.query_map([path_text(root)], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (id, path) in rows {
        let mut candidate = path.to_lowercase();
        let mut removed = deleted.contains(&candidate);
        while !removed {
            let Some(separator) = candidate.rfind('\\') else {
                break;
            };
            candidate.truncate(separator);
            removed = deleted.contains(&candidate);
        }
        if removed {
            transaction.execute(
                "UPDATE workspace_files SET available = 0 WHERE id = ?1",
                [id],
            )?;
        }
    }
    transaction.commit()?;
    Ok(())
}

fn list_files_with_connection(
    connection: &Connection,
    root: &Path,
    query: &ArchiveQuery,
) -> AppResult<Vec<ArchiveFile>> {
    let resolved = resolve_query(connection, root, query)?;
    let (filter, values) = build_filter(root, &resolved);
    let ordering = if resolved.recent_only {
        "wf.last_opened DESC, wf.updated_at DESC, wf.id DESC"
    } else if resolved.inbox_only {
        "wf.created_at DESC, wf.id DESC"
    } else {
        "wf.updated_at DESC, wf.id DESC"
    };
    let sql = format!(
        "SELECT {}, {} FROM workspace_files wf
         LEFT JOIN file_tags ft ON ft.file_id = wf.id
         LEFT JOIN tags t ON t.id = ft.tag_id
         {filter}
         GROUP BY wf.id
         ORDER BY {ordering}
         LIMIT {FILE_LIMIT}",
        file_columns(),
        tags_column()
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values), map_archive_file)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

fn count_files_with_connection(
    connection: &Connection,
    root: &Path,
    query: &ArchiveQuery,
) -> AppResult<i64> {
    let resolved = resolve_query(connection, root, query)?;
    let (filter, values) = build_filter(root, &resolved);
    connection
        .query_row(
            &format!("SELECT COUNT(*) FROM workspace_files wf {filter}"),
            params_from_iter(values),
            |row| row.get(0),
        )
        .map_err(AppError::from)
}

#[derive(Clone, Default)]
struct ResolvedQuery {
    search: String,
    inbox_only: bool,
    favorite_only: bool,
    recent_only: bool,
    platform: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
    status: Option<ArchiveStatus>,
    tags: Vec<String>,
}

fn resolve_query(
    connection: &Connection,
    root: &Path,
    query: &ArchiveQuery,
) -> AppResult<ResolvedQuery> {
    let mut resolved = ResolvedQuery {
        search: limited_text(&query.search, 256),
        inbox_only: query.inbox_only,
        favorite_only: query.favorite_only,
        recent_only: query.recent_only,
        platform: query.platform.as_deref().map(normalize_platform),
        min_rating: validate_rating(query.min_rating)?,
        max_rating: validate_rating(query.max_rating)?,
        status: query.status,
        tags: query
            .tag
            .as_ref()
            .map(|tag| vec![limited_text(tag, 64)])
            .unwrap_or_default(),
    };
    if let Some(collection_id) = query.collection_id {
        let record = load_collection_record(connection, root, collection_id)?;
        if resolved.platform.is_none() {
            resolved.platform = record.platform;
        }
        if resolved.min_rating.is_none() {
            resolved.min_rating = record.min_rating;
        }
        if resolved.max_rating.is_none() {
            resolved.max_rating = record.max_rating;
        }
        if resolved.status.is_none() {
            resolved.status = record.status;
        }
        resolved.tags.extend(record.tags);
    }
    if let (Some(minimum), Some(maximum)) = (resolved.min_rating, resolved.max_rating) {
        if minimum > maximum {
            return Err(archive_error("minimum rating cannot exceed maximum rating"));
        }
    }
    Ok(resolved)
}

fn build_filter(root: &Path, query: &ResolvedQuery) -> (String, Vec<Value>) {
    let mut values = vec![Value::Text(path_text(root))];
    let mut sql = format!(
        "WHERE wf.workspace_root = ?1 COLLATE NOCASE AND wf.available = 1 AND wf.archived = {}",
        if query.inbox_only { 0 } else { 1 }
    );
    if query.favorite_only {
        sql.push_str(" AND wf.favorite = 1");
    }
    if query.recent_only {
        sql.push_str(" AND wf.last_opened IS NOT NULL");
    }
    if let Some(platform) = &query.platform {
        values.push(Value::Text(platform.clone()));
        sql.push_str(&format!(
            " AND wf.platform = ?{} COLLATE NOCASE",
            values.len()
        ));
    }
    if let Some(minimum) = query.min_rating {
        values.push(Value::Integer(minimum));
        sql.push_str(&format!(" AND wf.rating >= ?{}", values.len()));
    }
    if let Some(maximum) = query.max_rating {
        values.push(Value::Integer(maximum));
        sql.push_str(&format!(" AND wf.rating <= ?{}", values.len()));
    }
    if let Some(status) = query.status {
        values.push(Value::Text(status.as_str().to_owned()));
        sql.push_str(&format!(" AND wf.status = ?{}", values.len()));
    }
    if !query.search.is_empty() {
        values.push(Value::Text(format!("%{}%", query.search)));
        let index = values.len();
        sql.push_str(&format!(
            " AND (wf.title LIKE ?{index} OR wf.path LIKE ?{index}
                    OR wf.problem_id LIKE ?{index} OR wf.platform LIKE ?{index}
                    OR wf.note LIKE ?{index}
                    OR EXISTS (
                        SELECT 1 FROM file_tags sft JOIN tags st ON st.id = sft.tag_id
                        WHERE sft.file_id = wf.id AND st.name LIKE ?{index}
                    ))"
        ));
    }
    let tags = query
        .tags
        .iter()
        .filter(|tag| !tag.is_empty())
        .cloned()
        .collect::<Vec<_>>();
    if !tags.is_empty() {
        let mut placeholders = Vec::with_capacity(tags.len());
        for tag in tags {
            values.push(Value::Text(tag));
            placeholders.push(format!("?{}", values.len()));
        }
        sql.push_str(&format!(
            " AND EXISTS (
                SELECT 1 FROM file_tags qft JOIN tags qt ON qt.id = qft.tag_id
                WHERE qft.file_id = wf.id AND qt.name IN ({})
              )",
            placeholders.join(", ")
        ));
    }
    (sql, values)
}

fn register_path_in_transaction(
    transaction: &Transaction<'_>,
    root: &Path,
    path: &str,
) -> AppResult<()> {
    if !is_cpp_path(path) {
        return Ok(());
    }
    let path = normalized_path(path);
    transaction.execute(
        "INSERT INTO workspace_files (workspace_root, path, title)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET
            workspace_root = excluded.workspace_root,
            title = CASE
                WHEN workspace_files.archived = 0 THEN excluded.title
                ELSE workspace_files.title
            END,
            available = 1,
            updated_at = CASE
                WHEN workspace_files.available = 0
                    THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ELSE workspace_files.updated_at
            END",
        params![path_text(root), path, file_title(&path)],
    )?;
    Ok(())
}

fn attach_tags(transaction: &Transaction<'_>, file_id: i64, tags: &[String]) -> AppResult<()> {
    for tag in tags {
        transaction.execute(
            "INSERT INTO tags (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
            [tag],
        )?;
        let tag_id: i64 = transaction.query_row(
            "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
            [tag],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
            params![file_id, tag_id],
        )?;
    }
    Ok(())
}

fn get_file_by_id(connection: &Connection, id: i64) -> AppResult<ArchiveFile> {
    let sql = format!(
        "SELECT {}, {} FROM workspace_files wf
         LEFT JOIN file_tags ft ON ft.file_id = wf.id
         LEFT JOIN tags t ON t.id = ft.tag_id
         WHERE wf.id = ?1 GROUP BY wf.id",
        file_columns(),
        tags_column()
    );
    connection
        .query_row(&sql, [id], map_archive_file)
        .map_err(AppError::from)
}

fn file_columns() -> &'static str {
    "wf.id, wf.path, wf.title, wf.platform, wf.problem_id, wf.rating,
     wf.status, wf.note, wf.favorite, wf.archived,
     wf.created_at, wf.updated_at, wf.last_opened"
}

fn tags_column() -> &'static str {
    "COALESCE(GROUP_CONCAT(t.name, char(31)), '')"
}

fn map_archive_file(row: &Row<'_>) -> rusqlite::Result<ArchiveFile> {
    let tags = row.get::<_, String>(13)?;
    Ok(ArchiveFile {
        id: row.get(0)?,
        path: row.get(1)?,
        title: row.get(2)?,
        platform: row.get(3)?,
        problem_id: row.get(4)?,
        rating: row.get(5)?,
        status: ArchiveStatus::from_text(&row.get::<_, String>(6)?),
        note: row.get(7)?,
        favorite: row.get(8)?,
        archived: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        last_opened: row.get(12)?,
        tags: tags
            .split(TAG_SEPARATOR)
            .filter(|tag| !tag.is_empty())
            .map(str::to_owned)
            .collect(),
    })
}

fn grouped_counts(connection: &Connection, sql: &str, root: &str) -> AppResult<Vec<NamedCount>> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map([root], |row| {
        Ok(NamedCount {
            name: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

#[derive(Clone)]
struct CollectionRecord {
    id: i64,
    name: String,
    platform: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
    status: Option<ArchiveStatus>,
    tags: Vec<String>,
    created_at: String,
    updated_at: String,
}

fn map_collection_record(row: &Row<'_>) -> rusqlite::Result<CollectionRecord> {
    let status = row.get::<_, Option<String>>(5)?;
    let tags = row.get::<_, String>(6)?;
    Ok(CollectionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        platform: row.get(2)?,
        min_rating: row.get(3)?,
        max_rating: row.get(4)?,
        status: status.as_deref().map(ArchiveStatus::from_text),
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn load_collection_record(
    connection: &Connection,
    root: &Path,
    id: i64,
) -> AppResult<CollectionRecord> {
    connection
        .query_row(
            "SELECT id, name, platform, min_rating, max_rating, status, tags, created_at, updated_at
             FROM collections WHERE id = ?1 AND workspace_root = ?2 COLLATE NOCASE",
            params![id, path_text(root)],
            map_collection_record,
        )
        .optional()?
        .ok_or_else(|| archive_error(format!("smart collection {id} does not exist")))
}

fn collection_from_record(
    connection: &Connection,
    root: &Path,
    record: CollectionRecord,
) -> AppResult<SmartCollection> {
    let query = ArchiveQuery {
        collection_id: Some(record.id),
        ..ArchiveQuery::default()
    };
    let count = count_files_with_connection(connection, root, &query)?;
    Ok(SmartCollection {
        id: record.id,
        name: record.name,
        platform: record.platform,
        min_rating: record.min_rating,
        max_rating: record.max_rating,
        status: record.status,
        tags: record.tags,
        count,
        created_at: record.created_at,
        updated_at: record.updated_at,
    })
}

fn get_collection(connection: &Connection, root: &Path, id: i64) -> AppResult<SmartCollection> {
    let record = load_collection_record(connection, root, id)?;
    collection_from_record(connection, root, record)
}

struct SanitizedCollection {
    name: String,
    platform: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
    status: Option<ArchiveStatus>,
    tags: Vec<String>,
}

impl SanitizedCollection {
    fn new(input: &SmartCollectionInput) -> AppResult<Self> {
        let min_rating = validate_rating(input.min_rating)?;
        let max_rating = validate_rating(input.max_rating)?;
        if let (Some(minimum), Some(maximum)) = (min_rating, max_rating) {
            if minimum > maximum {
                return Err(archive_error("minimum rating cannot exceed maximum rating"));
            }
        }
        Ok(Self {
            name: required_text(&input.name, "collection name", 128)?,
            platform: input
                .platform
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(normalize_platform),
            min_rating,
            max_rating,
            status: input.status,
            tags: sanitize_tags(&input.tags)?,
        })
    }
}

fn sanitize_tags(tags: &[String]) -> AppResult<Vec<String>> {
    let mut seen = HashSet::new();
    let mut sanitized = Vec::new();
    for raw in tags {
        let tag = limited_text(raw, 64);
        if tag.is_empty() {
            continue;
        }
        let key = tag.to_lowercase();
        if seen.insert(key) {
            sanitized.push(tag);
        }
        if sanitized.len() > TAG_LIMIT {
            return Err(archive_error(format!(
                "a file or collection can contain at most {TAG_LIMIT} tags"
            )));
        }
    }
    Ok(sanitized)
}

fn checked_cpp_path(root: &Path, path: &str) -> AppResult<String> {
    let canonical = dunce::canonicalize(path)?;
    if !is_within(root, &canonical) || !canonical.is_file() {
        return Err(archive_error(
            "archive path must be an existing workspace file",
        ));
    }
    let result = path_text(&canonical);
    if !is_cpp_path(&result) {
        return Err(archive_error("only .cpp source files can be archived"));
    }
    Ok(result)
}

fn validate_rating(rating: Option<i64>) -> AppResult<Option<i64>> {
    if rating.is_some_and(|value| !(0..=10_000).contains(&value)) {
        return Err(archive_error("rating must be between 0 and 10000"));
    }
    Ok(rating)
}

fn required_text(value: &str, field: &str, maximum: usize) -> AppResult<String> {
    let value = limited_text(value, maximum);
    if value.is_empty() {
        Err(archive_error(format!("{field} cannot be empty")))
    } else {
        Ok(value)
    }
}

fn limited_text(value: &str, maximum: usize) -> String {
    value.trim().chars().take(maximum).collect()
}

fn normalize_platform(value: &str) -> String {
    let value = limited_text(value, 64).to_lowercase();
    match value.as_str() {
        "" | "other" | "其他" => "other".to_owned(),
        "codeforces" | "cf" => "codeforces".to_owned(),
        "atcoder" => "atcoder".to_owned(),
        "luogu" | "洛谷" => "luogu".to_owned(),
        _ => value,
    }
}

fn is_cpp_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cpp"))
}

fn file_title(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_owned())
}

fn normalized_path(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_owned()
}

fn path_text(path: &Path) -> String {
    normalized_path(&dunce::simplified(path).to_string_lossy())
}

fn same_or_child_path(path: &str, parent: &str) -> bool {
    if path.eq_ignore_ascii_case(parent) {
        return true;
    }
    path.len() > parent.len()
        && path
            .get(..parent.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(parent))
        && path.as_bytes().get(parent.len()) == Some(&b'\\')
}

fn ensure_changed(changed: usize, entity: &str, id: i64) -> AppResult<()> {
    if changed == 0 {
        Err(archive_error(format!("{entity} {id} does not exist")))
    } else {
        Ok(())
    }
}

fn archive_error(message: impl Into<String>) -> AppError {
    AppError::Configuration(format!("archive error: {}", message.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database;
    use std::{fs, path::PathBuf, time::UNIX_EPOCH};

    #[test]
    fn archive_filters_tags_and_smart_collections_without_copying_files() {
        let (root, database_path) = temporary_archive("metadata");
        let first = root.join("D. Destiny.cpp");
        let second = root.join("practice.cpp");
        fs::write(&first, "int main() { return 0; }\n").expect("first source");
        fs::write(&second, "int main() { return 1; }\n").expect("second source");
        register_path(&database_path, &root, &path_text(&first)).expect("register first");
        register_path(&database_path, &root, &path_text(&second)).expect("register second");

        let inbox = list_files(
            &database_path,
            &root,
            &ArchiveQuery {
                inbox_only: true,
                ..ArchiveQuery::default()
            },
        )
        .expect("inbox query");
        assert_eq!(inbox.len(), 2);

        let archived = archive_file(
            &database_path,
            &root,
            &ArchiveInput {
                path: path_text(&first),
                title: "D. Destiny".to_owned(),
                platform: "Codeforces".to_owned(),
                problem_id: "840D".to_owned(),
                rating: Some(2500),
                status: ArchiveStatus::Completed,
                note: "主席树经典题".to_owned(),
                favorite: true,
                tags: vec!["主席树".to_owned(), "区间查询".to_owned()],
            },
        )
        .expect("archive file");
        assert_eq!(archived.tags.len(), 2);

        let tag_result = list_files(
            &database_path,
            &root,
            &ArchiveQuery {
                tag: Some("主席树".to_owned()),
                ..ArchiveQuery::default()
            },
        )
        .expect("tag query");
        assert_eq!(tag_result.len(), 1);
        assert_eq!(tag_result[0].problem_id, "840D");

        let collection = create_collection(
            &database_path,
            &root,
            &SmartCollectionInput {
                name: "高难数据结构".to_owned(),
                platform: None,
                min_rating: Some(2400),
                max_rating: Some(3000),
                status: Some(ArchiveStatus::Completed),
                tags: vec!["主席树".to_owned(), "FHQ".to_owned()],
            },
        )
        .expect("smart collection");
        assert_eq!(collection.count, 1);
        assert_eq!(
            fs::read_to_string(&first).expect("source remains readable"),
            "int main() { return 0; }\n"
        );
        cleanup_archive(root, database_path);
    }

    #[test]
    fn bulk_updates_and_path_changes_preserve_metadata() {
        let (root, database_path) = temporary_archive("bulk-path");
        let first = root.join("first.cpp");
        let second = root.join("第二题.cpp");
        fs::write(&first, "// first").expect("first source");
        fs::write(&second, "// second").expect("second source");
        register_path(&database_path, &root, &path_text(&first)).expect("register first");
        register_path(&database_path, &root, &path_text(&second)).expect("register second");
        let inbox = list_files(
            &database_path,
            &root,
            &ArchiveQuery {
                inbox_only: true,
                ..ArchiveQuery::default()
            },
        )
        .expect("inbox");
        bulk_update(
            &database_path,
            &root,
            &ArchiveBulkInput {
                file_ids: inbox.iter().map(|file| file.id).collect(),
                add_tags: vec!["DP".to_owned()],
                platform: Some("AtCoder".to_owned()),
                rating: Some(1800),
                status: Some(ArchiveStatus::Review),
            },
        )
        .expect("bulk update");
        let archived =
            list_files(&database_path, &root, &ArchiveQuery::default()).expect("archived list");
        assert_eq!(archived.len(), 2);
        assert!(archived.iter().all(|file| file.tags == ["DP"]));

        let renamed = root.join("renamed.cpp");
        fs::rename(&first, &renamed).expect("rename source");
        sync_deleted_path(&database_path, &root, &path_text(&first)).expect("mark deleted");
        sync_renamed_path(
            &database_path,
            &root,
            &path_text(&first),
            &path_text(&renamed),
        )
        .expect("sync rename");
        let metadata = get_file_by_path(&database_path, &root, &path_text(&renamed))
            .expect("metadata query")
            .expect("metadata exists");
        assert_eq!(metadata.platform, "atcoder");
        assert_eq!(metadata.status, ArchiveStatus::Review);
        cleanup_archive(root, database_path);
    }

    fn temporary_archive(label: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "lightcp-archive-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir(&root).expect("archive root");
        let root = dunce::canonicalize(root).expect("canonical root");
        let database_path = root.join("archive.db");
        database::initialize(&database_path).expect("database initialization");
        (root, database_path)
    }

    fn cleanup_archive(root: PathBuf, database_path: PathBuf) {
        let _ = fs::remove_file(database_path.with_extension("db-shm"));
        let _ = fs::remove_file(database_path.with_extension("db-wal"));
        fs::remove_dir_all(root).expect("archive cleanup");
    }
}
