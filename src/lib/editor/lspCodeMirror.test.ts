import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { incrementalChanges, offsetAt, positionAt } from "./lspCodeMirror";

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
