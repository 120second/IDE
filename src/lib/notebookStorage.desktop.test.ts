import { afterEach, beforeEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: backend.invoke, isTauri: () => true }));
beforeEach(() => {
  vi.resetModules();
  backend.invoke.mockReset();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ "D:/Code/A.cpp": { kind: "pdf", pdfName: "A.pdf" } }) });
});
afterEach(() => vi.unstubAllGlobals());
it("imports legacy records once and preserves the original PDF blob key", async () => {
  backend.invoke.mockImplementation(async (command: string) => command === "read_notebook" ? null : undefined);
  const storage = await import("./notebookStorage");
  await storage.readNotebook("problem", "D:/Code/A.cpp");
  await storage.readNotebook("problem", "D:/Code/B.cpp");
  const migrations = backend.invoke.mock.calls.filter(([command]) => command === "import_notebooks");
  expect(migrations).toHaveLength(1);
  expect(migrations[0][1].records[0]).toEqual({ sourcePath: "d:\\code\\a.cpp", content: JSON.stringify({ kind: "pdf", pdfName: "A.pdf", pdfStorageKey: "D:/Code/A.cpp" }) });
});
it("blocks closing on failed writes and retries the newest snapshot", async () => {
  let fail = true;
  const persisted: string[] = [];
  backend.invoke.mockImplementation(async (command: string, args: {
    content: string;
  }) => {
    if (command !== "write_notebook")
      return;
    if (fail)
      throw new Error("disk full");
    persisted.push(args.content);
  });
  const error = vi.fn();
  window.addEventListener("notebook-storage-error", error);
  const storage = await import("./notebookStorage");
  storage.writeNotebook("sketch", "A", { strokes: [1] });
  storage.writeNotebook("sketch", "A", { strokes: [1, 2] });
  await expect(storage.flushNotebookWrites()).rejects.toThrow("尚未保存成功");
  expect(error).toHaveBeenCalled();
  fail = false;
  await storage.flushNotebookWrites();
  expect(persisted).toEqual([JSON.stringify({ strokes: [1, 2] })]);
});
