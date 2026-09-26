import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compactProblemSample,
  loadProblemDocument,
  problemSampleContext,
  problemDocumentKey,
  saveProblemDocument,
  titleFromMarkdown,
} from "./problemReader";

describe("problem reader metadata", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses a stable key for Windows and slash-separated source paths", () => {
    expect(problemDocumentKey("D:/Code/A.cpp")).toBe(problemDocumentKey("d:\\code\\a.cpp"));
    expect(problemDocumentKey()).toBe("__scratch__");
  });

  it("extracts a readable title from the first level-one heading", () => {
    expect(titleFromMarkdown("intro\n# **Water the Trees**\nbody", "Fallback")).toBe("Water the Trees");
    expect(titleFromMarkdown("No heading", "Fallback")).toBe("Fallback");
  });

  it("recognizes common input and output sample labels", () => {
    expect(problemSampleContext("Input")).toEqual({ kind: "input", id: undefined });
    expect(problemSampleContext("输入 #2")).toEqual({ kind: "input", id: "2" });
    expect(problemSampleContext("Sample Output 3")).toEqual({ kind: "output", id: "3" });
    expect(problemSampleContext("Input format")).toBeUndefined();
  });

  it("removes blank spacer lines from problem samples", () => {
    expect(compactProblemSample("\n5\n\n3 1\n  \n2 3 5\n\n")).toBe("5\n3 1\n2 3 5\n");
  });

  it("stores Markdown metadata locally", () => {
    saveProblemDocument("problem", {
      kind: "markdown",
      title: "A + B",
      markdown: "# A + B",
      updatedAt: 42,
    });
    expect(loadProblemDocument("problem")).toEqual({
      kind: "markdown",
      title: "A + B",
      markdown: "# A + B",
      pdfName: undefined,
      updatedAt: 42,
    });
  });

  it("keeps Markdown and PDF references together so formats remain switchable", () => {
    saveProblemDocument("problem", {
      kind: "pdf",
      title: "Official statement",
      markdown: "# Local translation\n\nLet $n$ be an integer.",
      pdfName: "statement.pdf",
      updatedAt: 43,
    });

    expect(loadProblemDocument("problem")).toMatchObject({
      kind: "pdf",
      markdown: "# Local translation\n\nLet $n$ be an integer.",
      pdfName: "statement.pdf",
    });
  });
});
