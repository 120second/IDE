import { hasNextSnippetField, nextSnippetField, snippet } from "@codemirror/autocomplete";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { normalizeSnippetTemplate } from "./snippets";

function applySnippet(template: string) {
  let state = EditorState.create({
    doc: "",
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  const editor = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  };

  snippet(normalizeSnippetTemplate(template))(editor, null, 0, 0);
  return {
    editor,
    state: () => state,
    selectedText: () =>
      state.sliceDoc(state.selection.main.from, state.selection.main.to),
  };
}

describe("snippet placeholders", () => {
  it("normalizes the LightCP $0 cursor stop", () => {
    expect(normalizeSnippetTemplate("before $0 after")).toBe(
      "before ${0} after",
    );
  });

  it("inserts clean code and visits numbered placeholders in order", () => {
    const applied = applySnippet(
      "for (int ${1:name} = ${2:value}; ${1:name} < n; ++${1:name}) {\n  $0\n}",
    );

    expect(applied.state().doc.toString()).toBe(
      "for (int name = value; name < n; ++name) {\n  \n}",
    );
    expect(applied.selectedText()).toBe("name");
    expect(applied.state().selection.ranges).toHaveLength(3);
    expect(hasNextSnippetField(applied.state())).toBe(true);

    expect(nextSnippetField(applied.editor)).toBe(true);
    expect(applied.selectedText()).toBe("value");

    expect(nextSnippetField(applied.editor)).toBe(true);
    expect(applied.selectedText()).toBe("");
    expect(hasNextSnippetField(applied.state())).toBe(false);
  });
});
