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
            6
        );
        assert_eq!(
            apply_pending(&mut connection).expect("second migration run"),
            6
        );

        let applied_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count should be readable");
        assert_eq!(applied_count, 6);
    }
}
