mod migrations;
pub mod recent_workspaces;

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::AppResult;

#[derive(Debug)]
pub struct DatabaseInfo {
    pub path: PathBuf,
    pub schema_version: i64,
}

pub fn initialize(path: &Path) -> AppResult<DatabaseInfo> {
    let mut connection = connect(path)?;
    let schema_version = migrations::apply_pending(&mut connection)?;

    Ok(DatabaseInfo {
        path: path.to_path_buf(),
        schema_version,
    })
}

pub(crate) fn connect(path: &Path) -> AppResult<Connection> {
    let connection = Connection::open(path)?;
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(connection)
}
