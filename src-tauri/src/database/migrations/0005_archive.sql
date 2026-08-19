CREATE TABLE workspace_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_root TEXT NOT NULL COLLATE NOCASE,
    path TEXT NOT NULL COLLATE NOCASE UNIQUE,
    title TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'other',
    problem_id TEXT NOT NULL DEFAULT '',
    rating INTEGER,
    status TEXT NOT NULL DEFAULT 'unfinished'
        CHECK (status IN ('unfinished', 'completed', 'review', 'mastered')),
    note TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_opened TEXT
);

CREATE INDEX idx_workspace_files_root_archive_updated
    ON workspace_files(workspace_root, archived, available, updated_at DESC);
CREATE INDEX idx_workspace_files_root_status
    ON workspace_files(workspace_root, status, archived, available);
CREATE INDEX idx_workspace_files_root_platform
    ON workspace_files(workspace_root, platform, archived, available);
CREATE INDEX idx_workspace_files_root_rating
    ON workspace_files(workspace_root, rating, archived, available);
CREATE INDEX idx_workspace_files_recent
    ON workspace_files(workspace_root, last_opened DESC);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE file_tags (
    file_id INTEGER NOT NULL REFERENCES workspace_files(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY(file_id, tag_id)
);

CREATE INDEX idx_file_tags_tag_file ON file_tags(tag_id, file_id);

CREATE TABLE collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_root TEXT NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL COLLATE NOCASE,
    platform TEXT,
    min_rating INTEGER,
    max_rating INTEGER,
    status TEXT CHECK (status IS NULL OR status IN ('unfinished', 'completed', 'review', 'mastered')),
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(workspace_root, name),
    CHECK (min_rating IS NULL OR max_rating IS NULL OR min_rating <= max_rating)
);

CREATE INDEX idx_collections_workspace_name
    ON collections(workspace_root, name);
