import { describe, expect, it } from "vitest";
import { buildTemplateCategoryRows } from "./templateTree";
import type { TemplateCategory } from "./types/templates";

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

