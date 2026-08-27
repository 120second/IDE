import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import type { TemplateDetail } from "../types/templates";
import {
  buildTemplateCompletionResult,
  templateReferenceCode,
} from "./templateCompletion";

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

describe("template editor completion", () => {
  it("keeps matched templates ahead of other completion sources", () => {
    const result = buildTemplateCompletionResult(
      12,
      [template],
      vi.fn(),
      () => false,
      vi.fn(),
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ from: 12, filter: false });
    expect(result?.options[0]).toMatchObject({
      label: "StoerWagner",
      detail: "模板 · StoerWagner",
      info: "全局最小割\n别名：最小割、mincut",
      boost: 99,
    });
  });

  it("previews on the first confirmation and inserts on the second", () => {
    let state = EditorState.create({
      doc: "StoerWagner",
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const editor = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
      focus: vi.fn(),
    };
    const preview = vi.fn();
    const picked = vi.fn();
    let previewOpen = false;
    preview.mockImplementation(() => { previewOpen = true; });
    const result = buildTemplateCompletionResult(
      0,
      [template],
      preview,
      () => previewOpen,
      picked,
    );
    const apply = result?.options[0].apply;

    expect(typeof apply).toBe("function");
    if (typeof apply !== "function") return;
    apply(editor as never, result!.options[0], 0, state.doc.length);
    expect(state.doc.toString()).toBe("StoerWagner");
    expect(preview).toHaveBeenCalledWith(template, 0, "StoerWagner".length);
    expect(picked).not.toHaveBeenCalled();

    apply(editor as never, result!.options[0], 0, state.doc.length);
    expect(state.doc.toString()).toBe("int stoer_wagner() { return n; }");
    expect(picked).toHaveBeenCalledWith(template.id);
  });

  it("shows readable code without snippet cursor markers", () => {
    expect(templateReferenceCode(template.code)).toBe("int stoer_wagner() { return n; }");
  });
});
