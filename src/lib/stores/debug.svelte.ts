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

export class DebugStore {
  state = $state<DebugSessionState>("idle");
  sessionId = $state("");
  reason = $state("");
  busy = $state(false);
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
    return this.state !== "idle";
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
    this.consoleBuffer.clear();
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
    await this.control(continueDebugSession);
  }

  async pause(): Promise<void> {
    await this.control(pauseDebugSession);
  }

  async stepOver(): Promise<void> {
    await this.control(stepOverDebugSession);
  }

  async stepInto(): Promise<void> {
    await this.control(stepIntoDebugSession);
  }

  async stepOut(): Promise<void> {
    await this.control(stepOutDebugSession);
  }

  async restart(): Promise<void> {
    await this.control(restartDebugSession, true);
  }

  async stop(): Promise<void> {
    if (this.busy || this.state === "idle") return;
    this.busy = true;
    try {
      this.applySnapshot(await stopDebugSession());
      this.sessionId = "";
      this.variables = [];
      this.frames = [];
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.stopped || this.busy) return;
    const request = ++this.sequence;
    try {
      const snapshot = await getDebugSnapshot(
        this.selectedFrame,
        this.watches.map((watch) => watch.expression),
      );
      if (request === this.sequence && this.state === "stopped") this.applySnapshot(snapshot);
    } catch (error) {
      if (request === this.sequence) this.error = errorMessage(error);
    }
  }

  async selectFrame(level: number): Promise<void> {
    if (!this.stopped || level === this.selectedFrame) return;
    this.selectedFrame = level;
    await this.refresh();
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
    const existing = this.breakpoints.find(
      (breakpoint) => samePath(breakpoint.file, file) && breakpoint.line === line,
    );
    if (existing) {
      this.breakpoints = this.breakpoints.filter((breakpoint) => breakpoint.id !== existing.id);
      this.syncGutter();
      if (this.active) {
        try {
          await removeDebugBreakpoint(existing.id);
        } catch (error) {
          this.error = errorMessage(error);
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
    this.breakpoints = [...this.breakpoints, breakpoint];
    this.syncGutter();
    if (this.active) await this.pushBreakpoint(input);
  }

  async updateBreakpoint(id: string, patch: Partial<Pick<DebugBreakpoint, "enabled" | "condition">>): Promise<void> {
    const existing = this.breakpoints.find((breakpoint) => breakpoint.id === id);
    if (!existing) return;
    const next = { ...existing, ...patch, verified: false, message: "" };
    if (sameBreakpoint(existing, next)) return;
    this.breakpoints = this.breakpoints.map((breakpoint) => breakpoint.id === id ? next : breakpoint);
    this.syncGutter();
    if (this.active) await this.pushBreakpoint(next);
  }

  clearConsole(): void {
    if (this.consoleTimer) clearTimeout(this.consoleTimer);
    this.consoleTimer = undefined;
    this.consoleBuffer.clear();
    this.console = "";
  }

  private async start(stdin: string, testcaseName = ""): Promise<void> {
    if (this.active || this.busy) return;
    this.busy = true;
    this.error = "";
    this.clearConsole();
    this.state = "starting";
    this.reason = testcaseName ? `正在调试测试点“${testcaseName}”` : "正在准备调试";
    const sourcePath = this.editor.activeTab?.path;
    try {
      const compiled = await this.execution.compileCurrent("debug");
      if (!compiled?.success || !compiled.executablePath || !sourcePath) {
        this.state = "idle";
        this.error = this.execution.error || "调试编译失败。";
        return;
      }
      this.shell.activeActivity = "debug";
      this.shell.sidebarVisible = true;
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
      if (snapshot.state === "stopped") queueMicrotask(() => void this.refresh());
    } catch (error) {
      this.state = "error";
      this.error = errorMessage(error);
      this.reason = this.error;
      this.appendConsole(`[调试] ${this.error}\n`);
    } finally {
      this.busy = false;
    }
  }

  private async control(action: () => Promise<DebugSessionSnapshot>, restarting = false): Promise<void> {
    if (this.busy || !this.active) return;
    this.busy = true;
    this.error = "";
    if (restarting) {
      this.state = "starting";
      this.reason = "正在重新启动";
    }
    try {
      this.applySnapshot(await action());
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  private async pushBreakpoint(input: DebugBreakpointInput): Promise<void> {
    try {
      const saved = await setDebugBreakpoint(input);
      this.mergeBreakpoints([saved]);
    } catch (error) {
      this.error = errorMessage(error);
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
      this.mergeBreakpoints(event.breakpoints);
      return;
    }
    this.state = event.state;
    this.reason = event.reason;
    if (event.state === "stopped") {
      this.selectedFrame = 0;
      queueMicrotask(() => void this.refresh());
    } else if (event.state === "running") {
      this.error = "";
    } else if (event.state === "exited") {
      this.variables = [];
      this.frames = [];
    }
  }

  private applySnapshot(snapshot: DebugSessionSnapshot): void {
    if (snapshot.sessionId) this.sessionId = snapshot.sessionId;
    this.state = snapshot.state;
    this.reason = snapshot.reason;
    this.selectedFrame = snapshot.selectedFrame;
    this.frames = snapshot.frames;
    this.variables = snapshot.variables;
    this.mergeBreakpoints(snapshot.breakpoints);
    const values = new Map(snapshot.watches.map((watch) => [watch.expression, watch]));
    this.watches = this.watches.map((watch) => ({ ...watch, ...(values.get(watch.expression) ?? {}) }));
  }

  private mergeBreakpoints(incoming: DebugBreakpoint[]): void {
    if (!incoming.length) return;
    const byId = new Map(incoming.map((breakpoint) => [breakpoint.id, breakpoint]));
    let changed = false;
    const existingIds = new Set(this.breakpoints.map((breakpoint) => breakpoint.id));
    const next = this.breakpoints.map((breakpoint) => {
      const replacement = byId.get(breakpoint.id);
      if (!replacement || sameBreakpoint(breakpoint, replacement)) return breakpoint;
      changed = true;
      return replacement;
    });
    for (const breakpoint of incoming) {
      if (existingIds.has(breakpoint.id)) continue;
      existingIds.add(breakpoint.id);
      next.push(breakpoint);
      changed = true;
    }
    if (!changed) return;
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
    if (changed) this.breakpoints = next;
  }

  private syncGutter(): void {
    this.editor.setBreakpointLocations(
      this.breakpoints.filter((breakpoint) => breakpoint.enabled),
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
}

function parentDirectory(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "") || path;
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
