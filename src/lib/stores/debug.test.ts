import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DebugBreakpoint, DebugEvent, DebugSessionSnapshot } from "../types/debug";

const debugApi = vi.hoisted(() => ({
  continueDebugSession: vi.fn(),
  fetchDebugVariableChildren: vi.fn(),
  getDebugSnapshot: vi.fn(),
  pauseDebugSession: vi.fn(),
  removeDebugBreakpoint: vi.fn(),
  restartDebugSession: vi.fn(),
  setDebugBreakpoint: vi.fn(),
  startDebugSession: vi.fn(),
  stepIntoDebugSession: vi.fn(),
  stepOutDebugSession: vi.fn(),
  stepOverDebugSession: vi.fn(),
  stopDebugSession: vi.fn(),
}));

vi.mock("../api/debug", () => debugApi);

import { DebugStore } from "./debug.svelte";

function breakpoint(overrides: Partial<DebugBreakpoint> = {}): DebugBreakpoint {
  return {
    id: "bp-1",
    file: "D:\\Code\\main.cpp",
    line: 7,
    enabled: true,
    condition: "",
    verified: true,
    gdbNumber: "1",
    message: "",
    ...overrides,
  };
}

function snapshot(overrides: Partial<DebugSessionSnapshot> = {}): DebugSessionSnapshot {
  return {
    sessionId: "session-1",
    state: "running",
    reason: "程序正在运行",
    selectedFrame: 0,
    frames: [],
    variables: [],
    watches: [],
    breakpoints: [],
    ...overrides,
  };
}

function fixture() {
  let moveBreakpoints: ((file: string, lines: number[]) => void) | undefined;
  const editor = {
    activeTab: { path: "D:\\Code\\main.cpp" },
    setBreakpointHandlers: vi.fn((_: unknown, moved: (file: string, lines: number[]) => void) => {
      moveBreakpoints = moved;
    }),
    setBreakpointLocations: vi.fn(),
    clearDebugLocation: vi.fn(),
    revealDebugLocation: vi.fn().mockResolvedValue(undefined),
    openSearchMatch: vi.fn().mockResolvedValue(undefined),
  };
  const execution = {
    compileCurrent: vi.fn().mockResolvedValue({ success: true, executablePath: "D:\\Code\\main.exe" }),
    error: "",
    testcases: [{ id: 1, name: "样例 1", input: "21\n", enabled: true }],
  };
  const settings = { value: { gdbPath: "gdb" } };
  const shell = {
    activeActivity: "explorer",
    sidebarVisible: false,
    showBottomPanel: vi.fn(),
  };
  const store = new DebugStore(editor as never, execution as never, settings as never, shell as never);
  return { editor, execution, shell, store, moved: () => moveBreakpoints };
}

describe("debug store coordination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    debugApi.stopDebugSession.mockResolvedValue(snapshot({ state: "idle" }));
    debugApi.getDebugSnapshot.mockResolvedValue(snapshot({ state: "stopped" }));
  });

  it("passes custom stdin to GDB and opens the debug console", async () => {
    debugApi.startDebugSession.mockResolvedValue(snapshot());
    const { shell, store } = fixture();

    await store.startInput("5\n1 3 2 5 4\n", "自定义输入");

    expect(debugApi.startDebugSession).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "D:\\Code\\main.cpp",
      stdin: "5\n1 3 2 5 4\n",
    }));
    expect(shell.showBottomPanel).toHaveBeenCalledWith("debugConsole");
  });

  it("reveals the selected stack frame after a stopped snapshot refresh", async () => {
    debugApi.getDebugSnapshot.mockResolvedValue(snapshot({
      state: "stopped",
      frames: [{
        level: 0,
        address: "0x1",
        function: "main",
        file: "main.cpp",
        fullName: "D:\\Code\\main.cpp",
        line: 12,
      }],
    }));
    const { editor, store } = fixture();
    store.sessionId = "session-1";
    store.state = "stopped";

    await store.refresh(true);

    expect(editor.revealDebugLocation).toHaveBeenCalledWith("D:\\Code\\main.cpp", 12);
  });

  it("restores a breakpoint when removing it from GDB fails", async () => {
    debugApi.removeDebugBreakpoint.mockRejectedValue(new Error("remove failed"));
    const { store } = fixture();
    store.sessionId = "session-1";
    store.state = "stopped";
    store.breakpoints = [breakpoint()];

    await store.toggleBreakpoint("D:\\Code\\main.cpp", 7);

    expect(store.breakpoints).toHaveLength(1);
    expect(store.breakpoints[0].message).toContain("remove failed");
  });

  it("serializes rapid breakpoint clicks at the same location", async () => {
    let resolveSave: ((value: DebugBreakpoint) => void) | undefined;
    debugApi.setDebugBreakpoint.mockImplementation((value: DebugBreakpoint) => new Promise<DebugBreakpoint>((resolve) => {
      resolveSave = resolve;
      expect(value.line).toBe(7);
    }));
    const { store } = fixture();
    store.sessionId = "session-1";
    store.state = "stopped";

    const first = store.toggleBreakpoint("D:\\Code\\main.cpp", 7);
    const second = store.toggleBreakpoint("D:\\Code\\main.cpp", 7);

    expect(store.breakpoints).toHaveLength(1);
    expect(debugApi.setDebugBreakpoint).toHaveBeenCalledTimes(1);
    resolveSave?.(breakpoint({ id: store.breakpoints[0].id }));
    await Promise.all([first, second]);
  });

  it("removes every stale duplicate at one file and line", async () => {
    debugApi.removeDebugBreakpoint.mockResolvedValue(true);
    const { store } = fixture();
    store.sessionId = "session-1";
    store.state = "stopped";
    store.breakpoints = [breakpoint(), breakpoint({ id: "bp-2", gdbNumber: "2" })];

    await store.toggleBreakpoint("D:\\Code\\main.cpp", 7);

    expect(store.breakpoints).toHaveLength(0);
    expect(debugApi.removeDebugBreakpoint).toHaveBeenCalledTimes(2);
  });

  it("automatically pauses before stepping while the target is running", async () => {
    debugApi.pauseDebugSession.mockResolvedValue(snapshot());
    debugApi.stepOverDebugSession.mockResolvedValue(snapshot());
    const { store } = fixture();
    store.sessionId = "session-1";
    store.state = "running";

    await store.stepOver();
    expect(debugApi.pauseDebugSession).toHaveBeenCalledTimes(1);
    expect(debugApi.stepOverDebugSession).not.toHaveBeenCalled();

    const event: DebugEvent = {
      kind: "state",
      sessionId: "session-1",
      state: "stopped",
      reason: "程序已暂停",
    };
    (store as unknown as { handleEvent: (payload: DebugEvent) => void }).handleEvent(event);

    await vi.waitFor(() => expect(debugApi.stepOverDebugSession).toHaveBeenCalledTimes(1));
  });

  it("reinstalls moved breakpoints in an active GDB session", async () => {
    debugApi.setDebugBreakpoint.mockImplementation(async (value: DebugBreakpoint) => ({
      ...value,
      verified: true,
      gdbNumber: "1",
      message: "",
    }));
    const { store, moved } = fixture();
    store.sessionId = "session-1";
    store.state = "stopped";
    store.breakpoints = [breakpoint()];

    moved()?.("D:\\Code\\main.cpp", [15]);

    await vi.waitFor(() => expect(debugApi.setDebugBreakpoint).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bp-1", line: 15 }),
    ));
  });

  it("uses the selected input for keyboard launches and defaults to pausing at main", async () => {
    debugApi.startDebugSession.mockResolvedValue(snapshot());
    const { store } = fixture();
    store.inputMode = "testcase";
    await store.startCurrent();
    expect(debugApi.startDebugSession).toHaveBeenCalledWith(expect.objectContaining({ stdin: "21\n", stopOnEntry: true }));
  });

  it("accepts a breakpoint event delivered before launch resolves and refreshes after busy clears", async () => {
    const { store, editor } = fixture();
    debugApi.getDebugSnapshot.mockResolvedValue(snapshot({ state: "stopped", frames: [{ level: 0, address: "", function: "main", file: "main.cpp", fullName: "D:\\Code\\main.cpp", line: 7 }] }));
    debugApi.startDebugSession.mockImplementation(async () => {
      emit(store, "stopped");
      await Promise.resolve();
      return snapshot();
    });
    await store.startCurrent();
    await vi.waitFor(() => expect(editor.revealDebugLocation).toHaveBeenCalledWith("D:\\Code\\main.cpp", 7));
    expect(store.state).toBe("stopped");
  });

  it("does not overwrite a fast step's stopped event with a stale running response", async () => {
    const { store } = fixture();
    store.sessionId = "session-1";
    store.state = "stopped";
    debugApi.stepOverDebugSession.mockImplementation(async () => {
      emit(store, "running");
      emit(store, "stopped");
      await Promise.resolve();
      return snapshot();
    });
    await store.stepOver();
    await vi.waitFor(() => expect(debugApi.getDebugSnapshot).toHaveBeenCalledTimes(1));
    expect(store.stopped).toBe(true);
  });

  it("discards inspection results from the previous pause even if another pause has arrived", async () => {
    const { store } = fixture();
    store.sessionId = "session-1";
    store.state = "stopped";
    let resolve!: (value: DebugSessionSnapshot) => void;
    debugApi.getDebugSnapshot.mockReturnValueOnce(new Promise<DebugSessionSnapshot>((done) => { resolve = done; }));
    const refresh = store.refresh();
    emit(store, "running");
    emit(store, "stopped");
    resolve(snapshot({ state: "stopped", variables: [{ name: "stale", expression: "stale", value: "99", typeName: "int", numChildren: 0, hasChildren: false }] }));
    await refresh;
    expect(store.variables).toEqual([]);
  });

  it("allows a new session after normal exit and ignores old or post-stop events", async () => {
    const { store } = fixture();
    store.sessionId = "old";
    store.state = "exited";
    expect(store.active).toBe(false);
    debugApi.startDebugSession.mockResolvedValue(snapshot());
    await store.startCurrent();
    emit(store, "exited", "old");
    expect(store.state).toBe("running");
    await store.stop();
    emit(store, "stopped");
    expect(store.state).toBe("idle");
    expect(store.sessionId).toBe("");
  });

  it("can cancel while compilation is pending without starting GDB", async () => {
    const { store, execution } = fixture();
    let resolve!: (value: unknown) => void;
    execution.compileCurrent.mockReturnValue(new Promise((done) => { resolve = done; }) as never);
    const starting = store.startCurrent();
    await vi.waitFor(() => expect(execution.compileCurrent).toHaveBeenCalled());
    await store.stop();
    expect(store.stopRequested).toBe(true);
    resolve({ success: true, executablePath: "D:\\Code\\main.exe" });
    await starting;
    expect(debugApi.startDebugSession).not.toHaveBeenCalled();
    expect(store.state).toBe("idle");
    expect(store.busy).toBe(false);
  });

  it("releases a failed session so fixing GDB settings and retrying works", async () => {
    const { store } = fixture();
    debugApi.startDebugSession.mockRejectedValueOnce(new Error("找不到 GDB"));
    await store.startCurrent();
    expect(store.error).toBe("找不到 GDB");
    expect(store.active).toBe(false);
    debugApi.startDebugSession.mockResolvedValueOnce(snapshot());
    await store.startCurrent();
    expect(store.state).toBe("running");
    expect(store.error).toBe("");
  });
});

function emit(store: DebugStore, state: DebugSessionSnapshot["state"], sessionId = "session-1"): void {
  (store as unknown as { handleEvent: (event: DebugEvent) => void }).handleEvent({ kind: "state", sessionId, state, reason: state });
}
