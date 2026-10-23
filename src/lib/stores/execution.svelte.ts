import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  compareTestcaseOutput,
  compileCurrentFile,
  createTestcase,
  deleteTestcase,
  duplicateTestcase,
  listTestcases,
  moveTestcase,
  runProgram,
  stopProgram,
  stopCompilation,
  updateTestcase,
} from "../api/execution";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import { buildContentHash, buildPathKey } from "../editor/buildInputs";
import type {
  CompileProfile,
  CompileResult,
  RunRequest,
  RunResult,
  RunnerOutputBatch,
  Testcase,
  TestcaseInput,
  TestcaseResult,
  TestcaseStatus,
} from "../types/execution";
import type { SettingsStore } from "./settings.svelte";
import type { ShellStore } from "./shell.svelte";
import { recordIpcEvent } from "../performance";
import { BoundedOutputBuffer, OUTPUT_FLUSH_INTERVAL_MS } from "../outputBuffer";

const FRONTEND_OUTPUT_LIMIT = 16 * 1024 * 1024;

export class ExecutionStore {
  testcases = $state.raw<Testcase[]>([]);
  results = $state.raw<TestcaseResult[]>([]);
  compileResult = $state<CompileResult>();
  sourcePath = $state("");
  output = $state("");
  buildDetails = $state("");
  error = $state("");
  busy = $state(false);
  profile = $state<CompileProfile>("release");
  compiling = $state(false);
  running = $state(false);
  stopping = $state(false);
  loadingTestcases = $state(false);

  private unlisten: UnlistenFn | undefined;
  private testcaseRequest = 0;
  private testcaseLoad: Promise<void> | undefined;
  private loadedTestcaseSource: string | undefined;
  private runSequence = 0;
  private taskSequence = 0;
  private clientTaskId = "";
  private activeClientRunId = "";
  private externalBusy: ((allowDebug: boolean) => boolean) | undefined;
  private readonly outputBuffer = new BoundedOutputBuffer(
    FRONTEND_OUTPUT_LIMIT,
    "[较早的输出因界面容量限制已被丢弃]\n",
  );
  private outputTimer: ReturnType<typeof setTimeout> | undefined;
  private truncationNoticeQueued = false;
  private disposed = false;
  private compileCancelled = false;
  private beforeTestRun: ((testcaseId?: number) => Promise<Testcase | false | undefined>) | undefined;

  get approximateOutputBytes(): number {
    return this.outputBuffer.approximateLength(this.output) * 2;
  }

  constructor(
    private readonly editor: EditorWorkspace,
    private readonly settings: SettingsStore,
    private readonly shell: ShellStore,
    private readonly onCompileResult?: (sourcePath: string, result: CompileResult, snapshot?: { text: string; revision: number; dirty: boolean; documents?: { path: string; revision: number }[] }) => void,
  ) {}

  async initialize(): Promise<void> {
    if (!isTauri()) return;
    try {
      const unlisten = await listen<RunnerOutputBatch>("runner-output", (event) => {
        recordIpcEvent();
        if (event.payload.clientRunId !== this.activeClientRunId) return;
        this.appendOutput(event.payload.stdout);
        this.appendOutput(event.payload.stderr);
        if (event.payload.outputTruncated) this.appendTruncationNotice();
      });
      if (this.disposed) unlisten();
      else this.unlisten = unlisten;
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.compiling) void stopCompilation(this.clientTaskId).catch(() => undefined);
    if (this.running) void stopProgram(this.activeClientRunId).catch(() => undefined);
    this.unlisten?.();
    this.unlisten = undefined;
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = undefined;
    this.outputBuffer.clear();
  }

  setBeforeTestRun(
    handler: (testcaseId?: number) => Promise<Testcase | false | undefined>,
  ): () => void {
    this.beforeTestRun = handler;
    return () => {
      if (this.beforeTestRun === handler) this.beforeTestRun = undefined;
    };
  }

  async syncActiveSource(sourcePath?: string, force = false): Promise<void> {
    const source = sourcePath ?? "";
    if (!force && source === this.sourcePath) {
      if (this.testcaseLoad) return this.testcaseLoad;
      if (this.loadedTestcaseSource === source) return;
    }
    const changed = source !== this.sourcePath;
    this.sourcePath = source;
    const request = ++this.testcaseRequest;
    this.loadedTestcaseSource = undefined;
    this.testcaseLoad = undefined;
    if (changed) { this.results = []; this.testcases = []; }
    if (!source) {
      this.testcases = [];
      this.loadingTestcases = false;
      this.loadedTestcaseSource = source;
      return;
    }
    this.loadingTestcases = true;
    this.error = "";
    const pending = (async () => { try {
      const testcases = await listTestcases(source);
      if (request === this.testcaseRequest && !this.disposed) {
        this.testcases = testcases;
        this.loadedTestcaseSource = source;
      }
    } catch (error) {
      if (request === this.testcaseRequest) this.error = errorMessage(error);
    } finally {
      if (request === this.testcaseRequest) { this.loadingTestcaseComplete(); }
    } })();
    this.testcaseLoad = pending;
    return pending;
  }

  private loadingTestcaseComplete(): void {
    this.loadingTestcases = false;
    this.testcaseLoad = undefined;
  }

  async saveTestcase(input: TestcaseInput, id?: number): Promise<Testcase | undefined> {
    this.error = "";
    try {
      const saved = id ? await updateTestcase(id, input) : await createTestcase(input);
      if (id) {
        this.results = this.results.filter((result) => result.testcaseId !== id);
      }
      await this.reloadTestcases();
      return saved;
    } catch (error) {
      this.error = errorMessage(error);
      return undefined;
    }
  }

  async duplicate(id: number): Promise<void> {
    try {
      await duplicateTestcase(id);
      await this.reloadTestcases();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async remove(id: number): Promise<void> {
    try {
      await deleteTestcase(id);
      this.results = this.results.filter((result) => result.testcaseId !== id);
      await this.reloadTestcases();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async move(id: number, targetIndex: number): Promise<void> {
    try {
      await moveTestcase(id, targetIndex);
      await this.reloadTestcases();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  setExternalBusy(check: (allowDebug: boolean) => boolean): void {
    this.externalBusy = check;
  }

  private async task<T>(action: () => Promise<T>, allowDebug = false): Promise<T | undefined> {
    if (this.busy || this.compiling || this.running || this.disposed || this.externalBusy?.(allowDebug)) return undefined;
    this.busy = true;
    this.clientTaskId = `compile-${Date.now()}-${++this.taskSequence}`;
    this.compileCancelled = false;
    this.compileResult = undefined;
    this.buildDetails = "";
    try { return await action(); }
    catch (error) {
      this.error = errorMessage(error);
      this.shell.showBottomPanel("output");
      this.appendOutput(`[任务] ${this.error}\n`);
      return undefined;
    } finally {
      this.busy = false;
      this.compiling = false;
      this.running = false;
      this.stopping = false;
    }
  }

  async compileCurrent(profile: CompileProfile = "release", allowDebug = false): Promise<CompileResult | undefined> {
    return this.task(async () => {
      this.compiling = true;
      const source = await this.prepareSource();
      return source ? this.compileSource(source, profile, true) : undefined;
    }, allowDebug);
  }

  async runCurrent(): Promise<void> { await this.runInput("", "当前程序"); }

  async runInput(stdin: string, label = "随机数据", expectedSourcePath?: string): Promise<RunResult | undefined> {
    return this.task(async () => {
      if (expectedSourcePath && this.editor.activeTab?.path !== expectedSourcePath) {
        return this.preflightFailure("当前代码文件已切换，请回到原文件后再运行。");
      }
      this.compiling = true;
      const source = await this.prepareSource();
      if (!source) return;
      this.results = [];
      this.clearOutput();
      const compiled = await this.compileSource(source, "release", false);
      this.compiling = false;
      if (!compiled?.success || !compiled.executablePath || this.compileCancelled) return;
      this.appendOutput(`\n[运行] ${label}\n`);
      return this.execute(compiled.executablePath, source, stdin);
    });
  }

  async runOne(testcase: Testcase): Promise<void> {
    await this.task(async () => {
      this.compiling = true;
      const prepared = await this.beforeTestRun?.(testcase.id);
      if (prepared === false) return;
      if (prepared) testcase = prepared;
      if (this.editor.activeTab?.path !== testcase.sourcePath) {
        return this.preflightFailure("测试点所属文件与当前文件不一致，请回到原文件后再运行。");
      }
      const source = await this.prepareSource();
      if (!source) return;
      if (source !== testcase.sourcePath) return;
      this.clearOutput();
      const compiled = await this.compileSource(source, "release", false);
      this.compiling = false;
      if (!compiled?.success || !compiled.executablePath || this.compileCancelled) {
        this.setResult({ ...emptyResult(testcase), status: this.compileCancelled ? "Stopped" : this.error || isToolchainFailure(compiled) ? "Error" : "CE", stderr: this.error || compileFailureText(compiled) });
        return;
      }
      await this.executeTestcase(compiled.executablePath, source, testcase);
    });
  }

  async runAll(): Promise<void> {
    await this.task(async () => {
      this.compiling = true;
      if (await this.beforeTestRun?.() === false) return;
      const source = await this.prepareSource();
      if (!source) return;
      await this.syncActiveSource(source);
      if (this.sourcePath !== source || this.editor.activeTab?.path !== source || this.compileCancelled) return;
      const enabled = this.testcases.filter((testcase) => testcase.enabled);
      if (!enabled.length) return this.preflightFailure("请至少添加或启用一个测试点后再全部运行。");
      this.results = [];
      this.clearOutput();
      const compiled = await this.compileSource(source, "release", false);
      this.compiling = false;
      if (!compiled?.success || !compiled.executablePath || this.compileCancelled) {
        this.results = enabled.map((testcase) => ({ ...emptyResult(testcase), status: this.compileCancelled ? "Stopped" : this.error || isToolchainFailure(compiled) ? "Error" : "CE", stderr: this.error || compileFailureText(compiled) }));
        return;
      }
      for (let index = 0; index < enabled.length; index++) {
        const testcase = enabled[index];
        const result = this.compileCancelled ? { ...emptyResult(testcase), status: "Stopped" as const }
          : await this.executeTestcase(compiled.executablePath, source, testcase);
        if (this.compileCancelled || result.status === "Stopped" || result.status === "Error") {
          for (const pending of enabled.slice(index + 1)) this.setResult({ ...emptyResult(pending), status: "Stopped" });
          if (this.compileCancelled) this.setResult({ ...result, status: "Stopped" });
          break;
        }
      }
    });
  }

  async stop(): Promise<void> {
    if ((!this.busy && !this.running && !this.compiling) || this.stopping) return;
    this.stopping = true;
    this.compileCancelled = true;
    try { await Promise.all([stopProgram(this.activeClientRunId), stopCompilation(this.clientTaskId)]); }
    catch (error) { this.error = errorMessage(error); }
  }

  clearOutput(): void {
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = undefined;
    this.outputBuffer.clear();
    this.truncationNoticeQueued = false;
    this.output = "";
    this.error = "";
  }

  private async reloadTestcases(): Promise<void> {
    await this.syncActiveSource(this.sourcePath, true);
  }

  private async prepareSource(): Promise<string | undefined> {
    const tab = this.editor.activeTab;
    if (!tab?.path) {
      return this.preflightFailure("请先在当前工作区中打开或创建一个实际的 C++ 文件。");
    }
    if (!tab.path.toLowerCase().endsWith(".cpp")) {
      return this.preflightFailure("当前文件不是 .cpp 源文件。");
    }
    if (tab.dirty) {
      const saved = await this.editor.saveActive();
      if (this.compileCancelled || this.disposed) return undefined;
      if (!saved) return this.preflightFailure(this.editor.notice || "源码保存失败，请保存后重新编译。");
    }
    if (this.editor.activeTab?.path !== tab.path || this.editor.sourceSnapshot?.(tab.path)?.dirty) {
      return this.preflightFailure("保存期间文件已切换或再次修改，请保存后重新运行。");
    }
    this.error = "";
    return tab.path;
  }

  private preflightFailure(message: string): undefined {
    this.error = message;
    this.shell.showBottomPanel("output");
    this.appendOutput(`[任务] ${message}\n`);
    return undefined;
  }

  private async compileSource(
    sourcePath: string,
    profile: CompileProfile,
    clearOutput: boolean,
  ): Promise<CompileResult | undefined> {
    if (this.compileCancelled || this.disposed) {
      this.stopping = false;
      return undefined;
    }
    this.profile = profile;
    this.compileResult = undefined;
    this.error = "";
    const sourceSnapshot = this.editor.sourceSnapshot?.(sourcePath);
    const inputVersion = this.editor.buildInputVersion?.();
    let snapshot = sourceSnapshot ? { ...sourceSnapshot, documents: [{ path: sourcePath, revision: sourceSnapshot.revision }] } : undefined;
    if (clearOutput) this.clearOutput();
    this.shell.showBottomPanel("output");
    this.appendOutput(`[编译] ${fileName(sourcePath)} · ${profile === "release" ? "发布模式" : "调试模式"}\n`);
    const config = this.compilerConfiguration();
    const configuration = JSON.stringify(config);
    this.buildDetails = JSON.stringify({ sourcePath, profile, ...config }, null, 2);
    try {
      let result = await compileCurrentFile({
        sourcePath,
        clientTaskId: this.clientTaskId,
        expectedSource: snapshot?.text,
        reuseArtifact: !clearOutput && profile === "release",
        profile,
        config,
      });
      if (configuration !== JSON.stringify(this.compilerConfiguration())) {
        this.error = "编译期间配置已更改，请重新编译。";
        this.appendOutput(`[编译] ${this.error}\n`);
        return undefined;
      }
      const dependencies = result.dependencies ?? [{ path: sourcePath }];
      const checked = new Map<string, { path: string; text: string; revision: number }>();
      for (const dependency of dependencies) {
        if (buildPathKey(dependency.path) === buildPathKey(sourcePath)) continue;
        const state = this.editor.sourceSnapshot?.(dependency.path);
        if (!state) continue;
        if (state.dirty) {
          this.error = `请先保存相关头文件 ${fileName(dependency.path)}，再编译运行。`;
          this.appendOutput(`[编译] ${this.error}\n`);
          return undefined;
        }
        checked.set(buildPathKey(dependency.path), { path: dependency.path, ...state });
        if (dependency.contentHash && await buildContentHash(state.text) !== dependency.contentHash) {
          this.error = "编译期间相关文件已修改，本次结果已过期，请重新运行。";
          this.appendOutput(`[编译] ${this.error}\n`);
          return undefined;
        }
      }
      const dependencyChanged = dependencies.some((dependency) => {
        if (buildPathKey(dependency.path) === buildPathKey(sourcePath)) return false;
        const current = this.editor.sourceSnapshot?.(dependency.path);
        const verified = checked.get(buildPathKey(dependency.path));
        return current && (!verified || current.dirty || current.revision !== verified.revision || current.text !== verified.text);
      });
      const currentSnapshot = this.editor.sourceSnapshot?.(sourcePath);
      const externalInputChanged = inputVersion !== undefined && this.editor.buildInputsChangedSince?.(inputVersion, [sourcePath, ...dependencies.map((dependency) => dependency.path)]);
      if (result.sourceChanged || dependencyChanged || externalInputChanged || snapshot && (!currentSnapshot || currentSnapshot.revision !== snapshot.revision || currentSnapshot.text !== snapshot.text)) {
        this.error = "编译期间代码已修改，本次结果已过期，请重新运行。";
        this.appendOutput(`[编译] ${this.error}\n`);
        return undefined;
      }
      if (this.compileCancelled || this.disposed) return undefined;
      if (configuration !== JSON.stringify(this.compilerConfiguration())) {
        this.error = "编译期间配置已更改，请重新编译。";
        this.appendOutput(`[编译] ${this.error}\n`);
        return undefined;
      }
      if (snapshot) snapshot = { ...snapshot, documents: [
        { path: sourcePath, revision: snapshot.revision },
        ...[...checked.values()].flatMap((verified) => this.editor.sourceSnapshot(verified.path) ? [{ path: verified.path, revision: verified.revision }] : []),
      ] };
      const unverified = result.dependenciesComplete === false;
      if (unverified) {
        // Known dependencies were checked above, but unknown inputs must not
        // turn disk diagnostics into apparently verified editor locations.
        this.error = "无法完整确认本次构建的相关文件；请查看编译输出，保存相关文件后重新编译。";
        result = { ...result, success: false, executablePath: undefined, diagnostics: [{
          path: sourcePath, severity: 1, source: "构建", code: "dependencies_unverified", fileLevel: true, message: this.error,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        }] };
      }
      this.compileResult = result;
      if (result.command) this.buildDetails = JSON.stringify({ taskId: result.taskId, workingDirectory: result.workingDirectory, command: result.command }, null, 2);
      if (!this.compileCancelled && !this.disposed) this.onCompileResult?.(sourcePath, result, snapshot);
      this.appendOutput(result.stdout);
      if (unverified) this.appendOutput(result.stderr);
      this.appendOutput(result.diagnostics?.length
        ? result.diagnostics.map((d) => `[${d.severity === 1 ? "错误" : d.severity === 2 ? "警告" : "说明"}] ${d.fileLevel ? d.path : `${d.path}:${d.range.start.line + 1}:${d.range.start.character + 1}`} ${d.message}\n`).join("")
        : result.stderr);
      this.appendOutput(
        `[编译] ${result.success ? "成功" : "失败"}${result.cacheHit ? "（预处理校验通过，复用构建）" : ""}，耗时 ${result.durationMs}ms`
          + `${result.exitCode === undefined ? "" : ` · 退出码 ${result.exitCode}`}\n`,
      );
      if (result.outputTruncated) this.appendTruncationNotice();
      if (!result.success && !this.compileCancelled) this.shell.showBottomPanel("problems");
      return this.compileCancelled || this.disposed ? undefined : result;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "PROCESS_CANCELLED") this.compileCancelled = true;
      this.compileResult = undefined;
      const configurationChanged = configuration !== JSON.stringify(this.compilerConfiguration());
      this.error = this.compileCancelled ? "" : configurationChanged ? "编译期间配置已更改，请重新编译。" : errorMessage(error);
      if (!this.compileCancelled && !this.disposed && !configurationChanged) this.onCompileResult?.(sourcePath, {
        success: false, stdout: "", stderr: this.error, durationMs: 0, outputTruncated: false,
        diagnostics: [{ path: sourcePath, severity: 1, source: "工具链", code: code || "toolchain_error", fileLevel: true, message: this.error, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }],
      }, snapshot);
      this.appendOutput(`[编译] ${this.compileCancelled ? "已停止" : this.error}\n`);
      return undefined;
    } finally {
      this.stopping = false;
    }
  }

  private compilerConfiguration() {
    const settings = this.settings.value;
    return { compilerPath: settings.compilerPath, standard: settings.compilerStandard,
      releaseArgs: [...settings.releaseArgs], debugArgs: [...settings.debugArgs], maxOutputBytes: settings.maxOutputBytes };
  }

  private async executeTestcase(executablePath: string, sourcePath: string, testcase: Testcase): Promise<TestcaseResult> {
    this.setResult({ ...emptyResult(testcase), status: "Running" });
    this.appendOutput(`\n[测试] ${testcase.name}\n`);
    const run = await this.execute(executablePath, sourcePath, testcase.input);
    let status: TestcaseStatus;
    if (this.compileCancelled || run?.status === "stopped") status = "Stopped";
    else if (!run) status = "Error";
    else if (run.status === "timedOut") status = "TLE";
    else if (run.exitCode !== 0) status = "RE";
    else if (run.outputTruncated) status = "OLE";
    else if (!testcase.expectedOutput.trim()) status = "OK";
    else {
      try { status = await compareTestcaseOutput(run.stdout, testcase.expectedOutput) ? "AC" : "WA"; }
      catch (error) { this.error = errorMessage(error); status = "Error"; }
    }
    if (this.compileCancelled) status = "Stopped";
    const result: TestcaseResult = { testcaseId: testcase.id, name: testcase.name, status,
      durationMs: run?.durationMs ?? 0, actualOutput: run?.stdout ?? "", expectedOutput: testcase.expectedOutput,
      stderr: run?.stderr || this.error, exitCode: run?.exitCode };
    this.setResult(result);
    return result;
  }

  private async execute(
    executablePath: string,
    sourcePath: string,
    stdin: string,
  ): Promise<RunResult | undefined> {
    const clientRunId = `run-${Date.now()}-${++this.runSequence}`;
    this.activeClientRunId = clientRunId;
    if (this.compileCancelled || this.disposed) return undefined;
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.flushOutput();
    const outputPrefix = this.output;
    this.running = true;
    this.stopping = false;
    const request: RunRequest = {
      clientRunId,
      executablePath,
      arguments: [],
      workingDirectory: parentDirectory(sourcePath),
      stdin,
      timeoutMs: this.settings.value.runTimeoutMs,
      maxOutputBytes: this.settings.value.maxOutputBytes,
    };
    try {
      const result = await runProgram(request);
      if (this.outputTimer) clearTimeout(this.outputTimer);
      this.outputTimer = undefined;
      this.outputBuffer.clear();
      this.output = outputPrefix;
      this.appendOutput(result.stdout);
      this.appendOutput(result.stderr);
      this.appendOutput(
        `\n[运行] ${runLabel(result)} · ${result.durationMs}ms`
          + `${result.exitCode === undefined ? "" : ` · 退出码 ${result.exitCode}`}\n`,
      );
      if (result.outputTruncated) this.appendTruncationNotice();
      return result;
    } catch (error) {
      this.error = errorMessage(error);
      this.appendOutput(`[运行] ${this.error}\n`);
      return undefined;
    } finally {
      this.running = false;
      this.stopping = false;
      this.activeClientRunId = "";
    }
  }

  private setResult(result: TestcaseResult): void {
    const existing = this.results.findIndex((candidate) => candidate.testcaseId === result.testcaseId);
    this.results = existing < 0
      ? [...this.results, result]
      : this.results.map((candidate, index) => index === existing ? result : candidate);
  }

  private appendOutput(value: string): void {
    if (!value) return;
    this.outputBuffer.enqueue(value);
    if (!this.outputTimer) {
      this.outputTimer = setTimeout(() => this.flushOutput(), OUTPUT_FLUSH_INTERVAL_MS);
    }
  }

  private flushOutput(): void {
    this.outputTimer = undefined;
    this.output = this.outputBuffer.flush(this.output);
  }

  private appendTruncationNotice(): void {
    const notice = "\n[LightCP] 输出容量已达上限，后续内容已被丢弃。\n";
    if (this.truncationNoticeQueued) return;
    this.truncationNoticeQueued = true;
    this.appendOutput(notice);
  }
}

function emptyResult(testcase: Testcase): TestcaseResult {
  return {
    testcaseId: testcase.id,
    name: testcase.name,
    status: "Running",
    durationMs: 0,
    actualOutput: "",
    expectedOutput: testcase.expectedOutput,
    stderr: "",
  };
}

function compileFailureText(result?: CompileResult): string {
  return result?.diagnostics?.length ? result.diagnostics.map((item) =>
    `${item.fileLevel ? "构建任务" : `${fileName(item.path)}:${item.range.start.line + 1}:${item.range.start.character + 1}`} ${item.message}`,
  ).join("\n") : result?.stderr ?? "";
}

function isToolchainFailure(result?: CompileResult): boolean {
  return result?.diagnostics?.some((diagnostic) => diagnostic.source === "工具链") ?? false;
}

function runLabel(result: RunResult): string {
  if (result.status === "timedOut") return "运行超时";
  if (result.status === "stopped") return "已停止";
  return result.exitCode === 0 ? "运行完成" : "运行时错误";
}

function parentDirectory(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "") || path;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { userMessage?: unknown; technicalMessage?: unknown };
    if (typeof commandError.userMessage === "string") {
      return commandError.userMessage + (typeof commandError.technicalMessage === "string" ? `\n${commandError.technicalMessage}` : "");
    }
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
