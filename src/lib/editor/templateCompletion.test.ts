import { describe, expect, it, vi } from "vitest";

import type { TemplateDetail } from "../types/templates";
import { buildTemplateCompletionResult } from "./templateCompletion";

describe("template editor completion", () => {
  it("keeps matched templates ahead of other completion sources", () => {
    const template: TemplateDetail = {
      id: 7,
      kind: "snippet",
      name: "StoerWagner",
      trigger: "StoerWagner",
      aliases: ["最小割", "mincut"],
      description: "全局最小割",
      language: "cpp",
      favorite: false,
      sortOrder: 0,
      useCount: 0,
      createdAt: "2026-08-22T00:00:00Z",
      updatedAt: "2026-08-22T00:00:00Z",
      code: "int stoer_wagner() { return ${1:n}; }$0",
    };

    const result = buildTemplateCompletionResult(12, [template], vi.fn());

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ from: 12, filter: false });
    expect(result?.options[0]).toMatchObject({
      label: "StoerWagner",
      detail: "模板 · StoerWagner",
      info: "全局最小割\n别名：最小割、mincut",
      boost: 99,
    });
  });
});
