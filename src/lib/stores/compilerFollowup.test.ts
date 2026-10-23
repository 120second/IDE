import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ compileCurrentFile: vi.fn(), runProgram: vi.fn(), listTestcases: vi.fn(), stopProgram: vi.fn(), stopCompilation: vi.fn() }));
const lspApi = vi.hoisted(() => ({ lspDidOpen: vi.fn(async () => {}), lspDidChange: vi.fn(async () => {}), lspDidClose: vi.fn(async () => {}), stopClangd: vi.fn(async () => {}) }));
vi.mock("../api/execution", () => api);
vi.mock("../api/lsp", () => lspApi);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
import { buildContentHash } from "../editor/buildInputs";
import { ExecutionStore } from "./execution.svelte";
import { LspStore } from "./lsp.svelte";

const path = "D:\\Code\\main.cpp", unrelated = "D:\\Code\\other.cpp", header = "D:\\Code\\used.h";
const compiled = { dependenciesComplete: true, dependencies: [{ path }, { path: header, contentHash: "" }], success: true, executablePath: "D:\\build\\main.exe", stdout: "", stderr: "", durationMs: 1, outputTruncated: false };
const live: { dispose(): void }[] = [];
function makeEditor() {
  const documents = new Map([[path, { text: '#include "used.h"\nint main(){return value;}', revision: 1, dirty: false }], [unrelated, { text: "int other;", revision: 1, dirty: false }], [header, { text: "int value;", revision: 1, dirty: false }]]);
  const editor = { activeTab: { path, dirty: false }, tabs: [{ path }, { path: unrelated }, { path: header }], sourceSnapshot: (p: string) => documents.get(p), setLspClient: vi.fn(), setLspDiagnostics: vi.fn(), clearLspDiagnostics: vi.fn(), saveActive: vi.fn(async () => true), openLspDocuments: () => [...documents].map(([path, state]) => ({ path, text: state.text })) };
  return { editor, documents };
}
function lsp() {
  const context = makeEditor();
  const store = new LspStore(context.editor as never, {} as never);
  store.state = "ready";
  store.didOpen(path, "int main(){}");
  store.didOpen(header, "int value;");
  live.push(store);
  return { ...context, store };
}
function execution() {
  const context = makeEditor();
  const settings = { value: { compilerPath: "g++", compilerStandard: "c++20", releaseArgs: ["-O2"], debugArgs: ["-g"], runTimeoutMs: 2000, maxOutputBytes: 65536 } };
  const store = new ExecutionStore(context.editor as never, settings as never, { showBottomPanel: vi.fn() } as never);
  live.push(store);
  return { ...context, store };
}
const linker = { path, severity: 1, source: "链接器", code: "link_failed", fileLevel: true, message: "undefined reference to missing", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
beforeEach(async () => { compiled.dependencies[1].contentHash = await buildContentHash("int value;"); vi.useFakeTimers(); vi.clearAllMocks(); api.compileCurrentFile.mockResolvedValue(compiled); api.runProgram.mockResolvedValue({ status: "exited", stdout: "", stderr: "", exitCode: 0, durationMs: 1, outputTruncated: false }); });
afterEach(() => { live.splice(0).forEach(s => s.dispose()); vi.useRealTimers(); });

// Regression coverage for the six issues confirmed in the dev.12 audit.
it("editing an unrelated cpp preserves main's valid compilation", async () => {
  const { store, documents } = execution();
  let finish!: (r: typeof compiled) => void;
  api.compileCurrentFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = store.runCurrent();
  await vi.advanceTimersByTimeAsync(0);
  documents.set(unrelated, { text: "int other=1;", revision: 2, dirty: true });
  finish(compiled); await pending;
  expect(store.error).toBe("");
  expect(api.runProgram).toHaveBeenCalledTimes(1);
});
it("closing an unchanged header preserves an independent linker error", async () => {
  const { store, editor } = lsp();
  await vi.advanceTimersByTimeAsync(0);
  store.acceptCompileResult(path, { ...compiled, success: false, diagnostics: [linker] }, { ...editor.sourceSnapshot(path)!, documents: [{ path, revision: 1 }, { path: header, revision: 1 }] });
  expect(store.errorCount).toBe(1);
  store.didClose(header);
  expect(store.errorCount).toBe(1);
});
it("dirty unrelated headers do not block compiling main", async () => {
  const { store, documents, editor } = execution();
  editor.tabs.push({ path: "D:\\Code\\unrelated.h" });
  documents.set("D:\\Code\\unrelated.h", { text: "int other;", revision: 2, dirty: true });
  await store.compileCurrent();
  expect(api.compileCurrentFile).toHaveBeenCalledTimes(1);
  expect(store.error).toBe("");
});
it("a dependency opened and edited after build starts rejects the old executable", async () => {
  const { store, documents, editor } = execution();
  editor.tabs = [{ path }, { path: unrelated }]; documents.delete(header);
  documents.set(path, { text: '#include "used.h"\nint main(){return value;}', revision: 1, dirty: false });
  let finish!: (r: typeof compiled) => void;
  api.compileCurrentFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = store.runCurrent(); await vi.advanceTimersByTimeAsync(0);
  editor.tabs.push({ path: header }); documents.set(header, { text: "int value=missing;", revision: 2, dirty: true });
  finish(compiled); await pending;
  expect(api.runProgram).not.toHaveBeenCalled();
  expect(store.error).toContain("先保存相关头文件");
});
it("arbitrary text documents are excluded from clangd", async () => {
  const { store } = lsp();
  store.didOpen("D:\\Code\\in.txt", "3 1\n1 0 1\n");
  await vi.advanceTimersByTimeAsync(0);
  expect(lspApi.lspDidOpen).not.toHaveBeenCalledWith("D:\\Code\\in.txt", "3 1\n1 0 1\n", 1);
});

it.each([false, true])("a newly opened dependency changed during compilation is rejected, saved=%s", async (saved) => {
  const { store, documents, editor } = execution();
  editor.tabs = [{ path }]; documents.delete(header);
  let finish!: (r: typeof compiled) => void;
  api.compileCurrentFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = store.runCurrent(); await vi.advanceTimersByTimeAsync(0);
  editor.tabs.push({ path: header }); documents.set(header, { text: "int value=2;", revision: 2, dirty: !saved });
  finish(compiled); await pending;
  expect(api.runProgram).not.toHaveBeenCalled();
  expect(store.error).toMatch(/先保存|已过期/);
});

it.each(["open", "close"])("an unchanged related header may %s during compilation", async (action) => {
  const { store, documents, editor } = execution();
  if (action === "open") { editor.tabs = [{ path }]; documents.delete(header); }
  let finish!: (r: typeof compiled) => void;
  api.compileCurrentFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = store.runCurrent(); await vi.advanceTimersByTimeAsync(0);
  if (action === "open") { editor.tabs.push({ path: header }); documents.set(header, { text: "int value;", revision: 1, dirty: false }); }
  else { editor.tabs = [{ path }]; documents.delete(header); }
  finish(compiled); await pending;
  expect(store.error).toBe("");
  expect(api.runProgram).toHaveBeenCalledTimes(1);
});

it("discarding an edited header invalidates build diagnostics", async () => {
  const { store, editor } = lsp();
  await vi.advanceTimersByTimeAsync(0);
  store.acceptCompileResult(path, { ...compiled, success: false, diagnostics: [linker] }, editor.sourceSnapshot(path));
  expect(store.errorCount).toBe(1);
  store.didClose(header, true);
  expect(store.errorCount).toBe(0);
});
