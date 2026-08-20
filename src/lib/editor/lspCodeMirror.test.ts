import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { incrementalChange, offsetAt, positionAt } from "./lspCodeMirror";

describe("CodeMirror LSP incremental conversion", () => {
  it("merges a multi-cursor transaction into one minimal LSP replacement", () => {
    const startState = EditorState.create({ doc: "abcdef" });
    const transaction = startState.update({
      changes: [
        { from: 1, insert: "X" },
        { from: 5, insert: "Y" },
      ],
    });

    expect(incrementalChange({
      changes: transaction.changes,
      startState,
      state: transaction.state,
    })).toEqual({
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 5 },
      },
      text: "XbcdeY",
    });
  });

  it("uses UTF-16 offsets and clamps invalid server positions", () => {
    const state = EditorState.create({ doc: "你😀a\nnext" });
    expect(positionAt(state, 4)).toEqual({ line: 0, character: 4 });
    expect(offsetAt(state, { line: 99, character: 99 })).toBe(state.doc.length);
  });
});

