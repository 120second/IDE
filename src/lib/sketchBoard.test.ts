import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSketchDocument, saveSketchDocument, sketchDocumentKey } from "./sketchBoard";

describe("sketch board storage", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses one drawing per source file", () => {
    expect(sketchDocumentKey("D:/Code/A.cpp")).toBe(sketchDocumentKey("d:\\code\\a.cpp"));
    expect(sketchDocumentKey()).toBe("__scratch__");
  });

  it("stores resizable vector strokes", () => {
    saveSketchDocument("problem", {
      version: 2,
      canvasWidth: 820,
      canvasHeight: 560,
      strokes: [{ tool: "pen", color: "#ffffff", width: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
      updatedAt: 42,
    });
    expect(loadSketchDocument("problem")).toEqual({
      version: 2,
      canvasWidth: 820,
      canvasHeight: 560,
      strokes: [{ tool: "pen", color: "#ffffff", width: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
      updatedAt: 42,
    });
  });

  it("migrates legacy window-sized drawings to a canvas-sized document", () => {
    values.set("lightcp.sketch-board.v1", JSON.stringify({
      problem: {
        version: 1,
        width: 720,
        height: 520,
        strokes: [{ tool: "pen", color: "#52c7b2", width: 3, points: [{ x: 10, y: 20 }] }],
        updatedAt: 12,
      },
    }));

    expect(loadSketchDocument("problem")).toMatchObject({
      version: 2,
      canvasWidth: 720,
      canvasHeight: 444,
      updatedAt: 12,
    });
  });
});
