CREATE TABLE notebook_records (
    kind TEXT NOT NULL,
    source_path TEXT NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY (kind, source_path)
);
CREATE TABLE notebook_migrations (storage_key TEXT PRIMARY KEY);
