import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  continueDebugSession,
  fetchDebugVariableChildren,
  getDebugSnapshot,
  pauseDebugSession,
  removeDebugBreakpoint,
  restartDebugSession,
  setDebugBreakpoint,
  startDebugSession,
  stepIntoDebugSession,
  stepOutDebugSession,
  stepOverDebugSession,
  stopDebugSession,
} from "../api/debug";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type {
  DebugBreakpoint,
  DebugBreakpointInput,
  DebugEvent,
  DebugFrame,
  DebugSessionSnapshot,
  DebugSessionState,
  DebugVariable,
  DebugVariablePage,
  DebugWatch,
} from "../types/debug";
import type { Testcase } from "../types/execution";
import type { ExecutionStore } from "./execution.svelte";
import type { SettingsStore } from "./settings.svelte";
import type { ShellStore } from "./shell.svelte";
import { recordIpcEvent } from "../performance";
import { BoundedOutputBuffer, OUTPUT_FLUSH_INTERVAL_MS } from "../outputBuffer";

const CONSOLE_LIMIT = 2 * 1024 * 1024;
type DebugStepKind = "over" | "into" | "out";

export class DebugStore {
  state = $state<DebugSessionState>("idle");
  sessionId = $state("");
  reason = $state("");
  busy = $state(false);
  breakpointBusy = $state(false);
  pendingStep = $state<DebugStepKind>();
  error = $state("");
  console = $state("");
  selectedFrame = $state(0);
  variables = $state.raw<DebugVariable[]>([]);
  frames = $state.raw<DebugFrame[]>([]);
  breakpoints = $state.raw<DebugBreakpoint[]>([]);
  watches = $state.raw<DebugWatch[]>([]);

  private unlisten: UnlistenFn | undefined;
  private sequence = 0;
  private watchSequence = 0;
  private readonly consoleBuffer = new BoundedOutputBuffer(
    CONSOLE_LIMIT,
    "[较早的调试输出已丢弃]\n",
  );
  private consoleTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private debugSourcePath = "";
  private relocatedBreakpoints = new Map<string, DebugBreakpointInput>();
  private relocationTimer: ReturnType<typeof setTimeout> | undefined;

  get approximateOutputBytes(): number {
    return this.consoleBuffer.approximateLength(this.console) * 2;
  }

  constructor(
    private readonly editor: EditorWorkspace,
    private readonly execution: ExecutionStore,
    private readonly settings: SettingsStore,
    private readonly shell: ShellStore,
  ) {
    editor.setBreakpointHandlers(
      (file, line) => void this.toggleBreakpoint(file, line),
      (file, lines) => this.relocateBreakpoints(file, lines),
    );
  }

  get active(): boolean {
    return this.state === "starting" || (Boolean(this.sessionId) && this.state !== "idle");
  }

  get stopped(): boolean {
    return this.state === "stopped";
  }

  async initialize(): Promise<void> {
    if (!isTauri()) return;
    try {
      const unlisten = await listen<DebugEvent>("debug-event", (event) => {
        recordIpcEvent();
        this.handleEvent(event.payload);
      });
      if (this.disposed) unlisten();
      else this.unlisten = unlisten;
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unlisten?.();
    this.unlisten = undefined;
    if (this.consoleTimer) clearTimeout(this.consoleTimer);
    this.consoleTimer = undefined;
    if (this.relocationTimer) clearTimeout(this.relocationTimer);
    this.relocationTimer = undefined;
    this.relocatedBreakpoints.clear();
    this.consoleBuffer.clear();
    this.editor.clearDebugLocation();
    if (this.active) void stopDebugSession();
  }

  async startCurrent(): Promise<void> {
    await this.start("");
  }

  async startTestcase(testcase: Testcase): Promise<void> {
    await this.startInput(testcase.input, testcase.name);
  }

  async startInput(input: string, label: string): Promise<void> {
    await this.start(input, label);
  }

  async continueExecution(): Promise<void> {
    if (!this.stopped) return;
    this.pendingStep = undefined;
    await this.control(continueDebugSession);
  }

  async pause(): Promise<void> {
    if (this.state !== "running") return;
    await this.control(pauseDebugSession);
  }

  async stepOver(): Promise<void> {
    await this.requestStep("over");
  }

  async stepInto(): Promise<void> {
    await this.requestStep("into");
  }

  async stepOut(): Promise<void> {
    await this.requestStep("out");
  }

  async restart(): Promise<void> {
    if (!this.active) return;
    this.pendingStep = undefined;
    await this.control(restartDebugSession, true);
  }

  async stop(): Promise<void> {
    if (this.busy || this.state === "idle") return;
    this.pendingStep = undefined;
    this.busy = true;
    try {
      this.applySnapshot(await stopDebugSession());
      this.sessionId = "";
      this.debugSourcePath = "";
      this.variables = [];
      this.frames = [];
      this.error = "";
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.editor.clearDebugLocation();
      this.busy = false;
    }
  }

  async refresh(revealFrame = false): Promise<void> {
    if (!this.stopped || this.busy) return;
    const request = ++this.sequence;
    try {
      const snapshot = await getDebugSnapshot(
        this.selectedFrame,
        this.watches.map((watch) => watch.expression),
      );
      if (request === this.sequence && this.state === "stopped") {
        this.applySnapshot(snapshot);
        if (revealFrame) await this.revealSelectedFrame();
      }
    } catch (error) {
      if (request === this.sequence) this.error = errorMessage(error);
    }
  }

  async selectFrame(level: number): Promise<void> {
    if (!this.stopped) return;
    if (level === this.selectedFrame) {
      await this.revealSelectedFrame();
      return;
    }
    this.selectedFrame = level;
    await this.refresh(true);
  }

  async revealBreakpoint(breakpoint: DebugBreakpoint): Promise<void> {
    await this.editor.openSearchMatch(breakpoint.file, breakpoint.line, 1);
  }

  addWatch(expression: string): void {
    expression = expression.trim();
    if (!expression || this.watches.some((watch) => watch.expression === expression)) return;
    this.watches = [...this.watches, {
      id: `watch-${Date.now()}-${++this.watchSequence}`,
      expression,
      value: "",
      error: "",
    }];
    if (this.stopped) void this.refresh();
  }

  removeWatch(id: string): void {
    this.watches = this.watches.filter((watch) => watch.id !== id);
    if (this.stopped) void this.refresh();
  }

  async fetchChildren(variable: DebugVariable, from = 0): Promise<DebugVariablePage | undefined> {
    if (!this.stopped) return undefined;
    try {
      return await fetchDebugVariableChildren(
        this.selectedFrame,
        variable.expression,
        variable.variableObject,
        from,
      );
    } catch (error) {
      this.error = errorMessage(error);
      return undefined;
    }
  }

  async toggleBreakpoint(file: string, line: number): Promise<void> {
    if (this.busy || this.breakpointBusy) return;
    const existing = this.breakpoints.filter(
      (breakpoint) => samePath(breakpoint.file, file) && breakpoint.line === line,
    );
    if (existing.length) {
      const ids = new Set(existing.map((breakpoint) => breakpoint.id));
      this.breakpoints = this.breakpoints.filter((breakpoint) => !ids.has(breakpoint.id));
      this.syncGutter();
      if (this.active) {
        this.breakpointBusy = true;
        const failed: DebugBreakpoint[] = [];
        try {
          for (const breakpoint of existing) {
            try {
              await removeDebugBreakpoint(breakpoint.id);
            } catch (error) {
              const message = errorMessage(error);
              this.error = message;
              failed.push({ ...breakpoint, message });
            }
          }
        } finally {
          this.breakpointBusy = false;
          if (failed.length) {
            this.breakpoints = dedupeBreakpoints([...this.breakpoints, ...failed]);
            this.syncGutter();
          }
        }
      }
      return;
    }
    const input: DebugBreakpointInput = {
      id: `breakpoint-${Date.now()}-${++this.sequence}`,
      file,
      line,
      enabled: true,
      condition: "",
    };
    const breakpoint: DebugBreakpoint = {
      ...input,
      verified: false,
      message: "",
    };
    this.breakpoints = dedupeBreakpoints([...this.breakpoints, breakpoint]);
    this.syncGutter();
    if (this.active) {
      this.breakpointBusy = true;
      try {
        await this.pushBreakpoint(input);
      } finally {
        this.breakpointBusy = false;
      }
    }
  }

  async updateBreakpoint(id: string, patch: Partial<Pick<DebugBreakpoint, "enabled" | "condition">>): Promise<void> {
    if (this.busy || this.breakpointBusy) return;
    const existing = this.breakpoints.find((breakpoint) => breakpoint.id === id);
    if (!existing) return;
    const next = { ...existing, ...patch, verified: false, message: "" };
    if (sameBreakpoint(existing, next)) return;
    this.breakpoints = this.breakpoints.map((breakpoint) => breakpoint.id === id ? next : breakpoint);
    this.syncGutter();
    if (this.active) {
      this.breakpointBusy = true;
      try {
        await this.pushBreakpoint(next);
      } finally {
        this.breakpointBusy = false;
      }
    }
  }

  async setAllBreakpointsEnabled(enabled: boolean): Promise<void> {
    if (this.busy || this.breakpointBusy) return;
    const changed = this.breakpoints
      .filter((breakpoint) => breakpoint.enabled !== enabled)
      .map((breakpoint) => ({ ...breakpoint, enabled, verified: false, message: "" }));
    if (!changed.length) return;
    const replacements = new Map(changed.map((breakpoint) => [breakpoint.id, breakpoint]));
    this.breakpoints = this.breakpoints.map((breakpoint) => replacements.get(breakpoint.id) ?? breakpoint);
    this.syncGutter();
    if (!this.active) return;
    this.breakpointBusy = true;
    try {
      for (const breakpoint of changed) await this.pushBreakpoint(breakpoint);
    } finally {
      this.breakpointBusy = false;
    }
  }

  async clearBreakpoints(): Promise<void> {
    if (this.busy || this.breakpointBusy || !this.breakpoints.length) return;
    const removed = this.breakpoints;
    this.breakpoints = [];
    this.syncGutter();
    if (!this.active) return;
    this.breakpointBusy = true;
    const failed: DebugBreakpoint[] = [];
    try {
      for (const breakpoint of removed) {
        try {
          await removeDebugBreakpoint(breakpoint.id);
        } catch (error) {
          const message = errorMessage(error);
          this.error = message;
          failed.push({ ...breakpoint, message });
        }
      }
    } finally {
      this.breakpointBusy = false;
      if (failed.length) {
        this.breakpoints = dedupeBreakpoints([...this.breakpoints, ...failed]);
        this.syncGutter();
      }
    }
  }

  clearConsole(): void {
    if (this.consoleTimer) clearTimeout(this.consoleTimer);
    this.consoleTimer = undefined;
    this.consoleBuffer.clear();
    this.console = "";
  }

  private async start(stdin: string, testcaseName = ""): Promise<void> {
    if (this.active || this.busy) return;
    this.pendingStep = undefined;
    this.breakpoints = dedupeBreakpoints(this.breakpoints);
    this.syncGutter();
    this.busy = true;
    this.error = "";
    this.clearConsole();
    this.editor.clearDebugLocation();
    this.sessionId = "";
    this.state = "starting";
    this.reason = testcaseName ? `正在调试测试点“${testcaseName}”` : "正在准备调试";
    const sourcePath = this.editor.activeTab?.path;
    this.debugSourcePath = sourcePath ?? "";
    try {
      const compiled = await this.execution.compileCurrent("debug");
      if (!compiled?.success || !compiled.executablePath || !sourcePath) {
        this.state = "idle";
        this.error = this.execution.error || "调试编译失败。";
        return;
      }
      this.shell.activeActivity = "debug";
      this.shell.sidebarVisible = true;
      this.shell.showBottomPanel("debugConsole");
      const snapshot = await startDebugSession({
        gdbPath: this.settings.value.gdbPath,
        executablePath: compiled.executablePath,
        sourcePath,
        workingDirectory: parentDirectory(sourcePath),
        stdin,
        breakpoints: this.breakpoints.map(({ id, file, line, enabled, condition }) => ({
          id, file, line, enabled, condition,
        })),
      });
      this.applySnapshot(snapshot);
      if (snapshot.state === "stopped") queueMicrotask(() => void this.refresh(true));
    } catch (error) {
      this.state = "error";
      this.error = errorMessage(error);
      this.reason = this.error;
      this.appendConsole(`[调试] ${this.error}\n`);
    } finally {
      this.busy = false;
    }
  }

  private async control(action: () => Promise<DebugSessionSnapshot>, restarting = false): Promise<boolean> {
    if (this.busy || !this.active) return false;
    this.busy = true;
    this.error = "";
    if (restarting) {
      this.state = "starting";
      this.reason = "正在重新启动";
    }
    try {
      this.applySnapshot(await action());
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private async requestStep(kind: DebugStepKind): Promise<void> {
    if (this.busy || this.pendingStep || !this.active) return;
    if (this.stopped) {
      await this.performStep(kind);
      return;
    }
    if (this.state !== "running") return;
    this.pendingStep = kind;
    this.reason = `正在暂停，以执行${stepLabel(kind)}`;
    const paused = await this.control(pauseDebugSession);
    if (!paused) {
      this.pendingStep = undefined;
      return;
    }
    await this.consumePendingStep();
  }

  private async consumePendingStep(): Promise<void> {
    if (this.busy || !this.stopped || !this.pendingStep) return;
    const kind = this.pendingStep;
    this.pendingStep = undefined;
    this.reason = `正在执行${stepLabel(kind)}`;
    await this.performStep(kind);
  }

  private async performStep(kind: DebugStepKind): Promise<void> {
    const action = kind === "over"
      ? stepOverDebugSession
      : kind === "into"
        ? stepIntoDebugSession
        : stepOutDebugSession;
    await this.control(action);
  }

  private async pushBreakpoint(input: DebugBreakpointInput): Promise<boolean> {
    try {
      const saved = await setDebugBreakpoint(input);
      this.mergeBreakpoints([saved]);
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      this.breakpoints = this.breakpoints.map((breakpoint) => breakpoint.id === input.id
        ? { ...breakpoint, verified: false, message: this.error }
        : breakpoint);
      return false;
    }
  }

  private handleEvent(event: DebugEvent): void {
    if (this.sessionId && event.sessionId !== this.sessionId) return;
    if (!this.sessionId) this.sessionId = event.sessionId;
    if (event.kind === "output") {
      this.appendConsole(event.text);
      return;
    }
    if (event.kind === "breakpoints") {
      this.replaceBreakpoints(event.breakpoints);
      return;
    }
    this.state = event.state;
    this.reason = event.reason;
    if (event.state === "stopped") {
      this.selectedFrame = 0;
      if (this.pendingStep) queueMicrotask(() => void this.consumePendingStep());
      else queueMicrotask(() => void this.refresh(true));
    } else if (event.state === "running") {
      this.error = "";
      this.editor.clearDebugLocation();
    } else if (event.state === "exited" || event.state === "error") {
      this.pendingStep = undefined;
      this.variables = [];
      this.frames = [];
      this.editor.clearDebugLocation();
    }
  }

  private applySnapshot(snapshot: DebugSessionSnapshot): void {
    if (snapshot.sessionId) this.sessionId = snapshot.sessionId;
    this.state = snapshot.state;
    this.reason = snapshot.reason;
    this.selectedFrame = snapshot.selectedFrame;
    this.frames = snapshot.frames;
    this.variables = snapshot.variables;
    if (snapshot.state === "exited" || snapshot.state === "error") this.pendingStep = undefined;
    if (snapshot.state !== "stopped") this.editor.clearDebugLocation();
    this.mergeBreakpoints(snapshot.breakpoints);
    const values = new Map(snapshot.watches.map((watch) => [watch.expression, watch]));
    this.watches = this.watches.map((watch) => ({ ...watch, ...(values.get(watch.expression) ?? {}) }));
  }

  private mergeBreakpoints(incoming: DebugBreakpoint[]): void {
    const byId = new Map(incoming.map((breakpoint) => [breakpoint.id, breakpoint]));
    const existingIds = new Set(this.breakpoints.map((breakpoint) => breakpoint.id));
    const next = this.breakpoints.map((breakpoint) => {
      const replacement = byId.get(breakpoint.id);
      return replacement ?? breakpoint;
    });
    for (const breakpoint of incoming) {
      if (existingIds.has(breakpoint.id)) continue;
      existingIds.add(breakpoint.id);
      next.push(breakpoint);
    }
    const deduped = dedupeBreakpoints(next);
    if (sameBreakpointLists(this.breakpoints, deduped)) return;
    this.breakpoints = deduped;
    this.syncGutter();
  }

  private replaceBreakpoints(incoming: DebugBreakpoint[]): void {
    const next = dedupeBreakpoints(incoming);
    if (sameBreakpointLists(this.breakpoints, next)) return;
    this.breakpoints = next;
    this.syncGutter();
  }

  private relocateBreakpoints(file: string, lines: number[]): void {
    const existing = this.breakpoints
      .filter((breakpoint) => samePath(breakpoint.file, file))
      .sort((left, right) => left.line - right.line);
    if (existing.length === 0) return;
    if (existing.length !== lines.length) return;
    const replacements = new Map(existing.map((breakpoint, index) => [breakpoint.id, lines[index]]));
    let changed = false;
    const next = this.breakpoints.map((breakpoint) => {
      const line = replacements.get(breakpoint.id) ?? breakpoint.line;
      if (line === breakpoint.line) return breakpoint;
      changed = true;
      return { ...breakpoint, line };
    });
    if (changed) {
      this.breakpoints = dedupeBreakpoints(next);
      if (this.active) {
        this.scheduleRelocatedBreakpoints(
          this.breakpoints.filter((breakpoint) => replacements.has(breakpoint.id)),
        );
      }
    }
  }

  private scheduleRelocatedBreakpoints(breakpoints: DebugBreakpointInput[]): void {
    for (const breakpoint of breakpoints) this.relocatedBreakpoints.set(breakpoint.id, breakpoint);
    if (this.relocationTimer) clearTimeout(this.relocationTimer);
    this.relocationTimer = setTimeout(() => {
      this.relocationTimer = undefined;
      const pending = [...this.relocatedBreakpoints.values()];
      this.relocatedBreakpoints.clear();
      void this.syncRelocatedBreakpoints(pending);
    }, 120);
  }

  private async syncRelocatedBreakpoints(breakpoints: DebugBreakpointInput[]): Promise<void> {
    if (!breakpoints.length || !this.active) return;
    if (this.busy || this.breakpointBusy) {
      this.scheduleRelocatedBreakpoints(breakpoints);
      return;
    }
    this.breakpointBusy = true;
    try {
      for (const breakpoint of breakpoints) await this.pushBreakpoint(breakpoint);
    } finally {
      this.breakpointBusy = false;
    }
  }

  private syncGutter(): void {
    this.editor.setBreakpointLocations(
      dedupeBreakpoints(this.breakpoints).filter((breakpoint) => breakpoint.enabled),
    );
  }

  private appendConsole(text: string): void {
    if (!text) return;
    this.consoleBuffer.enqueue(text);
    if (!this.consoleTimer) {
      this.consoleTimer = setTimeout(() => {
        this.consoleTimer = undefined;
        this.console = this.consoleBuffer.flush(this.console);
      }, OUTPUT_FLUSH_INTERVAL_MS);
    }
  }

  private async revealSelectedFrame(): Promise<void> {
    if (!this.stopped) return;
    const frame = this.frames.find((candidate) => candidate.level === this.selectedFrame);
    const path = debugFramePath(frame?.fullName || frame?.file || "", this.debugSourcePath);
    if (!path || !frame?.line) return;
    await this.editor.revealDebugLocation(path, frame.line);
  }
}

function parentDirectory(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "") || path;
}

function debugFramePath(path: string, sourcePath: string): string {
  if (!path || !sourcePath || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\") || path.startsWith("/")) {
    return path;
  }
  if (path.split(/[\\/]/).pop()?.toLocaleLowerCase() === sourcePath.split(/[\\/]/).pop()?.toLocaleLowerCase()) {
    return sourcePath;
  }
  const separator = sourcePath.includes("\\") ? "\\" : "/";
  return `${parentDirectory(sourcePath)}${separator}${path.replace(/^[\\/]+/, "")}`;
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll("/", "\\").toLocaleLowerCase()
    === right.replaceAll("/", "\\").toLocaleLowerCase();
}

function sameBreakpoint(left: DebugBreakpoint, right: DebugBreakpoint): boolean {
  return left.id === right.id
    && samePath(left.file, right.file)
    && left.line === right.line
    && left.enabled === right.enabled
    && left.condition === right.condition
    && left.verified === right.verified
    && left.message === right.message
    && left.gdbNumber === right.gdbNumber;
}

function sameBreakpointLists(left: DebugBreakpoint[], right: DebugBreakpoint[]): boolean {
  return left.length === right.length
    && left.every((breakpoint, index) => sameBreakpoint(breakpoint, right[index]));
}

function breakpointLocationKey(
  breakpoint: Pick<DebugBreakpointInput, "file" | "line">,
): string {
  return `${breakpoint.file.replaceAll("/", "\\").toLocaleLowerCase()}:${breakpoint.line}`;
}

function dedupeBreakpoints(breakpoints: readonly DebugBreakpoint[]): DebugBreakpoint[] {
  const locations = new Set<string>();
  const result: DebugBreakpoint[] = [];
  for (let index = breakpoints.length - 1; index >= 0; index -= 1) {
    const breakpoint = breakpoints[index];
    const location = breakpointLocationKey(breakpoint);
    if (locations.has(location)) continue;
    locations.add(location);
    result.unshift(breakpoint);
  }
  return result;
}

function stepLabel(kind: DebugStepKind): string {
  if (kind === "over") return "单步跳过";
  if (kind === "into") return "单步进入";
  return "单步跳出";
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const value = error as { userMessage?: unknown; technicalMessage?: unknown };
    if (typeof value.technicalMessage === "string" && value.technicalMessage.includes("debugger:")) {
      return value.technicalMessage.replace(/^.*debugger:\s*/, "");
    }
    if (typeof value.userMessage === "string") return value.userMessage;
    if (typeof value.technicalMessage === "string") return value.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
