use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};

use crate::{
    database::connect,
    error::{AppError, AppResult},
    paths::is_within,
};

use super::VisualGeneratorProfile;

const PROFILE_VERSION: u32 = 1;
const MAX_PROFILE_BYTES: usize = 1024 * 1024;

pub fn load_profile(
    database_path: &Path,
    workspace_root: &Path,
    source_path: &str,
) -> AppResult<Option<VisualGeneratorProfile>> {
    let source = checked_source(workspace_root, source_path)?;
    let connection = connect(database_path)?;
    let json = connection
        .query_row(
            "SELECT profile_json FROM generator_profiles WHERE source_path = ?1",
            [path_text(&source)],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    json.map(|json| {
        serde_json::from_str::<VisualGeneratorProfile>(&json).map_err(|error| {
            AppError::Configuration(format!("stored generator profile is invalid: {error}"))
        })
    })
    .transpose()
}

pub fn save_profile(
    database_path: &Path,
    workspace_root: &Path,
    source_path: &str,
    profile: &VisualGeneratorProfile,
) -> AppResult<VisualGeneratorProfile> {
    let source = checked_source(workspace_root, source_path)?;
    if profile.version != PROFILE_VERSION {
        return Err(AppError::Configuration(format!(
            "unsupported generator profile version: {}",
            profile.version
        )));
    }
    let json = serde_json::to_string(profile).map_err(|error| {
        AppError::Configuration(format!(
            "generator profile could not be serialized: {error}"
        ))
    })?;
    if json.len() > MAX_PROFILE_BYTES {
        return Err(AppError::Configuration(
            "generator profile exceeds the 1 MiB limit".to_owned(),
        ));
    }
    let connection = connect(database_path)?;
    connection.execute(
        "INSERT INTO generator_profiles (source_path, profile_json)
         VALUES (?1, ?2)
         ON CONFLICT(source_path) DO UPDATE SET
            profile_json = excluded.profile_json,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![path_text(&source), json],
    )?;
    Ok(profile.clone())
}

fn checked_source(root: &Path, source_path: &str) -> AppResult<PathBuf> {
    let root = dunce::canonicalize(root)?;
    let source = dunce::canonicalize(source_path)?;
    if !is_within(&root, &source) || !source.is_file() {
        return Err(AppError::FileSystemOperation(format!(
            "generator source is outside the active workspace: {}",
            source.display()
        )));
    }
    Ok(source)
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use std::{fs, time::UNIX_EPOCH};

    use crate::{
        database,
        generator::{GeneratorStrategy, TreeShape, ValueExpression, VisualField, VisualNode},
    };

    use super::*;

    #[test]
    fn profile_survives_database_round_trip() {
        let nonce = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lightcp-generator-profile-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("题目.cpp");
        fs::write(&source, "int main() {}\n").unwrap();
        let database_path = root.join("test.db");
        database::initialize(&database_path).unwrap();
        let profile = VisualGeneratorProfile {
            version: 1,
            strategy: GeneratorStrategy::Mixed,
            tree_shape: TreeShape::Star,
            seed: "42".into(),
            nodes: vec![VisualNode::Line {
                id: "line".into(),
                fields: vec![VisualField::Integer {
                    id: "n-field".into(),
                    name: "n".into(),
                    minimum: ValueExpression::Constant { value: "1".into() },
                    maximum: ValueExpression::Constant {
                        value: "100".into(),
                    },
                }],
            }],
        };
        save_profile(&database_path, &root, source.to_str().unwrap(), &profile).unwrap();
        assert_eq!(
            load_profile(&database_path, &root, source.to_str().unwrap()).unwrap(),
            Some(profile)
        );
        fs::remove_dir_all(root).unwrap();
    }
}
