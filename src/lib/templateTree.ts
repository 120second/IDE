import type {
  TemplateCategory,
  TemplateCategoryRow,
  TemplateMetadata,
  TemplateTreeRow,
} from "./types/templates";

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

export function buildTemplateTreeRows(
  categories: readonly TemplateCategory[],
  templates: readonly TemplateMetadata[],
  expandedCategories: ReadonlySet<number>,
): TemplateTreeRow[] {
  const categoryChildren = new Map<number | undefined, TemplateCategory[]>();
  const templateChildren = new Map<number | undefined, TemplateMetadata[]>();

  for (const category of categories) {
    const siblings = categoryChildren.get(category.parentId) ?? [];
    siblings.push(category);
    categoryChildren.set(category.parentId, siblings);
  }
  for (const template of templates) {
    const siblings = templateChildren.get(template.categoryId) ?? [];
    siblings.push(template);
    templateChildren.set(template.categoryId, siblings);
  }
  for (const siblings of categoryChildren.values()) {
    siblings.sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
  }
  type PendingRow =
    | { kind: "category"; category: TemplateCategory; depth: number }
    | { kind: "template"; template: TemplateMetadata; depth: number };

  const stack: PendingRow[] = [];
  pushChildren(stack, categoryChildren.get(undefined) ?? [], templateChildren.get(undefined) ?? [], 0);
  const rows: TemplateTreeRow[] = [];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.kind === "template") {
      rows.push(item);
      continue;
    }

    const childCategories = categoryChildren.get(item.category.id) ?? [];
    const childTemplates = templateChildren.get(item.category.id) ?? [];
    const expanded = expandedCategories.has(item.category.id);
    rows.push({
      kind: "category",
      category: item.category,
      depth: item.depth,
      expanded,
      hasChildren: childCategories.length > 0 || childTemplates.length > 0,
    });
    if (expanded) pushChildren(stack, childCategories, childTemplates, item.depth + 1);
  }
  return rows;
}

function pushChildren(
  stack: Array<
    | { kind: "category"; category: TemplateCategory; depth: number }
    | { kind: "template"; template: TemplateMetadata; depth: number }
  >,
  categories: readonly TemplateCategory[],
  templates: readonly TemplateMetadata[],
  depth: number,
): void {
  // Push files first so the LIFO traversal renders folders before files.
  for (let index = templates.length - 1; index >= 0; index -= 1) {
    stack.push({ kind: "template", template: templates[index], depth });
  }
  for (let index = categories.length - 1; index >= 0; index -= 1) {
    stack.push({ kind: "category", category: categories[index], depth });
  }
}
