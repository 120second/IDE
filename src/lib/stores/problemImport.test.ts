import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedProblem } from "../api/problemImport";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type { WorkspaceStore } from "./workspace.svelte";
import type { ShellStore } from "./shell.svelte";
import type { ExecutionStore } from "./execution.svelte";
import type { UxStore } from "./ux.svelte";

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
  const files = { info: { path: root }, refresh: vi.fn().mockResolvedValue(undefined) };
  const shell = { activeActivity: "templates", generatorOpen: true, problemReaderVisible: false };
  const execution = { syncActiveSource: vi.fn().mockResolvedValue(undefined) };
  const ux = { success: vi.fn(), error: vi.fn() };
  const store = new ProblemImportStore(editor as unknown as EditorWorkspace, files as unknown as WorkspaceStore, shell as ShellStore, execution as unknown as ExecutionStore, ux as unknown as UxStore);
  return { store, editor, files, shell, execution, ux };
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

  it("stops listening when the workspace changes and when the workbench is disposed", async () => {
    const { store } = fixture();
    await store.start("template");
    store.workspaceChanged("D:\\Other");
    await vi.waitFor(() => expect(store.listening).toBe(false));
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    store.dispose();
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(mocks.stop).toHaveBeenCalledTimes(2);
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
