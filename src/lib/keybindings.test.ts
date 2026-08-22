import { describe, expect, it } from "vitest";

import {
  DEFAULT_KEYBINDINGS,
  matchesShortcut,
  normalizeKeybindings,
  shortcutConflicts,
  shortcutFromEvent,
} from "./keybindings";

function keyEvent(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe("centralized keybindings", () => {
  it("maps F5 and F6 without accepting extra modifiers", () => {
    expect(matchesShortcut(keyEvent("F5"), "runCurrent")).toBe(true);
    expect(matchesShortcut(keyEvent("F6"), "runAll")).toBe(true);
    expect(matchesShortcut(keyEvent("F5", { ctrlKey: true }), "runCurrent")).toBe(false);
  });

  it("maps the template quick search chord", () => {
    expect(matchesShortcut(keyEvent("T", { ctrlKey: true, altKey: true }), "quickTemplate")).toBe(true);
  });

  it("maps the quick archive chord", () => {
    expect(matchesShortcut(keyEvent("A", { ctrlKey: true, shiftKey: true }), "quickArchive")).toBe(true);
    expect(matchesShortcut(keyEvent("A", { ctrlKey: true }), "quickArchive")).toBe(false);
  });

  it("maps workspace search without conflicting with editor search", () => {
    expect(matchesShortcut(keyEvent("F", { ctrlKey: true, shiftKey: true }), "searchWorkspace")).toBe(true);
    expect(matchesShortcut(keyEvent("F", { ctrlKey: true }), "searchWorkspace")).toBe(false);
  });

  it("maps the new file shortcut", () => {
    expect(matchesShortcut(keyEvent("N", { ctrlKey: true }), "newFile")).toBe(true);
  });

  it("maps quick file open", () => {
    expect(matchesShortcut(keyEvent("P", { ctrlKey: true }), "quickOpen")).toBe(true);
  });

  it("maps the command palette", () => {
    expect(matchesShortcut(keyEvent("p", { ctrlKey: true, shiftKey: true }), "commandPalette")).toBe(true);
  });

  it("maps editor close and navigation shortcuts", () => {
    expect(matchesShortcut(keyEvent("w", { ctrlKey: true }), "closeEditor")).toBe(true);
    expect(matchesShortcut(keyEvent("Tab", { ctrlKey: true }), "nextEditor")).toBe(true);
    expect(matchesShortcut(keyEvent("Tab", { ctrlKey: true, shiftKey: true }), "previousEditor")).toBe(true);
  });

  it("maps the Batch 11 stress and debug shortcuts", () => {
    expect(matchesShortcut(keyEvent("F7"), "stress")).toBe(true);
    expect(matchesShortcut(keyEvent("F8"), "debug")).toBe(true);
  });

  it("uses a customized binding and reports conflicts", () => {
    const bindings = { ...DEFAULT_KEYBINDINGS, runCurrent: "Ctrl+R", runAll: "Ctrl+R" };
    expect(matchesShortcut(keyEvent("r", { ctrlKey: true }), "runCurrent", bindings)).toBe(true);
    expect(shortcutConflicts(bindings).get("runCurrent")).toEqual(["runAll"]);
  });

  it("normalizes persisted and captured shortcuts", () => {
    expect(normalizeKeybindings({ save: "control+shift+s" }).save).toBe("Ctrl+Shift+S");
    expect(normalizeKeybindings({ save: "invalid" }).save).toBe("Ctrl+S");
    expect(shortcutFromEvent(keyEvent("F8"))).toBe("F8");
    expect(shortcutFromEvent(keyEvent("r", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+R");
  });
});
