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
});

function editorStub() {
  return {
    tabs: [{ id: "old", dirty: true }],
    closeAllTabs: vi.fn(),
  };
}
