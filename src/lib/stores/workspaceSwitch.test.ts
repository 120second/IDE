import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  chooseWorkspaceFolder: vi.fn(),
  createDirectory: vi.fn(),
  createFile: vi.fn(),
  deleteEntry: vi.fn(),
  listDirectory: vi.fn(),
  listRecentWorkspaces: vi.fn(),
  moveEntry: vi.fn(),
  openWorkspace: vi.fn(),
  renameEntry: vi.fn(),
}));

vi.mock("../api/workspace", () => api);

import { WorkspaceStore } from "./workspace.svelte";

describe("workspace switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listDirectory.mockResolvedValue([]);
    api.listRecentWorkspaces.mockResolvedValue([]);
  });

  it("keeps the current workspace when the change guard cancels", async () => {
    const editor = editorStub();
    const workspace = new WorkspaceStore(editor as never);
    workspace.info = { name: "Old", path: "D:\\Old" };
    const guard = vi.fn(async () => false);
    workspace.setWorkspaceChangeGuard(guard);

    await workspace.openPath("D:\\New");

    expect(guard).toHaveBeenCalledWith("D:\\New");
    expect(api.openWorkspace).not.toHaveBeenCalled();
    expect(editor.closeAllTabs).not.toHaveBeenCalled();
    expect(workspace.info?.path).toBe("D:\\Old");
  });

  it("preserves tabs when opening the new workspace fails", async () => {
    const editor = editorStub();
    const workspace = new WorkspaceStore(editor as never);
    workspace.info = { name: "Old", path: "D:\\Old" };
    workspace.setWorkspaceChangeGuard(async () => true);
    api.openWorkspace.mockRejectedValue(new Error("missing folder"));

    await workspace.openPath("D:\\Missing");

    expect(editor.closeAllTabs).not.toHaveBeenCalled();
    expect(workspace.info?.path).toBe("D:\\Old");
    expect(workspace.error).toBe("missing folder");
  });

  it("closes old tabs only after the new workspace opens", async () => {
    const editor = editorStub();
    const workspace = new WorkspaceStore(editor as never);
    workspace.info = { name: "Old", path: "D:\\Old" };
    workspace.setWorkspaceChangeGuard(async () => true);
    api.openWorkspace.mockResolvedValue({ name: "New", path: "D:\\New" });

    await workspace.openPath("D:\\New");

    expect(editor.closeAllTabs).toHaveBeenCalledTimes(1);
    expect(workspace.info?.path).toBe("D:\\New");
  });

  it("serializes rapid workspace changes so frontend and backend end on the latest path", async () => {
    const editor = editorStub();
    editor.tabs = [];
    const workspace = new WorkspaceStore(editor as never);
    let resolveFirst!: (info: { name: string; path: string }) => void;
    api.openWorkspace
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ name: "Second", path: "D:\\Second" });

    const first = workspace.openPath("D:\\First");
    const second = workspace.openPath("D:\\Second");
    await vi.waitFor(() => expect(api.openWorkspace).toHaveBeenCalledTimes(1));
    resolveFirst({ name: "First", path: "D:\\First" });
    await Promise.all([first, second]);

    expect(api.openWorkspace.mock.calls.map(([path]) => path)).toEqual(["D:\\First", "D:\\Second"]);
    expect(workspace.info).toEqual({ name: "Second", path: "D:\\Second" });
  });

  it("expands lazy parent directories when revealing the active editor file", async () => {
    const editor = editorStub();
    const workspace = new WorkspaceStore(editor as never);
    workspace.info = { name: "Contest", path: "D:\\Contest" };
    api.listDirectory.mockImplementation(async (path: string) => {
      if (path === "D:\\Contest") return [directory("src", `${path}\\src`)];
      if (path === "D:\\Contest\\src") return [directory("graph", `${path}\\graph`)];
      if (path === "D:\\Contest\\src\\graph") {
        return [{ name: "main.cpp", path: `${path}\\main.cpp`, kind: "file" }];
      }
      return [];
    });

    await workspace.revealPath("D:\\Contest\\src\\graph\\main.cpp");

    expect(api.listDirectory.mock.calls.map(([path]) => path)).toEqual([
      "D:\\Contest",
      "D:\\Contest\\src",
      "D:\\Contest\\src\\graph",
    ]);
    expect(workspace.selectedPath).toBe("D:\\Contest\\src\\graph\\main.cpp");
    expect(workspace.visibleRows.map((row) => row.entry.name)).toEqual([
      "src",
      "graph",
      "main.cpp",
    ]);
  });
});

function directory(name: string, path: string) {
  return { name, path, kind: "directory" as const };
}

function editorStub() {
  return {
    tabs: [{ id: "old", dirty: true }],
    closeAllTabs: vi.fn(),
  };
}
