use rusqlite::{params, Connection};

use crate::error::AppResult;

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "foundation",
        sql: include_str!("migrations/0001_foundation.sql"),
    },
    Migration {
        version: 2,
        name: "recent_workspaces",
        sql: include_str!("migrations/0002_recent_workspaces.sql"),
    },
    Migration {
        version: 3,
        name: "templates",
        sql: include_str!("migrations/0003_templates.sql"),
    },
    Migration {
        version: 4,
        name: "fixed_testcases",
        sql: include_str!("migrations/0004_fixed_testcases.sql"),
    },
    Migration {
        version: 5,
        name: "competitive_programming_archive",
        sql: include_str!("migrations/0005_archive.sql"),
    },
    Migration {
        version: 6,
        name: "generator_profiles",
        sql: include_str!("migrations/0006_generator_profiles.sql"),
    },
    Migration {
        version: 7,
        name: "performance_indexes",
        sql: include_str!("migrations/0007_performance_indexes.sql"),
    },
    Migration {
        version: 8,
        name: "archive_reviews",
        sql: include_str!("migrations/0008_archive_reviews.sql"),
    },
];

pub fn apply_pending(connection: &mut Connection) -> AppResult<i64> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );",
    )?;

    let current_version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;

    for migration in MIGRATIONS
        .iter()
        .filter(|migration| migration.version > current_version)
    {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
            params![migration.version, migration.name],
        )?;
        transaction.commit()?;

        log::info!(
            "applied database migration {} ({})",
            migration.version,
            migration.name
        );
    }

    let final_version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;

    Ok(final_version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");

        assert_eq!(
            apply_pending(&mut connection).expect("first migration run"),
            8
        );
        assert_eq!(
            apply_pending(&mut connection).expect("second migration run"),
            8
        );

        let applied_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count should be readable");
        assert_eq!(applied_count, 8);
    }

    #[test]
    fn template_indexes_avoid_temporary_sort_tables() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        apply_pending(&mut connection).expect("migrations");
        for ordering in [
            "sort_order, id",
            "name COLLATE NOCASE, id",
            "use_count DESC, name COLLATE NOCASE, id",
            "created_at DESC, id",
        ] {
            let sql = format!(
                "EXPLAIN QUERY PLAN SELECT id FROM templates WHERE kind = 'snippet' ORDER BY {ordering}"
            );
            let mut statement = connection.prepare(&sql).expect("query plan");
            let details = statement
                .query_map([], |row| row.get::<_, String>(3))
                .expect("query plan rows")
                .collect::<Result<Vec<_>, _>>()
                .expect("query plan details");
            assert!(
                details.iter().all(|detail| !detail.contains("TEMP B-TREE")),
                "unexpected temporary sort for {ordering}: {details:?}"
            );
        }
    }
}
