use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::{
    database::connect,
    error::{AppError, AppResult},
};

use super::{Testcase, TestcaseInput, TestcaseKind};

pub fn list(
    database_path: &Path,
    workspace_root: &Path,
    source_path: &str,
) -> AppResult<Vec<Testcase>> {
    let source_path = checked_source(workspace_root, source_path)?;
    let connection = connect(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, source_path, kind, name, input, expected_output, enabled,
                sort_order, created_at, updated_at
         FROM testcases WHERE source_path = ?1 ORDER BY sort_order, id",
    )?;
    let rows = statement.query_map([path_text(&source_path)], map_testcase)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn create(
    database_path: &Path,
    workspace_root: &Path,
    input: &TestcaseInput,
) -> AppResult<Testcase> {
    let source_path = checked_source(workspace_root, &input.source_path)?;
    let name = required_name(&input.name)?;
    let connection = connect(database_path)?;
    let sort_order: i64 = connection.query_row(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM testcases WHERE source_path = ?1",
        [path_text(&source_path)],
        |row| row.get(0),
    )?;
    connection.execute(
        "INSERT INTO testcases (
            source_path, kind, name, input, expected_output, enabled, sort_order
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            path_text(&source_path),
            input.kind.as_str(),
            name,
            input.input,
            input.expected_output,
            input.enabled,
            sort_order,
        ],
    )?;
    get_from_connection(&connection, connection.last_insert_rowid())
}

pub fn update(
    database_path: &Path,
    workspace_root: &Path,
    id: i64,
    input: &TestcaseInput,
) -> AppResult<Testcase> {
    let source_path = checked_source(workspace_root, &input.source_path)?;
    let name = required_name(&input.name)?;
    let connection = connect(database_path)?;
    let changed = connection.execute(
        "UPDATE testcases SET
            source_path = ?2, kind = ?3, name = ?4, input = ?5,
            expected_output = ?6, enabled = ?7,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![
            id,
            path_text(&source_path),
            input.kind.as_str(),
            name,
            input.input,
            input.expected_output,
            input.enabled,
        ],
    )?;
    ensure_changed(changed, id)?;
    get_from_connection(&connection, id)
}

pub fn duplicate(database_path: &Path, workspace_root: &Path, id: i64) -> AppResult<Testcase> {
    let original = get(database_path, id)?;
    checked_source(workspace_root, &original.source_path)?;
    let input = TestcaseInput {
        source_path: original.source_path,
        kind: original.kind,
        name: format!("{} Copy", original.name),
        input: original.input,
        expected_output: original.expected_output,
        enabled: original.enabled,
    };
    let duplicate = create(database_path, workspace_root, &input)?;
    move_to(
        database_path,
        workspace_root,
        duplicate.id,
        original.sort_order + 1,
    )?;
    get(database_path, duplicate.id)
}

pub fn delete(database_path: &Path, workspace_root: &Path, id: i64) -> AppResult<()> {
    let testcase = get(database_path, id)?;
    checked_source(workspace_root, &testcase.source_path)?;
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    ensure_changed(
        transaction.execute("DELETE FROM testcases WHERE id = ?1", [id])?,
        id,
    )?;
    normalize_order(&transaction, &testcase.source_path)?;
    transaction.commit()?;
    Ok(())
}

pub fn move_to(
    database_path: &Path,
    workspace_root: &Path,
    id: i64,
    target_index: i64,
) -> AppResult<()> {
    let testcase = get(database_path, id)?;
    checked_source(workspace_root, &testcase.source_path)?;
    let mut connection = connect(database_path)?;
    let transaction = connection.transaction()?;
    let mut ids = {
        let mut statement = transaction.prepare(
            "SELECT id FROM testcases
             WHERE source_path = ?1 AND id <> ?2 ORDER BY sort_order, id",
        )?;
        let collected = statement
            .query_map(params![testcase.source_path, id], |row| {
                row.get::<_, i64>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        collected
    };
    let index = usize::try_from(target_index.max(0))
        .unwrap_or(usize::MAX)
        .min(ids.len());
    ids.insert(index, id);
    for (sort_order, testcase_id) in ids.into_iter().enumerate() {
        transaction.execute(
            "UPDATE testcases SET sort_order = ?2 WHERE id = ?1",
            params![testcase_id, sort_order as i64],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

pub fn compare_output(actual: &str, expected: &str) -> bool {
    normalized_lines(actual) == normalized_lines(expected)
}

fn get(database_path: &Path, id: i64) -> AppResult<Testcase> {
    let connection = connect(database_path)?;
    get_from_connection(&connection, id)
}

fn get_from_connection(connection: &Connection, id: i64) -> AppResult<Testcase> {
    connection
        .query_row(
            "SELECT id, source_path, kind, name, input, expected_output, enabled,
                    sort_order, created_at, updated_at
             FROM testcases WHERE id = ?1",
            [id],
            map_testcase,
        )
        .optional()?
        .ok_or_else(|| testcase_error(format!("testcase {id} does not exist")))
}

fn map_testcase(row: &Row<'_>) -> rusqlite::Result<Testcase> {
    Ok(Testcase {
        id: row.get(0)?,
        source_path: row.get(1)?,
        kind: TestcaseKind::parse(&row.get::<_, String>(2)?)?,
        name: row.get(3)?,
        input: row.get(4)?,
        expected_output: row.get(5)?,
        enabled: row.get(6)?,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn checked_source(root: &Path, source_path: &str) -> AppResult<PathBuf> {
    let root = dunce::canonicalize(root)?;
    let source = dunce::canonicalize(source_path)?;
    if !source.starts_with(root) || !source.is_file() {
        return Err(AppError::FileSystemOperation(format!(
            "testcase source is outside the active workspace: {}",
            source.display()
        )));
    }
    Ok(source)
}

fn normalize_order(transaction: &Transaction<'_>, source_path: &str) -> AppResult<()> {
    let ids = {
        let mut statement = transaction
            .prepare("SELECT id FROM testcases WHERE source_path = ?1 ORDER BY sort_order, id")?;
        let collected = statement
            .query_map([source_path], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        collected
    };
    for (sort_order, id) in ids.into_iter().enumerate() {
        transaction.execute(
            "UPDATE testcases SET sort_order = ?2 WHERE id = ?1",
            params![id, sort_order as i64],
        )?;
    }
    Ok(())
}

fn normalized_lines(value: &str) -> Vec<String> {
    let value = value.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = value
        .split('\n')
        .map(|line| line.trim_end_matches([' ', '\t']).to_owned())
        .collect::<Vec<_>>();
    while lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    lines
}

fn required_name(name: &str) -> AppResult<&str> {
    let name = name.trim();
    if name.is_empty() {
        Err(testcase_error("testcase name cannot be empty"))
    } else {
        Ok(name)
    }
}

fn ensure_changed(changed: usize, id: i64) -> AppResult<()> {
    if changed == 0 {
        Err(testcase_error(format!("testcase {id} does not exist")))
    } else {
        Ok(())
    }
}

fn testcase_error(message: impl Into<String>) -> AppError {
    AppError::Configuration(message.into())
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use std::{fs, time::UNIX_EPOCH};

    use crate::database;

    use super::*;

    #[test]
    fn comparator_ignores_only_line_end_spaces_and_final_newlines() {
        assert!(compare_output("1 2  \nhello\t\n\n", "1 2\nhello"));
        assert!(!compare_output("1  2\n", "1 2\n"));
        assert!(!compare_output("a\n\nb", "a\nb"));
    }

    #[test]
    fn testcase_crud_duplicate_and_reorder_are_persistent() {
        let root = temporary_root("crud");
        let source = root.join("中文 source.cpp");
        fs::write(&source, "int main() {}\n").unwrap();
        let database_path = root.join("test.db");
        database::initialize(&database_path).unwrap();
        let first = create(
            &database_path,
            &root,
            &input(&source, "Sample 1", "1\n", "1\n"),
        )
        .unwrap();
        let second = duplicate(&database_path, &root, first.id).unwrap();
        assert_eq!(second.name, "Sample 1 Copy");
        let third = create(&database_path, &root, &input(&source, "Hack", "2\n", "2\n")).unwrap();
        move_to(&database_path, &root, third.id, 0).unwrap();
        let cases = list(&database_path, &root, &path_text(&source)).unwrap();
        assert_eq!(
            cases.iter().map(|case| case.id).collect::<Vec<_>>(),
            vec![third.id, first.id, second.id]
        );
        delete(&database_path, &root, first.id).unwrap();
        let cases = list(&database_path, &root, &path_text(&source)).unwrap();
        assert_eq!(cases.len(), 2);
        assert_eq!(cases[0].sort_order, 0);
        assert_eq!(cases[1].sort_order, 1);
        fs::remove_dir_all(root).unwrap();
    }

    fn input(source: &Path, name: &str, input: &str, expected: &str) -> TestcaseInput {
        TestcaseInput {
            source_path: path_text(source),
            kind: TestcaseKind::Sample,
            name: name.to_owned(),
            input: input.to_owned(),
            expected_output: expected.to_owned(),
            enabled: true,
        }
    }

    fn temporary_root(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lightcp-testcase-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
