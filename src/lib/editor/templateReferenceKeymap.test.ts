import { insertNewlineAndIndent } from "@codemirror/commands";
import { describe, expect, it, vi } from "vitest";
import { templateReferencePrimaryKeymap } from "./templateReferenceKeymap";

describe("template reference keymap", () => {
  it("uses Enter for a newline and Shift+Enter for insertion", () => {
    const insertDraft = vi.fn(() => true);
    const bindings = templateReferencePrimaryKeymap(insertDraft);

    expect(bindings.map((binding) => binding.key)).toEqual(["Shift-Enter", "Enter"]);
    expect(bindings[1].run).toBe(insertNewlineAndIndent);
    expect(bindings[0].run?.({} as never)).toBe(true);
    expect(insertDraft).toHaveBeenCalledOnce();
  });
});
