import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../stores/settings.svelte";

const workspaceApi = vi.hoisted(() => ({
  getTextFileRevision: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../api/workspace", () => workspaceApi);

import { EditorWorkspace } from "./workspace.svelte";

describe("editor save checkpoint", () => {
  beforeEach(() => {
    workspaceApi.getTextFileRevision.mockReset();
    workspaceApi.readTextFile.mockReset();
    workspaceApi.writeTextFile.mockReset();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps edits made during a save dirty after the older snapshot completes", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "",
      revision: "disk-0",
    });
    let finishWrite: ((value: { status: "saved"; path: string; revision: string }) => void) | undefined;
    workspaceApi.writeTextFile.mockImplementation(() => new Promise((resolve) => {
      finishWrite = resolve;
    }));

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\main.cpp");
    workspace.insertSnippet("saved snapshot");
    const saving = workspace.saveActive();
    workspace.insertSnippet(" newer edit");

    await vi.waitFor(() => expect(workspaceApi.writeTextFile).toHaveBeenCalledTimes(1));
    finishWrite?.({ status: "saved", path: "D:\\Code\\main.cpp", revision: "disk-1" });
    expect(await saving).toBe(true);
    expect(workspace.activeTab?.dirty).toBe(true);
    expect(workspace.activeTab?.state.doc.toString()).toContain("newer edit");
  });

  it("serializes saves for one tab and advances the expected disk revision", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "",
      revision: "disk-0",
    });
    const writes: Array<{
      resolve: (value: { status: "saved"; path: string; revision: string }) => void;
    }> = [];
    workspaceApi.writeTextFile.mockImplementation(() => new Promise((resolve) => {
      writes.push({ resolve });
    }));

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\main.cpp");
    workspace.insertSnippet("first");
    const firstSave = workspace.saveActive();
    await vi.waitFor(() => expect(workspaceApi.writeTextFile).toHaveBeenCalledTimes(1));

    workspace.insertSnippet(" second");
    const secondSave = workspace.saveActive();
    expect(workspaceApi.writeTextFile).toHaveBeenCalledTimes(1);

    writes[0].resolve({ status: "saved", path: "D:\\Code\\main.cpp", revision: "disk-1" });
    expect(await firstSave).toBe(true);
    await vi.waitFor(() => expect(workspaceApi.writeTextFile).toHaveBeenCalledTimes(2));
    expect(workspaceApi.writeTextFile.mock.calls[1][2]).toBe("disk-1");

    writes[1].resolve({ status: "saved", path: "D:\\Code\\main.cpp", revision: "disk-2" });
    expect(await secondSave).toBe(true);
    expect(workspace.activeTab?.dirty).toBe(false);
    expect(workspace.activeTab?.diskRevision).toBe("disk-2");
  });

  it("saves every dirty file without changing the active tab", async () => {
    workspaceApi.readTextFile.mockImplementation(async (path: string) => ({
      path,
      content: "",
      revision: `disk-${path.includes("first") ? "first" : "second"}`,
    }));
    workspaceApi.writeTextFile.mockImplementation(async (path: string) => ({
      status: "saved",
      path,
      revision: `saved-${path.includes("first") ? "first" : "second"}`,
    }));

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\first.cpp");
    workspace.insertSnippet("first edit");
    await workspace.openFile("D:\\Code\\second.cpp");
    workspace.insertSnippet("second edit");
    const activeId = workspace.activeId;

    await expect(workspace.saveAll()).resolves.toEqual({ saved: 2, failed: 0, skipped: 0 });

    expect(workspaceApi.writeTextFile).toHaveBeenCalledTimes(2);
    expect(workspaceApi.writeTextFile.mock.calls.map((call) => call[0])).toEqual([
      "D:\\Code\\first.cpp",
      "D:\\Code\\second.cpp",
    ]);
    expect(workspace.tabs.every((tab) => !tab.dirty)).toBe(true);
    expect(workspace.activeId).toBe(activeId);
  });

  it("reports dirty untitled editors as skipped when saving all", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "",
      revision: "disk-0",
    });
    workspaceApi.writeTextFile.mockResolvedValue({
      status: "saved",
      path: "D:\\Code\\main.cpp",
      revision: "disk-1",
    });

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\main.cpp");
    workspace.insertSnippet("saved file");
    workspace.createTab();
    workspace.insertSnippet("unsaved buffer");

    await expect(workspace.saveAll()).resolves.toEqual({ saved: 1, failed: 0, skipped: 1 });
    expect(workspace.tabs[0].dirty).toBe(false);
    expect(workspace.tabs[1].dirty).toBe(true);
    expect(workspace.tabs[1].state.sliceDoc()).toBe("unsaved buffer");
  });

  it("requires explicit confirmation and rechecks the external revision before overwrite", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "disk",
      revision: "disk-0",
    });
    workspaceApi.writeTextFile
      .mockResolvedValueOnce({
        status: "conflict",
        path: "D:\\Code\\main.cpp",
        revision: "disk-external",
      })
      .mockResolvedValueOnce({
        status: "saved",
        path: "D:\\Code\\main.cpp",
        revision: "disk-saved",
      });
    const confirm = vi.fn(async () => true);

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    workspace.setExternalConflictResolver(confirm);
    await workspace.openFile("D:\\Code\\main.cpp");
    workspace.insertSnippet("editor ");

    expect(await workspace.saveActive()).toBe(true);
    expect(confirm).toHaveBeenCalledWith({
      path: "D:\\Code\\main.cpp",
      title: "main.cpp",
    });
    expect(workspaceApi.writeTextFile.mock.calls[0][2]).toBe("disk-0");
    expect(workspaceApi.writeTextFile.mock.calls[1][2]).toBe("disk-external");
    expect(workspace.activeTab?.externalModified).toBe(false);
    expect(workspace.activeTab?.dirty).toBe(false);
  });

  it("reloads a clean external revision but preserves a dirty editor buffer", async () => {
    workspaceApi.readTextFile
      .mockResolvedValueOnce({
        path: "D:\\Code\\main.cpp",
        content: "initial",
        revision: "disk-0",
      })
      .mockResolvedValueOnce({
        path: "D:\\Code\\main.cpp",
        content: "external",
        revision: "disk-1",
      });
    workspaceApi.getTextFileRevision.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      revision: "disk-1",
    });

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\main.cpp");
    await workspace.handleExternalChange({ kind: "changed", paths: ["D:\\Code\\main.cpp"] });

    expect(workspace.activeTab?.state.doc.toString()).toBe("external");
    expect(workspace.activeTab?.diskRevision).toBe("disk-1");
    expect(workspace.activeTab?.dirty).toBe(false);

    workspace.insertSnippet(" editor");
    workspaceApi.getTextFileRevision.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      revision: "disk-2",
    });
    await workspace.handleExternalChange({ kind: "changed", paths: ["D:\\Code\\main.cpp"] });

    expect(workspace.activeTab?.state.doc.toString()).toContain("editor");
    expect(workspace.activeTab?.externalModified).toBe(true);
    expect(workspace.activeTab?.externalRevision).toBe("disk-2");
  });

  it("reopens a recreated clean file and preserves a dirty deleted buffer as a conflict", async () => {
    workspaceApi.readTextFile
      .mockResolvedValueOnce({
        path: "D:\\Code\\main.cpp",
        content: "initial",
        revision: "disk-0",
      })
      .mockResolvedValueOnce({
        path: "D:\\Code\\main.cpp",
        content: "recreated",
        revision: "disk-1",
      })
      .mockResolvedValueOnce({
        path: "D:\\Code\\main.cpp",
        content: "recreated again",
        revision: "disk-2",
      });

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\main.cpp");
    workspace.handlePathDeleted("D:\\Code\\main.cpp");
    await workspace.handleExternalChange({ kind: "created", paths: ["D:\\Code\\main.cpp"] });

    expect(workspace.activeTab?.deleted).toBe(false);
    expect(workspace.activeTab?.dirty).toBe(false);
    expect(workspace.activeTab?.state.doc.toString()).toBe("recreated");

    workspace.insertSnippet("editor ");
    workspace.handlePathDeleted("D:\\Code\\main.cpp");
    await workspace.handleExternalChange({ kind: "created", paths: ["D:\\Code\\main.cpp"] });

    expect(workspace.activeTab?.deleted).toBe(false);
    expect(workspace.activeTab?.dirty).toBe(true);
    expect(workspace.activeTab?.externalModified).toBe(true);
    expect(workspace.activeTab?.externalRevision).toBe("disk-2");
    expect(workspace.activeTab?.state.doc.toString()).toContain("editor");
  });

  it("round-trips CRLF and the final line ending through a save", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "first\r\nsecond\r\n",
      revision: "disk-0",
    });
    workspaceApi.writeTextFile.mockResolvedValue({
      status: "saved",
      path: "D:\\Code\\main.cpp",
      revision: "disk-1",
    });

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\main.cpp");
    workspace.insertSnippet("prefix ");
    expect(await workspace.saveActive()).toBe(true);

    expect(workspace.activeTab?.eol).toBe("crlf");
    expect(workspaceApi.writeTextFile.mock.calls[0][1]).toBe("prefix first\r\nsecond\r\n");
  });

  it("normalizes mixed endings to the detected dominant ending", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "first\r\nsecond\nthird\r\n",
      revision: "disk-0",
    });
    workspaceApi.writeTextFile.mockResolvedValue({
      status: "saved",
      path: "D:\\Code\\main.cpp",
      revision: "disk-1",
    });

    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\main.cpp");
    expect(await workspace.saveActive()).toBe(true);

    expect(workspace.activeTab?.eol).toBe("crlf");
    expect(workspaceApi.writeTextFile.mock.calls[0][1]).toBe("first\r\nsecond\r\nthird\r\n");
  });

  it("restores dirty and untitled buffers without losing their content", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "disk\r\n",
      revision: "disk-0",
    });
    const original = new EditorWorkspace(DEFAULT_SETTINGS);
    await original.openFile("D:\\Code\\main.cpp");
    original.insertSnippet("dirty ");
    original.createTab();
    original.insertSnippet("untitled content");
    const snapshot = original.recoverySnapshot("D:\\Code");

    const restored = new EditorWorkspace(DEFAULT_SETTINGS);
    await restored.restoreRecoverySnapshot(snapshot);

    expect(restored.tabs).toHaveLength(2);
    expect(restored.tabs[0].dirty).toBe(true);
    expect(restored.tabs[0].state.sliceDoc()).toBe("dirty disk\r\n");
    expect(restored.tabs[0].externalModified).toBe(false);
    expect(restored.tabs[1].path).toBeUndefined();
    expect(restored.tabs[1].dirty).toBe(true);
    expect(restored.tabs[1].state.doc.toString()).toBe("untitled content");
    expect(restored.activeId).toBe(restored.tabs[1].id);
  });

  it("marks a recovered dirty buffer conflicted when disk changed while closed", async () => {
    workspaceApi.readTextFile
      .mockResolvedValueOnce({
        path: "D:\\Code\\main.cpp",
        content: "disk",
        revision: "disk-0",
      })
      .mockResolvedValueOnce({
        path: "D:\\Code\\main.cpp",
        content: "external",
        revision: "disk-1",
      });
    const original = new EditorWorkspace(DEFAULT_SETTINGS);
    await original.openFile("D:\\Code\\main.cpp");
    original.insertSnippet("dirty ");

    const restored = new EditorWorkspace(DEFAULT_SETTINGS);
    await restored.restoreRecoverySnapshot(original.recoverySnapshot("D:\\Code"));

    expect(restored.activeTab?.state.doc.toString()).toBe("dirty disk");
    expect(restored.activeTab?.dirty).toBe(true);
    expect(restored.activeTab?.externalModified).toBe(true);
    expect(restored.activeTab?.diskRevision).toBe("disk-0");
    expect(restored.activeTab?.externalRevision).toBe("disk-1");
  });

  it("preserves the cursor while lazily hydrating a clean recovered file", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "abcdef",
      revision: "disk-0",
    });
    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);

    await workspace.restoreRecoverySnapshot({
      version: 1,
      workspacePath: "D:\\Code",
      activeTabId: "clean-1",
      tabs: [{
        id: "clean-1",
        title: "main.cpp",
        path: "D:\\Code\\main.cpp",
        dirty: false,
        deleted: false,
        externalModified: false,
        diskRevision: "disk-0",
        eol: "lf",
        selection: { anchor: 4, head: 4 },
        scrollTop: 10,
      }],
    });

    expect(workspace.activeTab?.deferred).toBe(false);
    expect(workspace.activeTab?.state.selection.main.head).toBe(4);
    expect(workspace.activeTab?.scrollTop).toBe(10);
  });

  it("does not rebuild tab state when breakpoint locations are unchanged", async () => {
    workspaceApi.readTextFile.mockResolvedValue({
      path: "D:\\Code\\main.cpp",
      content: "first\nsecond\nthird\n",
      revision: "disk-0",
    });
    const workspace = new EditorWorkspace(DEFAULT_SETTINGS);
    await workspace.openFile("D:\\Code\\main.cpp");

    workspace.setBreakpointLocations([{ file: "D:\\Code\\main.cpp", line: 2 }]);
    const tabsAfterFirstUpdate = workspace.tabs;
    const stateAfterFirstUpdate = workspace.activeTab?.state;

    workspace.setBreakpointLocations([{ file: "D:/Code/main.cpp", line: 2 }]);

    expect(workspace.tabs).toBe(tabsAfterFirstUpdate);
    expect(workspace.activeTab?.state).toBe(stateAfterFirstUpdate);

    workspace.setBreakpointLocations([{ file: "D:\\Code\\main.cpp", line: 3 }]);
    expect(workspace.tabs).not.toBe(tabsAfterFirstUpdate);
  });
});
