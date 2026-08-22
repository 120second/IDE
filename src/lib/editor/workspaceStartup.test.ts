import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { DEFAULT_SETTINGS } from "../stores/settings.svelte";
import { EditorWorkspace } from "./workspace.svelte";

describe("editor startup state", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("starts without files and stays empty after the final tab closes", () => {
    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);

    expect(workspace.tabs).toEqual([]);
    expect(workspace.activeId).toBe("");

    workspace.createTab();
    expect(workspace.tabs).toHaveLength(1);

    workspace.closeTab(workspace.tabs[0].id);
    expect(workspace.tabs).toEqual([]);
    expect(workspace.activeId).toBe("");
  });

  it.each([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["'", "'"],
    ['"', '"'],
  ])("automatically closes %s with %s", (opening, closing) => {
    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    workspace.createTab();

    let state = workspace.activeTab!.state;
    const view = {
      get state() {
        return state;
      },
      compositionStarted: false,
      composing: false,
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    } as unknown as EditorView;
    const position = state.selection.main.head;
    const handled = state.facet(EditorView.inputHandler).some((handler) =>
      handler(
        view,
        position,
        position,
        opening,
        () => state.update({ changes: { from: position, insert: opening } }),
      ));

    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe(opening + closing);
    expect(state.selection.main.head).toBe(opening.length);
  });

  it("moves over an automatically inserted closing bracket", () => {
    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    workspace.createTab();

    let state = workspace.activeTab!.state;
    const view = {
      get state() {
        return state;
      },
      compositionStarted: false,
      composing: false,
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    } as unknown as EditorView;
    const type = (text: string): boolean => {
      const position = state.selection.main.head;
      return state.facet(EditorView.inputHandler).some((handler) =>
        handler(
          view,
          position,
          position,
          text,
          () => state.update({ changes: { from: position, insert: text } }),
        ));
    };

    expect(type("(")).toBe(true);
    expect(type(")")).toBe(true);
    expect(state.doc.toString()).toBe("()");
    expect(state.selection.main.head).toBe(2);
  });

  it("deletes an empty bracket pair with one Backspace", () => {
    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    workspace.createTab();

    let state = workspace.activeTab!.state;
    const view = {
      get state() {
        return state;
      },
      compositionStarted: false,
      composing: false,
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    } as unknown as EditorView;
    const position = state.selection.main.head;
    const handled = state.facet(EditorView.inputHandler).some((handler) =>
      handler(
        view,
        position,
        position,
        "[",
        () => state.update({ changes: { from: position, insert: "[" } }),
      ));
    const backspace = state.facet(keymap)
      .flat()
      .find((binding) => binding.key === "Backspace");

    expect(handled).toBe(true);
    expect(backspace?.run?.(view)).toBe(true);
    expect(state.doc.toString()).toBe("");
    expect(state.selection.main.head).toBe(0);
  });
});
