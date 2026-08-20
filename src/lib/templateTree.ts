import type { TemplateCategory, TemplateCategoryRow } from "./types/templates";

export function buildTemplateCategoryRows(
  categories: readonly TemplateCategory[],
  expandedCategories: ReadonlySet<number>,
): TemplateCategoryRow[] {
  const children = new Map<number | undefined, TemplateCategory[]>();
  for (const category of categories) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
  }

  const rows: TemplateCategoryRow[] = [];
  const roots = children.get(undefined) ?? [];
  const stack = roots
    .slice()
    .reverse()
    .map((category) => ({ category, depth: 0 }));
  while (stack.length > 0) {
    const item = stack.pop()!;
    const descendants = children.get(item.category.id) ?? [];
    const expanded = expandedCategories.has(item.category.id);
    rows.push({
      category: item.category,
      depth: item.depth,
      expanded,
      hasChildren: descendants.length > 0,
    });
    if (!expanded) continue;
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      stack.push({ category: descendants[index], depth: item.depth + 1 });
    }
  }
  return rows;
}

