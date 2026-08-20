-- Query shapes used by the metadata-only template list. The original
-- category index cannot satisfy an all-category ORDER BY because category_id
-- sits between kind and sort_order.
CREATE INDEX idx_templates_kind_sort
    ON templates(kind, sort_order, id);
CREATE INDEX idx_templates_kind_name
    ON templates(kind, name COLLATE NOCASE, id);
CREATE INDEX idx_templates_kind_usage
    ON templates(kind, use_count DESC, name COLLATE NOCASE, id);
CREATE INDEX idx_templates_kind_created
    ON templates(kind, created_at DESC, id);

-- Inbox ordering is by creation time, while the original archive index only
-- covered updated_at.
CREATE INDEX idx_workspace_files_root_archive_created
    ON workspace_files(workspace_root, archived, available, created_at DESC, id DESC);

