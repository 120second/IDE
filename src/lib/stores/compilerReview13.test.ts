// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
const api = vi.hoisted(() => ({ compileCurrentFile: vi.fn(), runProgram: vi.fn(), stopProgram: vi.fn(), stopCompilation: vi.fn() }));
const workspaceApi = vi.hoisted(() => ({ readTextFile: vi.fn(), getTextFileRevision: vi.fn() }));
vi.mock("../api/execution", () => api);
vi.mock("../api/workspace", () => workspaceApi);
vi.mock("../api/lsp", () => ({ lspDidOpen: vi.fn(async () => {}), lspDidChange: vi.fn(async () => {}), lspDidClose: vi.fn(async () => {}), stopClangd: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
import { EditorWorkspace } from "../editor/workspace.svelte";
import { LspStore } from "./lsp.svelte";
import { ExecutionStore } from "./execution.svelte";
import { DEFAULT_SETTINGS } from "./settings.svelte";
const source = "D:\\Code\\main.cpp", header = "D:\\Code\\value.h";
const cleanup: (() => void)[] = [];
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); document.body.replaceChildren(); });
const error = { path: source, severity: 1, message: "missing_name", source: "编译器", code: "", fileLevel: false, range: { start: { line: 0, character: 18 }, end: { line: 0, character: 30 } } };
const failed = { success: false, dependencies: [{ path: source }, { path: header }], dependenciesComplete: true, diagnostics: [error], stdout: "", stderr: "", durationMs: 1, outputTruncated: false };

it.each(["lightcp", "classic", "sublime"] as const)("editing a paused large document clears obsolete build errors in %s", async (interfaceStyle) => {
  const editor = new EditorWorkspace({ ...DEFAULT_SETTINGS, interfaceStyle });
  const store = new LspStore(editor, {} as never); store.state = "ready";
  cleanup.push(() => { store.dispose(); editor.dispose(); });
  const text = "\n".repeat(99999) + "int main(){return missing_name;}";
  workspaceApi.readTextFile.mockResolvedValue({ path: source, content: text, revision: "disk" });
  await editor.openFile(source);
  const host = document.createElement("div"); document.body.appendChild(host); editor.attach(host);
  const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
  const position = view.state.doc.toString().indexOf("missing_name");
  const diagnostic = { ...error, range: { start: { line: 99999, character: 18 }, end: { line: 99999, character: 30 } } };
  store.acceptCompileResult(source, { ...failed, diagnostics: [diagnostic] }, editor.sourceSnapshot(source));
  expect(store.errorCount).toBe(1);
  expect(editor.openLspDocuments()).toEqual([]);
  view.dispatch({ changes: { from: position, to: position+12, insert: "0" } });
  await Promise.resolve(); await Promise.resolve();
  expect(editor.sourceSnapshot(source)!.text).not.toContain("missing_name");
  expect(store.errorCount).toBe(0);
});

it.each(["changed", "deleted", "created", "renamed"] as const)("an external %s event for a closed dependency clears stale build errors", async (kind) => {
  const editor = new EditorWorkspace(DEFAULT_SETTINGS);
  const store = new LspStore(editor, {} as never); store.state = "ready";
  cleanup.push(() => { store.dispose(); editor.dispose(); });
  workspaceApi.readTextFile.mockResolvedValue({ path: source, content: '#include "value.h"\nint main(){}', revision: "disk" });
  await editor.openFile(source);
  store.acceptCompileResult(source, failed, editor.sourceSnapshot(source));
  (store as any).handleEvent({ type: "diagnostics", path: source, version: 1, diagnostics: [] });
  expect(store.isChecked(source)).toBe(true);
  await editor.handleExternalChange({ kind, paths: kind === "renamed" ? [header, "D:\\Code\\next.h"] : [header] });
  expect(workspaceApi.getTextFileRevision).not.toHaveBeenCalled();
  expect(store.errorCount).toBe(0);
  expect(store.isChecked(source)).toBe(false);
});

it("an unknown dependency scan publishes only an unverified task message and retains raw output", async () => {
  const documents = new Map([[source, { text: '#include "value.h"\nint main(){}', revision: 1, dirty: false }], [header, { text: "#define VALUE 3", revision: 2, dirty: true }]]);
  const editor = { activeTab: { path: source, dirty: false }, tabs: [{ path: source }, { path: header }], sourceSnapshot: (path: string) => documents.get(path), saveActive: vi.fn() };
  const publish = vi.fn();
  const store = new ExecutionStore(editor as never, { value: DEFAULT_SETTINGS } as never, { showBottomPanel: vi.fn() } as never, publish);
  cleanup.push(() => store.dispose());
  const diskFailure = { ...failed, dependencies: [], dependenciesComplete: false, stderr: "#error old_disk_error\n", diagnostics: [{ ...error, path: header, message: "#error old_disk_error" }] };
  api.compileCurrentFile.mockResolvedValue(diskFailure);
  await store.compileCurrent();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][1].diagnostics[0].fileLevel).toBe(true);
  expect(publish.mock.calls[0][1].diagnostics[0].code).toBe("dependencies_unverified");
  await vi.waitFor(() => expect(store.output).toContain("old_disk_error"));
  expect(store.error).toContain("无法完整确认");
});

it("a native rejection of unsupported extra sources never starts a program", async () => {
  const helper = "D:\\Code\\helper.cpp";
  const documents = new Map([
    [source, { text: "int helper(); int main(){return helper();}", revision: 1, dirty: false }],
    [helper, { text: "int helper(){return 9;}", revision: 2, dirty: true }],
  ]);
  const editor = { activeTab: { path: source, dirty: false }, tabs: [{ path: source }, { path: helper }], sourceSnapshot: (path: string) => documents.get(path), saveActive: vi.fn() };
  const publish = vi.fn();
  const store = new ExecutionStore(editor as never, { value: { ...DEFAULT_SETTINGS, releaseArgs: [helper] } } as never, { showBottomPanel: vi.fn() } as never, publish);
  cleanup.push(() => store.dispose());
  api.compileCurrentFile.mockRejectedValue({ code: "CONFIGURATION", userMessage: "当前构建入口仅支持单个 .cpp，不能加入额外源码" });
  api.runProgram.mockResolvedValue({ clientRunId: "observed", status: "exited", stdout: "", stderr: "", exitCode: 3, durationMs: 1, outputTruncated: false });
  await store.runCurrent();
  expect(api.runProgram).not.toHaveBeenCalled();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(documents.get(helper)!.dirty).toBe(true);
  expect(store.error).toContain("单个 .cpp");
});

it("a partial dependency scan still blocks an unsaved known header", async () => {
  const documents = new Map([[source, { text: '#include "value.h"\nint main(){}', revision: 1, dirty: false }], [header, { text: "#define VALUE 3", revision: 2, dirty: true }]]);
  const publish = vi.fn();
  const editor = { activeTab: { path: source, dirty: false }, sourceSnapshot: (path: string) => documents.get(path) };
  const store = new ExecutionStore(editor as never, { value: DEFAULT_SETTINGS } as never, { showBottomPanel: vi.fn() } as never, publish);
  cleanup.push(() => store.dispose());
  api.compileCurrentFile.mockResolvedValue({ ...failed, dependenciesComplete: false });
  await store.runCurrent();
  expect(publish).not.toHaveBeenCalled();
  expect(api.runProgram).not.toHaveBeenCalled();
  expect(store.error).toContain("先保存相关头文件");
});

it.each([true, false])("external file events during a build invalidate only its actual inputs, related=%s", async (related) => {
  const editor = new EditorWorkspace(DEFAULT_SETTINGS);
  const publish = vi.fn();
  const store = new ExecutionStore(editor, { value: DEFAULT_SETTINGS } as never, { showBottomPanel: vi.fn() } as never, publish);
  cleanup.push(() => { store.dispose(); editor.dispose(); });
  workspaceApi.readTextFile.mockResolvedValue({ path: source, content: '#include "value.h"\nint main(){}', revision: "disk" });
  await editor.openFile(source);
  let finish!: (value: unknown) => void;
  api.compileCurrentFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = store.runCurrent();
  await vi.waitFor(() => expect(api.compileCurrentFile).toHaveBeenCalledTimes(1));
  await editor.handleExternalChange({ kind: "changed", paths: [related ? header : "D:\\Code\\unrelated.h"] });
  api.runProgram.mockResolvedValue({ status: "exited", stdout: "", stderr: "", exitCode: 0, durationMs: 1, outputTruncated: false });
  finish({ ...failed, success: true, diagnostics: [], executablePath: "D:\\Code\\build.exe" });
  await pending;
  expect(api.runProgram).toHaveBeenCalledTimes(related ? 0 : 1);
  if (related) expect(store.error).toContain("已过期");
});

it("unrelated file events preserve existing diagnostics and checked state", async () => {
  const editor = new EditorWorkspace(DEFAULT_SETTINGS);
  const store = new LspStore(editor, {} as never); store.state = "ready";
  cleanup.push(() => { store.dispose(); editor.dispose(); });
  workspaceApi.readTextFile.mockResolvedValue({ path: source, content: "int main(){}", revision: "disk" });
  await editor.openFile(source);
  store.acceptCompileResult(source, failed, editor.sourceSnapshot(source));
  (store as any).handleEvent({ type: "diagnostics", path: source, version: 1, diagnostics: [] });
  await editor.handleExternalChange({ kind: "changed", paths: ["D:\\Code\\unrelated.h"] });
  expect(store.errorCount).toBe(1);
  expect(store.isChecked(source)).toBe(true);
});

it("a watcher echo of an already saved revision does not expire a build", async () => {
  const editor = new EditorWorkspace(DEFAULT_SETTINGS);
  const store = new LspStore(editor, {} as never); store.state = "ready";
  cleanup.push(() => { store.dispose(); editor.dispose(); });
  workspaceApi.readTextFile.mockResolvedValue({ path: source, content: "int main(){}", revision: "saved" });
  workspaceApi.getTextFileRevision.mockResolvedValue({ path: source, revision: "saved" });
  await editor.openFile(source);
  store.acceptCompileResult(source, failed, editor.sourceSnapshot(source));
  const version = editor.buildInputVersion();
  await editor.handleExternalChange({ kind: "changed", paths: [source] });
  expect(editor.buildInputsChangedSince(version, [source])).toBe(false);
  expect(store.errorCount).toBe(1);
});
