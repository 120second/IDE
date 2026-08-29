CREATE TABLE archive_reviews (
    file_id INTEGER PRIMARY KEY REFERENCES workspace_files(id) ON DELETE CASCADE,
    review_step INTEGER NOT NULL DEFAULT 0 CHECK (review_step BETWEEN 0 AND 6),
    next_review_at TEXT,
    last_reviewed_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (review_step < 6 AND next_review_at IS NOT NULL AND completed_at IS NULL)
        OR (review_step = 6 AND next_review_at IS NULL AND completed_at IS NOT NULL)
    )
);

CREATE INDEX idx_archive_reviews_due
    ON archive_reviews(next_review_at, review_step);

-- Existing archived files join the same review workflow without losing metadata.
INSERT INTO archive_reviews (file_id, next_review_at)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+1 day')
FROM workspace_files
WHERE archived = 1;
