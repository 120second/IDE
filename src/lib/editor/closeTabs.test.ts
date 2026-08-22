import { describe, expect, it, vi } from "vitest";

import { UxStore } from "../stores/ux.svelte";
import { requestCloseTabs } from "./closeTabs";
import type { EditorWorkspace, EditorTab } from "./workspace.svelte";

function dirtyTab(): EditorTab {
  return {
    id: "tab-1",
    title: "main.cpp",
    path: "D:\\Code\\main.cpp",
    dirty: true,
  } as EditorTab;
}

function mockWorkspace(save = true) {
  return {
    tabs: [dirtyTab()],
    notice: save ? "" : "disk write failed",
    saveTab: vi.fn(async () => save),
    closeTab: vi.fn(),
  } as unknown as EditorWorkspace;
}

describe("shared editor close flow", () => {
  it("leaves a dirty editor open when the user cancels", async () => {
    const workspace = mockWorkspace();
    const ux = new UxStore();

    const closing = requestCloseTabs(workspace, ux, ["tab-1"]);
    ux.cancelConfirmation();

    await expect(closing).resolves.toBe(false);
    expect(workspace.saveTab).not.toHaveBeenCalled();
    expect(workspace.closeTab).not.toHaveBeenCalled();
    ux.dispose();
  });

  it("stops closing if save fails", async () => {
    const workspace = mockWorkspace(false);
    const ux = new UxStore();

    const closing = requestCloseTabs(workspace, ux, ["tab-1"]);
    ux.acceptConfirmation();

    await expect(closing).resolves.toBe(false);
    expect(workspace.saveTab).toHaveBeenCalledWith("tab-1");
    expect(workspace.closeTab).not.toHaveBeenCalled();
    expect(ux.toasts[0]?.message).toContain("disk write failed");
    ux.dispose();
  });

  it("closes without saving only after explicit discard", async () => {
    const workspace = mockWorkspace();
    const ux = new UxStore();

    const closing = requestCloseTabs(workspace, ux, ["tab-1"]);
    ux.acceptSecondaryConfirmation();

    await expect(closing).resolves.toBe(true);
    expect(workspace.saveTab).not.toHaveBeenCalled();
    expect(workspace.closeTab).toHaveBeenCalledWith("tab-1");
    ux.dispose();
  });
});
