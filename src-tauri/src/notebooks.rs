use crate::{
    database::connect,
    error::{AppError, AppResult},
};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookRecord {
    pub source_path: String,
    pub content: String,
}

fn validate(kind: &str, key: &str, content: &str) -> AppResult<()> {
    if !matches!(kind, "problem" | "sketch" | "annotations")
        || key.len() > 16_384
        || content.len() > 32 * 1024 * 1024
    {
        return Err(AppError::Configuration(
            "notebook kind, key or content exceeds limits".into(),
        ));
    }
    serde_json::from_str::<serde_json::Value>(content)
        .map_err(|error| AppError::Configuration(error.to_string()))?;
    Ok(())
}
pub fn read(db: &Path, kind: &str, key: &str) -> AppResult<Option<String>> {
    validate(kind, key, "null")?;
    connect(db)?
        .query_row(
            "SELECT content FROM notebook_records WHERE kind=?1 AND source_path=?2",
            params![kind, key],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}
pub fn write(db: &Path, kind: &str, key: &str, content: &str) -> AppResult<()> {
    validate(kind, key, content)?;
    connect(db)?.execute("INSERT INTO notebook_records(kind, source_path, content) VALUES (?1,?2,?3) ON CONFLICT(kind,source_path) DO UPDATE SET content=excluded.content", params![kind, key, content])?;
    Ok(())
}
pub fn delete(db: &Path, kind: &str, key: &str) -> AppResult<()> {
    validate(kind, key, "null")?;
    connect(db)?.execute(
        "DELETE FROM notebook_records WHERE kind=?1 AND source_path=?2",
        params![kind, key],
    )?;
    Ok(())
}
pub fn import_legacy(
    db: &Path,
    kind: &str,
    storage_key: &str,
    records: &[NotebookRecord],
) -> AppResult<()> {
    if storage_key.len() > 128 {
        return Err(AppError::Configuration("invalid legacy key".into()));
    }
    let mut connection = connect(db)?;
    let transaction = connection.transaction()?;
    if transaction
        .query_row(
            "SELECT 1 FROM notebook_migrations WHERE storage_key=?1",
            [storage_key],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Ok(());
    }
    for record in records {
        validate(kind, &record.source_path, &record.content)?;
        transaction.execute(
            "INSERT OR IGNORE INTO notebook_records(kind,source_path,content) VALUES (?1,?2,?3)",
            params![kind, record.source_path, record.content],
        )?;
    }
    transaction.execute(
        "INSERT INTO notebook_migrations(storage_key) VALUES (?1)",
        [storage_key],
    )?;
    transaction.commit()?;
    Ok(())
}
fn moved_key(key: &str, previous: &str, next: &str) -> Option<String> {
    let original_key = key.replace('/', "\\");
    let previous_lower = previous.replace('/', "\\").to_lowercase();
    let previous_length = previous.chars().count();
    let key_lower = key.replace('/', "\\").to_lowercase();
    if key_lower == previous_lower
        || key_lower.starts_with(&format!("{previous_lower}\\"))
        || key_lower.starts_with(&format!("{previous_lower}::"))
    {
        Some(format!(
            "{next}{}",
            original_key
                .chars()
                .skip(previous_length)
                .collect::<String>()
        ))
    } else {
        None
    }
}
pub fn remap_in_transaction(
    transaction: &Transaction<'_>,
    previous: &str,
    next: &str,
) -> AppResult<()> {
    let previous = previous.replace('/', "\\");
    let next = next.replace('/', "\\");
    if previous == next {
        return Ok(());
    }
    let records = {
        let mut statement =
            transaction.prepare("SELECT kind,source_path,content FROM notebook_records")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (kind, key, content) in records {
        if let Some(target) = moved_key(&key, &previous.to_lowercase(), &next.to_lowercase()) {
            if target == key {
                continue;
            }
            transaction.execute("INSERT INTO notebook_records(kind,source_path,content) VALUES (?1,?2,?3) ON CONFLICT(kind,source_path) DO UPDATE SET content=excluded.content", params![kind, target, content])?;
            transaction.execute(
                "DELETE FROM notebook_records WHERE kind=?1 AND source_path=?2",
                params![kind, key],
            )?;
        }
    }
    // Testcases and generator settings use absolute paths too. Update a whole
    // subtree without matching similarly named sibling directories.
    for table in ["testcases", "generator_profiles"] {
        let paths = {
            let mut statement =
                transaction.prepare(&format!("SELECT DISTINCT source_path FROM {table}"))?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for path in paths {
            if let Some(target) = moved_key(&path, &previous, &next) {
                // Generator profile destination may contain stale settings for a
                // previously deleted file. The moved file keeps its own profile.
                if table == "generator_profiles" {
                    transaction.execute("DELETE FROM generator_profiles WHERE source_path=?1 COLLATE NOCASE AND source_path<>?2", params![target, path])?;
                }
                transaction.execute(
                    &format!("UPDATE {table} SET source_path=?1 WHERE source_path=?2"),
                    params![target, path],
                )?;
            }
        }
    }
    Ok(())
}
pub fn remap(db: &Path, previous: &str, next: &str) -> AppResult<()> {
    let mut connection = connect(db)?;
    let transaction = connection.transaction()?;
    remap_in_transaction(&transaction, previous, next)?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::apply_pending;

    #[test]
    fn renames_migrate_all_data_without_matching_sibling_prefixes() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        apply_pending(&mut connection).unwrap();
        for path in [r"D:\Code\题目\A.cpp", r"D:\Code\题目2\A.cpp"] {
            connection
                .execute(
                    "INSERT INTO testcases(source_path,kind,name) VALUES (?1,'sample','case')",
                    [path],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO generator_profiles(source_path,profile_json) VALUES (?1,'{}')",
                    [path],
                )
                .unwrap();
            connection.execute("INSERT INTO notebook_records(kind,source_path,content) VALUES ('problem',?1,'{}')", [path.to_lowercase()]).unwrap();
        }
        let transaction = connection.transaction().unwrap();
        remap_in_transaction(&transaction, r"D:\Code\题目", r"D:\Code\Moved").unwrap();
        transaction.commit().unwrap();
        for table in ["testcases", "generator_profiles"] {
            let count: i64 = connection
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE source_path=?1"),
                    [r"D:\Code\Moved\A.cpp"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1);
            let sibling: i64 = connection
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE source_path=?1"),
                    [r"D:\Code\题目2\A.cpp"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(sibling, 1);
        }
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM notebook_records WHERE source_path=?1",
                [r"d:\code\moved\a.cpp"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn case_only_rename_preserves_profile_and_annotations() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        apply_pending(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO generator_profiles(source_path,profile_json) VALUES (?1,'{}')",
                [r"D:\Code\A.cpp"],
            )
            .unwrap();
        connection.execute("INSERT INTO notebook_records(kind,source_path,content) VALUES ('annotations',?1,'{}')", [r"d:\code\a.cpp::pdf"]).unwrap();
        let transaction = connection.transaction().unwrap();
        remap_in_transaction(&transaction, r"D:\Code\A.cpp", r"D:\Code\a.cpp").unwrap();
        transaction.commit().unwrap();
        let path: String = connection
            .query_row("SELECT source_path FROM generator_profiles", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(path, r"D:\Code\a.cpp");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM notebook_records", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration_is_atomic_and_does_not_resurrect_deleted_legacy_entries() {
        let root = std::env::temp_dir().join(format!(
            "lightcp-notebook-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let db = root.join("data.db");
        crate::database::initialize(&db).unwrap();
        let records = [NotebookRecord {
            source_path: "a".into(),
            content: "{\"title\":\"legacy\"}".into(),
        }];
        import_legacy(&db, "problem", "legacy", &records).unwrap();
        assert!(read(&db, "problem", "a").unwrap().is_some());
        delete(&db, "problem", "a").unwrap();
        import_legacy(&db, "problem", "legacy", &records).unwrap();
        assert!(read(&db, "problem", "a").unwrap().is_none());
        let bad = [
            NotebookRecord {
                source_path: "b".into(),
                content: "{}".into(),
            },
            NotebookRecord {
                source_path: "c".into(),
                content: "invalid-json".into(),
            },
        ];
        assert!(import_legacy(&db, "problem", "bad", &bad).is_err());
        assert!(read(&db, "problem", "b").unwrap().is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
