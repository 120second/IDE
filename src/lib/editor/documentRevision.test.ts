import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { documentRevision, documentRevisionExtension } from "./documentRevision";

describe("document revision checkpoint", () => {
  it("restores revisions through undo and redo", () => {
    let state = EditorState.create({ extensions: [history(), documentRevisionExtension] });
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    };

    const initialRevision = documentRevision(state);
    state = state.update({
      changes: { from: 0, insert: "saved" },
      annotations: isolateHistory.of("after"),
      userEvent: "input.type",
    }).state;
    const savedRevision = documentRevision(state);
    state = state.update({
      changes: { from: state.doc.length, insert: " newer" },
      userEvent: "input.type",
    }).state;

    expect(documentRevision(state)).not.toBe(savedRevision);
    expect(undo(view)).toBe(true);
    expect(state.doc.toString()).toBe("saved");
    expect(documentRevision(state)).toBe(savedRevision);

    expect(undo(view)).toBe(true);
    expect(state.doc.toString()).toBe("");
    expect(documentRevision(state)).toBe(initialRevision);

    expect(redo(view)).toBe(true);
    expect(state.doc.toString()).toBe("saved");
    expect(documentRevision(state)).toBe(savedRevision);
  });
});
