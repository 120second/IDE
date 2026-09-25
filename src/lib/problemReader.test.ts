import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadProblemDocument,
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
