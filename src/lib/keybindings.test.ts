import { describe, expect, it } from "vitest";

import { matchesShortcut } from "./keybindings";

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
});
