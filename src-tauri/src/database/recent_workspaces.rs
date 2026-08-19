use std::path::Path;

use rusqlite::params;

use crate::{error::AppResult, filesystem::WorkspaceInfo};

use super::connect;

pub fn record(database_path: &Path, workspace: &WorkspaceInfo) -> AppResult<()> {
    let connection = connect(database_path)?;
    connection.execute(
        "INSERT INTO recent_workspaces (path, display_name, last_opened_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(path) DO UPDATE SET
             display_name = excluded.display_name,
             last_opened_at = excluded.last_opened_at",
        params![workspace.path, workspace.name],
    )?;
    Ok(())
}

pub fn list(database_path: &Path, limit: usize) -> AppResult<Vec<WorkspaceInfo>> {
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT display_name, path
         FROM recent_workspaces
         ORDER BY last_opened_at DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map([limit as i64], |row| {
        Ok(WorkspaceInfo {
            name: row.get(0)?,
            path: row.get(1)?,
        })
    })?;

    let mut workspaces = Vec::new();
    for row in rows {
        let workspace = row?;
        if Path::new(&workspace.path).is_dir() {
            workspaces.push(workspace);
        }
    }
    Ok(workspaces)
}
