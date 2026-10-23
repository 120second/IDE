import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  compareTestcaseOutput: vi.fn(), compileCurrentFile: vi.fn(), createTestcase: vi.fn(),
  deleteTestcase: vi.fn(), duplicateTestcase: vi.fn(), listTestcases: vi.fn(),
  moveTestcase: vi.fn(), runProgram: vi.fn(), stopProgram: vi.fn(), stopCompilation: vi.fn(), updateTestcase: vi.fn(),
}));
const lspApi = vi.hoisted(() => ({
  cancelLspRequest: vi.fn(), lspCompletion: vi.fn(), lspDefinition: vi.fn(), lspDidChange: vi.fn(),
  lspDidClose: vi.fn(), lspDidOpen: vi.fn(), lspDidSave: vi.fn(), lspHover: vi.fn(),
  lspReferences: vi.fn(), lspSignatureHelp: vi.fn(), startClangd: vi.fn(), stopClangd: vi.fn(),
}));
vi.mock("../api/execution", () => api);
vi.mock("../api/lsp", () => lspApi);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { ExecutionStore } from "./execution.svelte";
import { LspStore } from "./lsp.svelte";

const path = "D:\\Code\\main.cpp";
const compiled = { success: true, executablePath: "D:\\build\\main.exe", stdout: "", stderr: "", exitCode: 0, durationMs: 1, outputTruncated: false };
const testcase = { id: 1, sourcePath: path, kind: "sample", name: "sample", input: "", expectedOutput: "1", enabled: true, sortOrder: 0, createdAt: "", updatedAt: "" } as const;
const run = { clientRunId: "test", status: "exited", stdout: "1", stderr: "", exitCode: 0, durationMs: 1, outputTruncated: false };
const disposable: { dispose(): void }[] = [];
function execution(onCompileResult?: (path: string, result: any, snapshot?: any) => void) {
  const editor = { activeTab: { path, dirty: false }, saveActive: vi.fn().mockResolvedValue(true), notice: "", sourceSnapshot: () => ({ text: "int main() { return 0; }", revision: 20, dirty: false }) };
  const settings = { value: { compilerPath: "g++", compilerStandard: "c++20", releaseArgs: ["-O2"], debugArgs: ["-g"], runTimeoutMs: 2000, maxOutputBytes: 65536 } };
  const store = new ExecutionStore(editor as never, settings as never, { showBottomPanel: vi.fn() } as never, onCompileResult);
  disposable.push(store);
  return store;
}
function lsp() {
  const editor = { tabs: [{ path, dirty: false, savedRevision: 20 }], sourceSnapshot: vi.fn(() => ({ text: "int main() { return 0; }", revision: 20, dirty: false })), setLspClient: vi.fn(), setLspDiagnostics: vi.fn() };
  const store = new LspStore(editor as never, {} as never);
  store.state = "ready";
  store.didOpen(path, "int main() { return 0; }");
  disposable.push(store);
  return store;
}
function publish(store: LspStore, message: string | null, version?: number, sessionId?: string) {
  (store as any).handleEvent({ type: "diagnostics", path, version, sessionId, diagnostics: message ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, source: "clangd", code: "undeclared_var_use", message }] : [] });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  api.compileCurrentFile.mockResolvedValue({ ...compiled });
  api.runProgram.mockResolvedValue({ ...run });
  api.compareTestcaseOutput.mockResolvedValue(true);
  api.listTestcases.mockResolvedValue([testcase]);
});
afterEach(() => { disposable.splice(0).forEach((store) => store.dispose()); vi.useRealTimers(); });

it("an old successful compile cannot clear errors for newer saved content", async () => {
  const store = lsp();
  let finishCompile!: (value: typeof compiled) => void;
  api.compileCurrentFile.mockImplementationOnce(() => new Promise((resolve) => { finishCompile = resolve; }));
  const executionStore = execution((path, result, snapshot) => store.acceptCompileResult(path, result, snapshot));
  const pending = executionStore.compileCurrent();
  await vi.advanceTimersByTimeAsync(0);
  store.didChange(path, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "missing;" }]);
  (store as any).editor.sourceSnapshot.mockReturnValue({ text: "missing;int main() { return 0; }", revision: 21, dirty: false });
  publish(store, "newly saved code has an undeclared identifier", 2);
  expect(store.errorCount).toBe(1);
  finishCompile(compiled);
  await pending;
  expect(store.errorCount).toBe(1);
});

it("never launches an executable after the editor changes while compilation is pending", async () => {
  const store = execution();
  let finish!: (result: typeof compiled) => void;
  api.compileCurrentFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = store.runCurrent();
  await vi.advanceTimersByTimeAsync(0);
  (store as any).editor.sourceSnapshot = () => ({ text: "int main(){return missing;}", revision: 21, dirty: true });
  finish(compiled);
  await pending;
  expect(api.runProgram).not.toHaveBeenCalled();
  expect(store.compileResult).toBeUndefined();
  expect(store.error).toContain("已过期");
});

it("never launches a build whose disk source changed even if the editor has not reloaded yet", async () => {
  api.compileCurrentFile.mockResolvedValueOnce({ ...compiled, success: false, sourceChanged: true });
  const store = execution();
  await store.runCurrent();
  expect(api.runProgram).not.toHaveBeenCalled();
  expect(store.error).toContain("已过期");
});
it("reopening rejects diagnostics from the previous document incarnation", () => {
  const store = lsp();
  store.didClose(path);
  store.didOpen(path, "int main() { return missing; }");
  publish(store, "missing", 2);
  expect(store.errorCount).toBe(1);
  publish(store, null, 1);
  expect(store.errorCount).toBe(1);
});
it("unversioned stale diagnostics are ignored after an edit", () => {
  const store = lsp();
  store.didChange(path, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }]);
  publish(store, "current error", 2);
  publish(store, null);
  expect(store.errorCount).toBe(1);
});
it("failed program startup completes the testcase with Error", async () => {
  api.runProgram.mockRejectedValue(new Error("executable is unavailable"));
  const store = execution();
  await store.runOne(testcase);
  expect(store.running).toBe(false);
  expect(store.results[0].status).toBe("Error");
});
it("cancelling during compilation is classified as Stopped", async () => {
  let reject!: (error: Error) => void;
  api.compileCurrentFile.mockImplementation(() => new Promise((_resolve, rejectResult) => { reject = rejectResult; }));
  const store = execution();
  const pending = store.runOne(testcase);
  await vi.advanceTimersByTimeAsync(0);
  await store.stop();
  reject(new Error("process cancelled"));
  await pending;
  expect(store.results[0].status).toBe("Stopped");
});
it("truncated output is OLE and is never compared as AC", async () => {
  api.runProgram.mockResolvedValue({ ...run, outputTruncated: true });
  const store = execution();
  await store.runOne(testcase);
  expect(store.results[0].status).toBe("OLE");
  expect(api.compareTestcaseOutput).not.toHaveBeenCalled();
});
it("a new compile is blocked while runAll is still comparing its result", async () => {
  let finishCompare!: (value: boolean) => void;
  api.compareTestcaseOutput.mockImplementation(() => new Promise<boolean>((resolve) => { finishCompare = resolve; }));
  const store = execution();
  const pending = store.runAll();
  await vi.advanceTimersByTimeAsync(0);
  expect(store.running).toBe(false);
  expect(store.compiling).toBe(false);
  await store.compileCurrent();
  expect(api.compileCurrentFile).toHaveBeenCalledTimes(1);
  expect(store.busy).toBe(true);
  finishCompare(true);
  await pending;
});
it("compileResult discards the previous success after compiler startup fails", async () => {
  const store = execution();
  await store.compileCurrent();
  api.compileCurrentFile.mockRejectedValueOnce(new Error("compiler not found"));
  await store.compileCurrent();
  expect(store.error).toContain("compiler not found");
  expect(store.compileResult).toBeUndefined();
});

it("keeps linker diagnostics when clangd reports no syntax errors and invalidates them on edits while offline", async () => {
  const store = lsp();
  const snapshot = (store as any).editor.sourceSnapshot();
  store.acceptCompileResult(path, { ...compiled, success: false, diagnostics: [{ path, severity: 1, source: "链接器", code: "build_failed", fileLevel: true, message: "undefined reference", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }] }, snapshot);
  publish(store, null, 1);
  expect(store.errorCount).toBe(1);
  expect(store.isChecked(path)).toBe(true);
  store.state = "unavailable";
  store.didChange(path, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(store.errorCount).toBe(0);
});

it("does not accept publications from a previous clangd session", () => {
  const store = lsp();
  (store as any).activeSessionId = "current";
  publish(store, "current error", 1, "current");
  publish(store, null, 1, "previous");
  expect(store.errorCount).toBe(1);
});

it("marks edits pending and performs only one automatic resynchronization without claiming success", async () => {
  const store = lsp();
  (store as any).editor.openLspDocuments = () => [{ path, text: "int main() { return 0; }" }];
  expect(store.isChecked(path)).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  await vi.advanceTimersByTimeAsync(15000);
  expect(lspApi.lspDidOpen).toHaveBeenCalledTimes(2);
  expect(store.isChecked(path)).toBe(false);
  expect(store.checkStatus(path)).toContain("检查未完成");
  publish(store, null, 2);
  expect(store.isChecked(path)).toBe(true);
});

it("allows one new resynchronization after a later edit without an endless retry loop", async () => {
  const store = lsp();
  (store as any).editor.openLspDocuments = () => [{ path, text: "int main(){}" }];
  await vi.advanceTimersByTimeAsync(15000);
  expect(lspApi.lspDidOpen).toHaveBeenCalledTimes(2);
  store.didChange(path, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }]);
  await vi.advanceTimersByTimeAsync(15000);
  expect(lspApi.lspDidOpen).toHaveBeenCalledTimes(3);
  expect(store.isChecked(path)).toBe(false);
});

it("retains useful toolchain details while distinguishing cancellation from failures", async () => {
  api.compileCurrentFile.mockRejectedValueOnce({ code: "PROCESS_START_FAILED", userMessage: "无法启动", technicalMessage: "Win32 error 193: bad executable format" });
  const store = execution();
  await store.runOne(testcase);
  expect(store.error).toContain("Win32 error 193");
  expect(store.results[0].status).toBe("Error");
  expect(store.buildDetails).toContain("g++");
});

it("classifies an internal compiler crash as a toolchain failure, not a source-code CE", async () => {
  api.compileCurrentFile.mockResolvedValueOnce({ ...compiled, success: false, executablePath: undefined, diagnostics: [{ path, fileLevel: true, source: "工具链", severity: 1, message: "internal compiler error: Illegal instruction", code: "compiler_internal_error", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }] });
  const store = execution();
  await store.runOne(testcase);
  expect(store.results[0].status).toBe("Error");
  expect(api.runProgram).not.toHaveBeenCalled();
});

it("a clangd recheck must preserve independent linker errors", () => {
  const store = lsp();
  (store as any).editor.openLspDocuments = () => [{ path, text: "int main() { return 0; }" }];
  const diagnostic = { path, severity: 1, source: "链接器", code: "build_failed", fileLevel: true, message: "undefined reference", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
  store.acceptCompileResult(path, { ...compiled, success: false, diagnostics: [diagnostic] }, (store as any).editor.sourceSnapshot());
  store.recheck(path);
  publish(store, null, 2);
  expect(store.diagnostics).toContainEqual(diagnostic);
});

it("does not count the same compiler and clangd error twice", () => {
  const store = lsp();
  publish(store, "Use of undeclared identifier 'missing'", 1);
  store.acceptCompileResult(path, { ...compiled, success: false, diagnostics: [{ path, severity: 1, source: "编译器", code: "", fileLevel: false, message: "'missing' was not declared in this scope", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } } }] }, (store as any).editor.sourceSnapshot());
  expect(store.errorCount).toBe(1);
  expect(store.diagnostics[0].source).toBe("编译器");
});

it("immediately invalidates live diagnostics when compilation flags change", () => {
  const store = lsp();
  (store as any).editor.clearLspDiagnostics = vi.fn();
  publish(store, "wrong standard", 1);
  store.configure("D:\\Code", "", "g++", "c++23", []);
  expect(store.ready).toBe(false);
  expect(store.errorCount).toBe(0);
  publish(store, "old configuration", 1);
  expect(store.errorCount).toBe(0);
});

it("does not publish an old toolchain failure after its configuration was corrected", async () => {
  const onCompile = vi.fn();
  const store = execution(onCompile);
  let reject!: (error: Error) => void;
  api.compileCurrentFile.mockImplementationOnce(() => new Promise((_resolve, rejectResult) => { reject = rejectResult; }));
  const pending = store.compileCurrent();
  await vi.advanceTimersByTimeAsync(0);
  (store as any).settings.value.compilerPath = "C:\\fixed\\g++.exe";
  reject(new Error("old compiler not found"));
  await pending;
  expect(onCompile).not.toHaveBeenCalled();
  expect(store.error).toContain("配置已更改");
});

it("restores a live marker when its overlapping compiler marker becomes invalid", async () => {
  const store = lsp();
  const editor = (store as any).editor;
  editor.clearCompileDiagnostics = vi.fn();
  editor.openLspDocuments = () => [];
  publish(store, "undeclared", 1);
  const diagnostic = { path, severity: 1, source: "编译器", code: "", message: "was not declared", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
  store.acceptCompileResult(path, { ...compiled, success: false, diagnostics: [diagnostic] }, { ...editor.sourceSnapshot(), documents: [{ path, revision: 20 }, { path: "D:\\Code\\other.cpp", revision: 20 }] });
  store.didChange("D:\\Code\\other.cpp", [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(store.errorCount).toBe(1);
  expect(editor.setLspDiagnostics).toHaveBeenLastCalledWith(path, store.diagnosticsFor(path));
  expect(store.diagnosticsFor(path)[0].source).toBe("clangd");
});
