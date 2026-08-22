import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recoveryApi = vi.hoisted(() => ({
  loadEditorRecovery: vi.fn(),
  saveEditorRecovery: vi.fn(),
}));

const windowApi = vi.hoisted(() => {
  const appWindow = {
    outerPosition: vi.fn(async () => ({ x: 10, y: 20 })),
    outerSize: vi.fn(async () => ({ width: 1280, height: 800 })),
    isMaximized: vi.fn(async () => false),
    onMoved: vi.fn(async () => vi.fn()),
    onResized: vi.fn(async () => vi.fn()),
    onCloseRequested: vi.fn(),
    setSize: vi.fn(async () => undefined),
    setPosition: vi.fn(async () => undefined),
    center: vi.fn(async () => undefined),
    maximize: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
  return { appWindow };
});

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn(async () => []),
  getCurrentWindow: () => windowApi.appWindow,
  PhysicalPosition: class PhysicalPosition {
    constructor(public x: number, public y: number) {}
  },
  PhysicalSize: class PhysicalSize {
    constructor(public width: number, public height: number) {}
  },
}));
vi.mock("../api/session", () => recoveryApi);

import { SessionStore } from "./session";
import { ShellStore } from "./shell.svelte";

describe("editor recovery lifecycle", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    values.clear();
    recoveryApi.loadEditorRecovery.mockReset();
    recoveryApi.saveEditorRecovery.mockReset();
    windowApi.appWindow.onMoved.mockReset().mockResolvedValue(vi.fn());
    windowApi.appWindow.onResized.mockReset().mockResolvedValue(vi.fn());
    windowApi.appWindow.onCloseRequested.mockReset();
    windowApi.appWindow.destroy.mockReset().mockResolvedValue(undefined);
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

  it("restores the editor snapshot and flushes it before destroying the window", async () => {
    const snapshot = {
      version: 1 as const,
      workspacePath: "D:\\Code",
      activeTabId: "tab-1",
      tabs: [{
        id: "tab-1",
        title: "main.cpp",
        path: "D:\\Code\\main.cpp",
        dirty: true,
        deleted: false,
        externalModified: false,
        diskRevision: "disk-0",
        eol: "lf" as const,
        content: "dirty",
        selection: { anchor: 5, head: 5 },
        scrollTop: 0,
      }],
    };
    recoveryApi.loadEditorRecovery.mockResolvedValue(snapshot);
    let finishSave: (() => void) | undefined;
    recoveryApi.saveEditorRecovery.mockImplementation(() => new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    let closeHandler: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
    windowApi.appWindow.onCloseRequested.mockImplementation(async (handler) => {
      closeHandler = handler;
      return vi.fn();
    });
    const workspace = workspaceStub();
    const editor = editorStub(snapshot);
    const store = new SessionStore(
      workspace as never,
      editor as never,
      new ShellStore(),
      { error: vi.fn(), confirm: vi.fn() } as never,
    );

    await store.initialize();
    expect(workspace.openPath).toHaveBeenCalledWith("D:\\Code");
    expect(editor.restoreRecoverySnapshot).toHaveBeenCalledWith(snapshot);

    const prevented = vi.fn();
    const closing = closeHandler!({ preventDefault: prevented });
    await vi.waitFor(() => expect(recoveryApi.saveEditorRecovery).toHaveBeenCalledTimes(1));
    expect(windowApi.appWindow.destroy).not.toHaveBeenCalled();
    finishSave?.();
    await closing;

    expect(prevented).toHaveBeenCalledOnce();
    expect(windowApi.appWindow.destroy).toHaveBeenCalledOnce();
    store.dispose();
  });
});

function workspaceStub() {
  const workspace = {
    recent: [],
    info: undefined as { name: string; path: string } | undefined,
    error: "",
    openPath: vi.fn(async (path: string) => {
      workspace.info = { name: "Code", path };
    }),
  };
  return workspace;
}

function editorStub(snapshot: object) {
  return {
    setSessionChangeHandler: vi.fn(),
    recoverySnapshot: vi.fn(() => snapshot),
    restoreRecoverySnapshot: vi.fn(async () => undefined),
  };
}
