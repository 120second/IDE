import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionStore, windowIntersectsMonitor } from "./session";
import { ShellStore } from "./shell.svelte";

describe("workspace session persistence", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reopens the last folder while keeping editor data out of localStorage", async () => {
    const firstWorkspace = workspaceStub("D:\\Recent");
    const first = new SessionStore(
      firstWorkspace as never,
      editorStub() as never,
      new ShellStore(),
      { error: vi.fn() } as never,
    );

    await first.initialize();
    expect(firstWorkspace.openPath).toHaveBeenCalledWith("D:\\Recent");

    firstWorkspace.info = { name: "Problem Set", path: "D:\\Problem Set" };
    first.schedulePersist();
    await vi.advanceTimersByTimeAsync(400);
    first.dispose();

    const persisted = JSON.parse(values.get("lightcp.session.v1") ?? "{}") as Record<string, unknown>;
    expect(persisted.workspacePath).toBe("D:\\Problem Set");
    expect(persisted).not.toHaveProperty("openFiles");
    expect(persisted).not.toHaveProperty("activeFile");

    const reopenedWorkspace = workspaceStub("D:\\Recent");
    const reopened = new SessionStore(
      reopenedWorkspace as never,
      editorStub() as never,
      new ShellStore(),
      { error: vi.fn() } as never,
    );
    await reopened.initialize();

    expect(reopenedWorkspace.openPath).toHaveBeenCalledWith("D:\\Problem Set");
    reopened.dispose();
  });
});

describe("window session geometry", () => {
  const primary = {
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
  };

  it("rejects a restored window that is completely outside every monitor", () => {
    expect(windowIntersectsMonitor(
      { x: -6667, y: -6667, width: 563, height: 448 },
      primary,
    )).toBe(false);
  });

  it("accepts a restored window with a usable visible area", () => {
    expect(windowIntersectsMonitor(
      { x: 1800, y: 100, width: 500, height: 700 },
      primary,
    )).toBe(true);
  });
});

function workspaceStub(recentPath: string) {
  const workspace = {
    recent: [{ name: "Recent", path: recentPath }],
    info: undefined as { name: string; path: string } | undefined,
    error: "",
    openPath: vi.fn(async (path: string) => {
      workspace.info = { name: path.split("\\").at(-1) ?? path, path };
    }),
  };
  return workspace;
}

function editorStub() {
  return {
    setSessionChangeHandler: vi.fn(),
    recoverySnapshot: vi.fn(() => ({ version: 1, tabs: [] })),
    restoreRecoverySnapshot: vi.fn(async () => undefined),
  };
}
