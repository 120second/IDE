import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedProblem } from "../api/problemImport";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type { WorkspaceStore } from "./workspace.svelte";
import type { ShellStore } from "./shell.svelte";
import type { ExecutionStore } from "./execution.svelte";
import type { UxStore } from "./ux.svelte";
import type { TemplateStore } from "./templates.svelte";

const mocks = vi.hoisted(() => ({
  status: vi.fn(), start: vi.fn(), stop: vi.fn(), listen: vi.fn(), flush: vi.fn(), unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../api/problemImport", () => ({ problemListenerStatus: mocks.status, startProblemListener: mocks.start, stopProblemListener: mocks.stop }));
vi.mock("../notebookStorage", () => ({ flushNotebookWrites: mocks.flush }));
import { ProblemImportStore } from "./problemImport.svelte";

const root = "D:\\Code";
const problem: ImportedProblem = { title: "A. Example", sourcePath: `${root}\\A. Example.cpp`, markdownPath: `${root}\\A. Example.md`, sourceUrl: "https://codeforces.com/contest/1234/problem/A", sampleCount: 2, alreadyImported: false };
let onImport: (event: { payload: ImportedProblem }) => void;
function fixture() {
  const editor = { tabs: [] as { path: string; loading: boolean }[], notice: "", openFile: vi.fn(async (path: string) => { editor.tabs.push({ path, loading: false }); }) };
  const files = { info: { path: root } as { path: string } | undefined, refresh: vi.fn().mockResolvedValue(undefined) };
  const shell = { activeActivity: "templates", generatorOpen: true, problemReaderVisible: false, showSublimeTool: vi.fn() };
  const execution = { syncActiveSource: vi.fn().mockResolvedValue(undefined) };
  const ux = { success: vi.fn(), error: vi.fn() };
  const templates = {
    fileTemplates: [{ id: 1, name: "Empty C++" }, { id: 2, name: "Contest C++" }],
    ensureFileTemplates: vi.fn().mockResolvedValue(undefined),
    loadTemplateCode: vi.fn(async (id: number): Promise<{ code: string } | undefined> => ({ code: `// template ${id}` })),
    error: "",
  };
  const store = new ProblemImportStore(editor as unknown as EditorWorkspace, files as unknown as WorkspaceStore, shell as unknown as ShellStore, execution as unknown as ExecutionStore, ux as unknown as UxStore, templates as unknown as TemplateStore);
  return { store, editor, files, shell, execution, ux, templates };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listen.mockImplementation(async (_name, handler) => { onImport = handler; return mocks.unlisten; });
  mocks.status.mockResolvedValue({ listening: false, port: 27121 });
  mocks.start.mockResolvedValue({ listening: true, port: 27121, workspacePath: root });
  mocks.stop.mockResolvedValue(undefined);
  mocks.flush.mockResolvedValue(undefined);
});

describe("problem import editor integration", () => {
  it("subscribes before starting and passes the selected template to the backend", async () => {
    const { store } = fixture();
    await store.start("// chosen template");
    expect(mocks.listen).toHaveBeenCalledWith("problem-imported", expect.any(Function));
    expect(mocks.start).toHaveBeenCalledWith("// chosen template");
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]);
    expect(store.listening).toBe(true);
    await store.stop();
    expect(store.listening).toBe(false);
  });

  it("flushes the previous statement, opens the code and reader, then reloads imported samples", async () => {
    const { store, editor, shell, execution, files, ux } = fixture();
    await store.initialize();
    onImport({ payload: problem });
    await vi.waitFor(() => expect(ux.success).toHaveBeenCalled());
    expect(editor.openFile).toHaveBeenCalledWith(problem.sourcePath);
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(editor.openFile.mock.invocationCallOrder[0]);
    expect(shell.problemReaderVisible).toBe(true);
    expect(shell.showSublimeTool).toHaveBeenCalledWith("statement");
    expect(shell.generatorOpen).toBe(false);
    expect(shell.activeActivity).toBe("explorer");
    expect(execution.syncActiveSource).toHaveBeenCalledWith(problem.sourcePath, true);
    expect(files.refresh).toHaveBeenCalled();
    expect(store.lastImported).toBe(problem.title);
  });

  it("ignores imports from a different workspace, including a sibling with a shared prefix", async () => {
    const { store, editor } = fixture();
    await store.initialize();
    onImport({ payload: { ...problem, sourcePath: "D:\\Code-other\\A.cpp" } });
    onImport({ payload: { ...problem, sourcePath: "D:\\Elsewhere\\A.cpp" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.openFile).not.toHaveBeenCalled();
  });

  it("stops the old session and automatically prepares the new workspace, then stops on disposal", async () => {
    const { store, files } = fixture();
    await store.start("template");
    files.info = { path: "D:\\Other" };
    mocks.start.mockResolvedValue({ listening: true, port: 27121, workspacePath: files.info.path });
    await store.workspaceChanged(files.info.path);
    expect(store.workspacePath).toBe(files.info.path);
    expect(store.listening).toBe(true);
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    store.dispose();
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(mocks.stop).toHaveBeenCalledTimes(2);
  });

  it("automatically prepares imports with the contest template when a workspace opens", async () => {
    const { store, templates } = fixture();
    await store.workspaceChanged(root);
    expect(templates.loadTemplateCode).toHaveBeenCalledWith(2);
    expect(mocks.start).toHaveBeenCalledWith("// template 2");
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]);
    expect(store.templateId).toBe(2);
    expect(store.listening).toBe(true);
    await store.workspaceChanged(root);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("does not start before a workspace opens", async () => {
    const { store, files } = fixture();
    files.info = undefined;
    await store.workspaceChanged();
    expect(store.ready).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
    files.info = { path: root };
    await store.workspaceChanged(root);
    expect(store.listening).toBe(true);
  });

  it("applies a new template and retains it when changing workspaces", async () => {
    const { store, files } = fixture();
    await store.workspaceChanged(root);
    await store.configure(1);
    expect(mocks.start).toHaveBeenLastCalledWith("// template 1");
    expect(store.templateId).toBe(1);
    files.info = { path: "D:\\Other" };
    mocks.start.mockResolvedValue({ listening: true, port: 27121, workspacePath: files.info.path });
    await store.workspaceChanged(files.info.path);
    expect(mocks.start).toHaveBeenLastCalledWith("// template 1");
  });

  it("recovers after automatic startup fails through retrying the connection", async () => {
    const { store } = fixture();
    mocks.start.mockRejectedValueOnce({ userMessage: "端口已被占用" });
    await store.workspaceChanged(root);
    expect(store.error).toBe("端口已被占用");
    expect(store.listening).toBe(false);
    await store.configure();
    expect(store.listening).toBe(true);
    expect(store.error).toBe("");
  });

  it("does not replace a running session when the chosen template cannot be read", async () => {
    const { store, templates } = fixture();
    await store.workspaceChanged(root);
    templates.loadTemplateCode.mockResolvedValueOnce(undefined);
    await store.configure(1);
    expect(store.listening).toBe(true);
    expect(store.templateId).toBe(2);
    expect(store.error).toContain("无法读取");
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("does not appear ready for the previous workspace if preparing the new one fails", async () => {
    const { store, files, templates } = fixture();
    await store.workspaceChanged(root);
    files.info = { path: "D:\\Other" };
    templates.loadTemplateCode.mockResolvedValueOnce(undefined);
    await store.workspaceChanged(files.info.path);
    expect(store.listening).toBe(false);
    expect(store.workspacePath).toBeUndefined();
    expect(store.error).toContain("无法读取");
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("ignores stale template loading and prepares the latest workspace", async () => {
    const { store, files, templates } = fixture();
    let finishLoad!: (value: { code: string }) => void;
    templates.loadTemplateCode.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve; }));
    const first = store.workspaceChanged(root);
    await vi.waitFor(() => expect(templates.loadTemplateCode).toHaveBeenCalled());
    files.info = { path: "D:\\Other" };
    mocks.start.mockResolvedValue({ listening: true, port: 27121, workspacePath: files.info.path });
    const second = store.workspaceChanged(files.info.path);
    finishLoad({ code: "// stale template" });
    await Promise.all([first, second]);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith("// template 2");
    expect(store.workspacePath).toBe(files.info.path);
    expect(store.busy).toBe(false);
  });

  it("does not start a session if disposed while reading the template", async () => {
    const { store, templates } = fixture();
    let finishLoad!: (value: { code: string }) => void;
    templates.loadTemplateCode.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve; }));
    const starting = store.workspaceChanged(root);
    await vi.waitFor(() => expect(templates.loadTemplateCode).toHaveBeenCalled());
    store.dispose();
    finishLoad({ code: "// template" });
    await starting;
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("reports port/start errors and allows retry without appearing to listen", async () => {
    const { store } = fixture();
    mocks.start.mockRejectedValueOnce({ userMessage: "端口已被占用" });
    await store.start("template");
    expect(store.error).toBe("端口已被占用");
    expect(store.listening).toBe(false);
    expect(store.busy).toBe(false);
    await store.start("template");
    expect(store.error).toBe("");
    expect(store.listening).toBe(true);
  });

  it("cancels a start that finishes after a workspace switch", async () => {
    const { store, files } = fixture();
    mocks.start.mockImplementationOnce(async () => {
      files.info = { path: "D:\\Other" };
      return { listening: true, port: 27121, workspacePath: root };
    });
    await store.start("template");
    expect(mocks.stop).toHaveBeenCalled();
    expect(store.listening).toBe(false);
    expect(store.error).toContain("工作区已更换");
  });
});
