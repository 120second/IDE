import { EditorState } from "@codemirror/state";
import { EditorView, keymap, showTooltip } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { createLspExtensions, incrementalChanges, offsetAt, positionAt, showSignatureTooltip } from "./lspCodeMirror";

function signatureEditor() {
  let state = EditorState.create({ doc: "add(1, 2)", extensions: createLspExtensions({
    templateCompletion: async () => null, completion: async () => null, hover: async () => null,
    definition: () => {}, references: () => {}, signatureHelp: () => {},
  }, true) });
  const view = {
    get state() { return state; },
    dispatch(spec: Parameters<EditorState["update"]>[0]) { state = state.update(spec).state; },
  } as unknown as EditorView;
  showSignatureTooltip(view, { position: 6, text: "add(int a, int b)" });
  return view;
}

describe("parameter popup lifetime", () => {
  it("closes when code changes, including a corrected function call", () => {
    const view = signatureEditor();
    expect(view.state.facet(showTooltip).filter(Boolean)).toHaveLength(1);
    view.dispatch({ changes: { from: 6, to: 7, insert: "3" } });
    expect(view.state.facet(showTooltip).filter(Boolean)).toHaveLength(0);
  });

  it("closes when the cursor moves and can be dismissed with Escape", () => {
    const view = signatureEditor();
    view.dispatch({ selection: { anchor: 9 } });
    expect(view.state.facet(showTooltip).filter(Boolean)).toHaveLength(0);
    showSignatureTooltip(view, { position: 6, text: "add(int a, int b)" });
    const handled = view.state.facet(keymap).flat()
      .filter((binding) => binding.key === "Escape").some((binding) => binding.run?.(view));
    expect(handled).toBe(true);
    expect(view.state.facet(showTooltip).filter(Boolean)).toHaveLength(0);
  });

  it("keeps parameter help during a diagnostic-only update", () => {
    const view = signatureEditor();
    view.dispatch({});
    expect(view.state.facet(showTooltip).filter(Boolean)).toHaveLength(1);
  });
});

describe("CodeMirror LSP incremental conversion", () => {
  it("keeps distant multi-cursor edits as minimal incremental replacements", () => {
    const startState = EditorState.create({ doc: "abcdef" });
    const transaction = startState.update({
      changes: [
        { from: 1, insert: "X" },
        { from: 5, insert: "Y" },
      ],
    });

    expect(incrementalChanges({
      changes: transaction.changes,
      startState,
      state: transaction.state,
    })).toEqual([
      {
        range: {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
        },
        text: "Y",
      },
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
        },
        text: "X",
      },
    ]);
  });

  it("does not copy the text between distant edits into the LSP payload", () => {
    const startState = EditorState.create({ doc: `a${"x".repeat(1_000_000)}z` });
    const transaction = startState.update({
      changes: [
        { from: 1, insert: "L" },
        { from: startState.doc.length - 1, insert: "R" },
      ],
    });

    const changes = incrementalChanges({
      changes: transaction.changes,
      startState,
      state: transaction.state,
    });

    expect(changes.map((change) => change.text).join("")).toHaveLength(2);
  });

  it("uses UTF-16 offsets and clamps invalid server positions", () => {
    const state = EditorState.create({ doc: "你😀a\nnext" });
    expect(positionAt(state, 4)).toEqual({ line: 0, character: 4 });
    expect(offsetAt(state, { line: 99, character: 99 })).toBe(state.doc.length);
  });
});
