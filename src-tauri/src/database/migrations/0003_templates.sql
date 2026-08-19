CREATE TABLE template_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    parent_id INTEGER REFERENCES template_categories(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_template_categories_parent_sort
    ON template_categories(parent_id, sort_order, id);

CREATE TABLE templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('snippet', 'file')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    trigger TEXT NOT NULL DEFAULT '',
    aliases TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'cpp',
    category_id INTEGER REFERENCES template_categories(id) ON DELETE SET NULL,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used TEXT,
    code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_templates_kind_category_sort
    ON templates(kind, category_id, sort_order, id);
CREATE INDEX idx_templates_favorite
    ON templates(kind, favorite, sort_order);
CREATE INDEX idx_templates_last_used
    ON templates(kind, last_used DESC);
CREATE INDEX idx_templates_updated
    ON templates(kind, updated_at DESC);

CREATE TABLE template_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    aliases TEXT NOT NULL,
    description TEXT NOT NULL,
    language TEXT NOT NULL,
    category_id INTEGER,
    favorite INTEGER NOT NULL,
    code TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(template_id, version_number)
);

CREATE INDEX idx_template_versions_template_version
    ON template_versions(template_id, version_number DESC);

INSERT INTO templates (
    kind, name, trigger, aliases, description, language, sort_order, code
) VALUES
(
    'file', 'Empty C++', '', '["empty","空白"]',
    'An empty C++ source file.', 'cpp', 0, ''
),
(
    'file', 'Contest C++', '', '["contest","竞赛"]',
    'Single-test competitive programming entry point.', 'cpp', 1,
    '#include <bits/stdc++.h>
using namespace std;

void solve() {
    
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    solve();
    return 0;
}
'
),
(
    'file', 'Multi Test C++', '', '["multi","多测"]',
    'Competitive programming entry point with multiple test cases.', 'cpp', 2,
    '#include <bits/stdc++.h>
using namespace std;

void solve() {
    
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int tests;
    cin >> tests;
    while (tests--) solve();
    return 0;
}
'
);

INSERT INTO template_versions (
    template_id, version_number, kind, name, trigger, aliases,
    description, language, category_id, favorite, code
)
SELECT
    id, 1, kind, name, trigger, aliases,
    description, language, category_id, favorite, code
FROM templates;

