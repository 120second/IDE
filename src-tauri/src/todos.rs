use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{
    database::connect,
    error::{AppError, AppResult},
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemTodo {
    pub id: String,
    pub title: String,
    pub url: String,
    pub notes: String,
    pub completed: bool,
    pub created_at: i64,
}

pub fn list(db: &Path) -> AppResult<Vec<ProblemTodo>> {
    let connection = connect(db)?;
    let mut statement = connection.prepare(
        "SELECT id, title, url, notes, completed, created_at FROM problem_todos ORDER BY completed, created_at DESC, id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(ProblemTodo {
            id: row.get(0)?,
            title: row.get(1)?,
            url: row.get(2)?,
            notes: row.get(3)?,
            completed: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn save(db: &Path, mut todo: ProblemTodo) -> AppResult<ProblemTodo> {
    todo.title = todo.title.trim().to_owned();
    todo.url = todo.url.trim().to_owned();
    todo.notes = todo.notes.trim().to_owned();
    if uuid::Uuid::parse_str(&todo.id).is_err()
        || todo.title.is_empty()
        || todo.title.chars().count() > 200
        || todo.url.len() > 2048
        || todo.notes.chars().count() > 2000
        || todo.created_at < 0
    {
        return Err(AppError::Configuration(
            "待办内容无效，请检查题目名称和长度。".into(),
        ));
    }
    if !todo.url.is_empty() {
        let url = url::Url::parse(&todo.url)
            .map_err(|_| AppError::Configuration("请输入有效的 HTTP 或 HTTPS 题目链接。".into()))?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err(AppError::Configuration(
                "题目链接仅支持 HTTP 或 HTTPS。".into(),
            ));
        }
    }
    let connection = connect(db)?;
    connection.execute(
        "INSERT INTO problem_todos(id, title, url, notes, completed, created_at) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, url=excluded.url, notes=excluded.notes, completed=excluded.completed",
        params![todo.id, todo.title, todo.url, todo.notes, todo.completed, todo.created_at],
    )?;
    todo.created_at = connection.query_row(
        "SELECT created_at FROM problem_todos WHERE id=?1",
        [&todo.id],
        |row| row.get(0),
    )?;
    Ok(todo)
}

pub fn delete(db: &Path, id: &str) -> AppResult<()> {
    connect(db)?.execute("DELETE FROM problem_todos WHERE id=?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todos_survive_reopen_and_support_completion_edit_and_delete() {
        let directory =
            std::env::temp_dir().join(format!("lightcp-todos-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let db = directory.join("test.db");
        crate::database::initialize(&db).unwrap();
        let mut todo = save(
            &db,
            ProblemTodo {
                id: uuid::Uuid::new_v4().to_string(),
                title: "  CF 4A  ".into(),
                url: "https://codeforces.com/problemset/problem/4/A".into(),
                notes: "枚举边界".into(),
                completed: false,
                created_at: 100,
            },
        )
        .unwrap();
        assert_eq!(list(&db).unwrap()[0].title, "CF 4A");
        todo.completed = true;
        todo.notes = "已通过".into();
        todo.created_at = 999;
        save(&db, todo.clone()).unwrap();
        let saved = list(&db).unwrap();
        assert_eq!(saved.len(), 1);
        assert!(saved[0].completed);
        assert_eq!(saved[0].notes, "已通过");
        assert_eq!(saved[0].created_at, 100);
        todo.url = "javascript:alert(1)".into();
        assert!(save(&db, todo.clone()).is_err());
        assert_eq!(
            list(&db).unwrap()[0].url,
            "https://codeforces.com/problemset/problem/4/A"
        );
        delete(&db, &todo.id).unwrap();
        assert!(list(&db).unwrap().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
