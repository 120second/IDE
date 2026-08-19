CREATE TABLE generator_profiles (
    source_path TEXT PRIMARY KEY NOT NULL,
    profile_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

