import { describe, expect, it } from "vitest";
import { buildTemplateCategoryRows, buildTemplateTreeRows } from "./templateTree";
import type { TemplateCategory, TemplateMetadata } from "./types/templates";

describe("buildTemplateCategoryRows", () => {
  it("builds 10000 metadata rows without quadratic rescans", () => {
    const categories = Array.from({ length: 10_000 }, (_, index) => category(index + 1));
    const started = performance.now();
    const rows = buildTemplateCategoryRows(categories, new Set());
    expect(rows).toHaveLength(10_000);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("handles deeply nested expanded categories without recursion", () => {
    const categories = Array.from({ length: 5_000 }, (_, index) =>
      category(index + 1, index === 0 ? undefined : index),
    );
    const rows = buildTemplateCategoryRows(
      categories,
      new Set(categories.map((item) => item.id)),
    );
    expect(rows).toHaveLength(5_000);
    expect(rows.at(-1)?.depth).toBe(4_999);
  });

  it("renders folders before concrete template files at every level", () => {
    const folders = [
      category(1),
      category(2, 1),
    ];
    const templates = [
      template(11, "根文件"),
      template(12, "父级文件", 1),
      template(13, "最底层文件", 2),
    ];

    const rows = buildTemplateTreeRows(folders, templates, new Set([1, 2]));

    expect(rows.map((row) => row.kind === "category" ? `目录:${row.category.name}` : `文件:${row.template.name}`))
      .toEqual([
        "目录:category-1",
        "目录:category-2",
        "文件:最底层文件",
        "文件:父级文件",
        "文件:根文件",
      ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(rows[1]).toMatchObject({ kind: "category", hasChildren: true });
  });

  it("keeps files hidden until their parent folder is expanded", () => {
    const rows = buildTemplateTreeRows(
      [category(1)],
      [template(11, "快速数论变换", 1)],
      new Set(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "category", hasChildren: true, expanded: false });
  });
});

function category(id: number, parentId?: number): TemplateCategory {
  return {
    id,
    name: `category-${id}`,
    parentId,
    sortOrder: id,
    createdAt: "",
    updatedAt: "",
  };
}

function template(id: number, name: string, categoryId?: number): TemplateMetadata {
  return {
    id,
    kind: "snippet",
    name,
    trigger: name,
    aliases: [],
    description: "",
    language: "cpp",
    categoryId,
    favorite: false,
    sortOrder: id,
    useCount: 0,
    createdAt: "",
    updatedAt: "",
  };
}
