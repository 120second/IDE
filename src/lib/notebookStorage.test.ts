import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notebookKey, remapNotebookPaths, readNotebook, writeNotebook, clearNotebookRedirect } from "./notebookStorage";
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
it("preserves notebooks beyond the old eighty-record eviction threshold", async () => {
  for (let i = 0; i < 201; i++)
    writeNotebook("sketch", `document-${i}`, { updatedAt: i });
  expect(await readNotebook("sketch", "document-0")).toEqual({ updatedAt: 0 });
});
it("moves a subtree, including PDF annotations, without moving sibling prefixes", async () => {
  writeNotebook("problem", "D:/Code/Old/A.cpp", { title: "problem" });
  writeNotebook("annotations", "D:/Code/Old/A.cpp::pdf", { strokes: [1] });
  writeNotebook("sketch", "D:/Code/Old2/A.cpp", { strokes: [2] });
  await remapNotebookPaths("D:/Code/Old", "D:/Code/New");
  expect(await readNotebook("problem", "D:/Code/New/A.cpp")).toEqual({ title: "problem" });
  expect(await readNotebook("annotations", "D:/Code/New/A.cpp::pdf")).toEqual({ strokes: [1] });
  expect(await readNotebook("sketch", "D:/Code/Old2/A.cpp")).toEqual({ strokes: [2] });
  writeNotebook("problem", "D:/Code/Old/A.cpp", { title: "late save" });
  expect(await readNotebook("problem", "D:/Code/New/A.cpp")).toEqual({ title: "late save" });
  clearNotebookRedirect("D:/Code/Old");
  expect(notebookKey("D:/Code/Old/A.cpp")).toBe("d:\\code\\old\\a.cpp");
});
it("surfaces storage quota failures instead of reporting success", () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota exceeded"); } });
  expect(() => writeNotebook("problem", "a", {})).toThrow("quota exceeded");
});
