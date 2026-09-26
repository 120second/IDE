import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteReaderAnnotations,
  loadReaderAnnotations,
  readerAnnotationStorageKey,
  saveReaderAnnotations,
} from "./readerAnnotations";

describe("reader annotation storage", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("stores normalized annotation strokes per problem", () => {
    saveReaderAnnotations("problem-a", {
      version: 1,
      strokes: [{ tool: "pen", color: "#ff5d6c", width: 4, points: [{ x: 0.2, y: 0.6 }] }],
      updatedAt: 42,
    });

    expect(loadReaderAnnotations("problem-a")).toEqual({
      version: 1,
      strokes: [{ tool: "pen", color: "#ff5d6c", width: 4, points: [{ x: 0.2, y: 0.6 }] }],
      updatedAt: 42,
    });
  });

  it("sanitizes points and can clear one problem without affecting another", () => {
    values.set("lightcp.reader-annotations.v1", JSON.stringify({
      a: { version: 1, strokes: [{ tool: "pen", color: "bad", width: 99, points: [{ x: -1, y: 2 }] }], updatedAt: 1 },
      b: { version: 1, strokes: [], updatedAt: 2 },
    }));

    expect(loadReaderAnnotations("a")?.strokes[0]).toEqual({
      tool: "pen",
      color: "#ff5d6c",
      width: 48,
      points: [{ x: 0, y: 1 }],
    });
    deleteReaderAnnotations("a");
    expect(loadReaderAnnotations("a")).toBeUndefined();
    expect(loadReaderAnnotations("b")).toMatchObject({ version: 1, updatedAt: 2 });
  });

  it("keeps PDF annotations separate and preserves their page number", () => {
    const pdfKey = readerAnnotationStorageKey("problem-a", "pdf");
    saveReaderAnnotations(pdfKey, {
      version: 1,
      strokes: [{ tool: "pen", color: "#60a5fa", width: 3, page: 7, points: [{ x: 0.4, y: 0.2 }] }],
      updatedAt: 7,
    });

    expect(pdfKey).toBe("problem-a::pdf");
    expect(readerAnnotationStorageKey("problem-a", "markdown")).toBe("problem-a");
    expect(loadReaderAnnotations(pdfKey)?.strokes[0]).toMatchObject({ page: 7, color: "#60a5fa" });
    expect(loadReaderAnnotations("problem-a")).toBeUndefined();
  });
});
