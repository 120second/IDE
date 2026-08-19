CREATE TABLE recent_workspaces (
    path TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    last_opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recent_workspaces_last_opened
    ON recent_workspaces(last_opened_at DESC);
