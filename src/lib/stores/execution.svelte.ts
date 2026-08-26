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
  updateTestcase,
} from "../api/execution";
import type { EditorWorkspace } from "../editor/workspace.svelte";
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
  error = $state("");
  compiling = $state(false);
  running = $state(false);
  stopping = $state(false);
  loadingTestcases = $state(false);

  private unlisten: UnlistenFn | undefined;
  private testcaseRequest = 0;
  private runSequence = 0;
  private activeClientRunId = "";
  private streamReceived = false;
  private readonly outputBuffer = new BoundedOutputBuffer(
    FRONTEND_OUTPUT_LIMIT,
    "[较早的输出因界面容量限制已被丢弃]\n",
  );
  private outputTimer: ReturnType<typeof setTimeout> | undefined;
  private truncationNoticeQueued = false;
  private disposed = false;

  get approximateOutputBytes(): number {
    return this.outputBuffer.approximateLength(this.output) * 2;
  }

  constructor(
    private readonly editor: EditorWorkspace,
    private readonly settings: SettingsStore,
    private readonly shell: ShellStore,
    private readonly onSuccessfulCompile?: (sourcePath: string) => void,
  ) {}

  async initialize(): Promise<void> {
    if (!isTauri()) return;
    try {
      const unlisten = await listen<RunnerOutputBatch>("runner-output", (event) => {
        recordIpcEvent();
        if (event.payload.clientRunId !== this.activeClientRunId) return;
        this.streamReceived = true;
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
    this.unlisten?.();
    this.unlisten = undefined;
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = undefined;
    this.outputBuffer.clear();
  }

  async syncActiveSource(sourcePath?: string, force = false): Promise<void> {
    const source = sourcePath ?? "";
    if (!force && source === this.sourcePath && (this.testcases.length > 0 || !source)) return;
    this.sourcePath = source;
    this.results = [];
    if (!source) {
      this.testcases = [];
      return;
    }
    const request = ++this.testcaseRequest;
    this.loadingTestcases = true;
    this.error = "";
    try {
      const testcases = await listTestcases(source);
      if (request === this.testcaseRequest) this.testcases = testcases;
    } catch (error) {
      if (request === this.testcaseRequest) this.error = errorMessage(error);
    } finally {
      if (request === this.testcaseRequest) this.loadingTestcases = false;
    }
  }

  async saveTestcase(input: TestcaseInput, id?: number): Promise<Testcase | undefined> {
    this.error = "";
    try {
      const saved = id ? await updateTestcase(id, input) : await createTestcase(input);
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

  async compileCurrent(profile: CompileProfile = "release"): Promise<CompileResult | undefined> {
    if (this.compiling || this.running) return undefined;
    const sourcePath = await this.prepareSource();
    if (!sourcePath) return undefined;
    return this.compileSource(sourcePath, profile, true);
  }

  async runCurrent(): Promise<void> {
    if (this.compiling || this.running) return;
    const sourcePath = await this.prepareSource();
    if (!sourcePath) return;
    this.results = [];
    this.clearOutput();
    const compiled = await this.compileSource(sourcePath, "release", false);
    if (!compiled?.success || !compiled.executablePath) return;
    this.shell.showBottomPanel("output");
    this.appendOutput(`\n[运行] ${fileName(sourcePath)}\n`);
    await this.execute(compiled.executablePath, sourcePath, "");
  }

  async runInput(stdin: string, label = "随机数据"): Promise<void> {
    if (this.compiling || this.running) return;
    const sourcePath = await this.prepareSource();
    if (!sourcePath) return;
    this.results = [];
    this.clearOutput();
    const compiled = await this.compileSource(sourcePath, "release", false);
    if (!compiled?.success || !compiled.executablePath) return;
    this.shell.showBottomPanel("output");
    this.appendOutput(`\n[运行] ${label}\n`);
    await this.execute(compiled.executablePath, sourcePath, stdin);
  }

  async runOne(testcase: Testcase): Promise<void> {
    if (this.compiling || this.running) return;
    const sourcePath = await this.prepareSource();
    if (!sourcePath) return;
    this.clearOutput();
    const compiled = await this.compileSource(sourcePath, "release", false);
    if (!compiled?.success || !compiled.executablePath) {
      this.setResult(compileFailureResult(testcase));
      this.shell.showBottomPanel("tests");
      return;
    }
    this.shell.showBottomPanel("tests");
    await this.executeTestcase(compiled.executablePath, sourcePath, testcase);
  }

  async runAll(): Promise<void> {
    if (this.compiling || this.running) return;
    const sourcePath = await this.prepareSource();
    if (!sourcePath) return;
    await this.syncActiveSource(sourcePath);
    const enabled = this.testcases.filter((testcase) => testcase.enabled);
    if (!enabled.length) {
      this.error = "请至少添加或启用一个测试点后再全部运行。";
      return;
    }
    this.results = [];
    this.clearOutput();
    const compiled = await this.compileSource(sourcePath, "release", false);
    this.shell.showBottomPanel("tests");
    if (!compiled?.success || !compiled.executablePath) {
      this.results = enabled.map(compileFailureResult);
      return;
    }

    for (const testcase of enabled) {
      const result = await this.executeTestcase(compiled.executablePath, sourcePath, testcase);
      if (result?.status === "Stopped") {
        for (const pending of enabled.slice(enabled.indexOf(testcase) + 1)) {
          this.setResult({ ...emptyResult(pending), status: "Stopped" });
        }
        break;
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.running || this.stopping) return;
    this.stopping = true;
    try {
      await stopProgram();
    } catch (error) {
      this.error = errorMessage(error);
    }
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
    const source = this.sourcePath;
    this.sourcePath = "";
    await this.syncActiveSource(source);
  }

  private async prepareSource(): Promise<string | undefined> {
    const tab = this.editor.activeTab;
    if (!tab?.path) {
      this.error = "请先在当前工作区中打开或创建一个实际的 C++ 文件。";
      return undefined;
    }
    if (!tab.path.toLowerCase().endsWith(".cpp")) {
      this.error = "当前文件不是 .cpp 源文件。";
      return undefined;
    }
    if (tab.dirty && !(await this.editor.saveActive())) {
      this.error = this.editor.notice;
      return undefined;
    }
    this.error = "";
    return tab.path;
  }

  private async compileSource(
    sourcePath: string,
    profile: CompileProfile,
    clearOutput: boolean,
  ): Promise<CompileResult | undefined> {
    this.compiling = true;
    this.error = "";
    if (clearOutput) this.clearOutput();
    this.shell.showBottomPanel("output");
    this.appendOutput(`[编译] ${fileName(sourcePath)} · ${profile === "release" ? "发布模式" : "调试模式"}\n`);
    const settings = this.settings.value;
    try {
      const result = await compileCurrentFile({
        sourcePath,
        profile,
        config: {
          compilerPath: settings.compilerPath,
          standard: settings.compilerStandard,
          releaseArgs: [...settings.releaseArgs],
          debugArgs: [...settings.debugArgs],
          maxOutputBytes: settings.maxOutputBytes,
        },
      });
      this.compileResult = result;
      if (result.success) this.onSuccessfulCompile?.(sourcePath);
      this.appendOutput(result.stdout);
      this.appendOutput(result.stderr);
      this.appendOutput(
        `[编译] ${result.success ? "成功" : "失败"}，耗时 ${result.durationMs}ms`
          + `${result.exitCode === undefined ? "" : ` · 退出码 ${result.exitCode}`}\n`,
      );
      if (result.outputTruncated) this.appendTruncationNotice();
      return result;
    } catch (error) {
      this.error = errorMessage(error);
      this.appendOutput(`[编译] ${this.error}\n`);
      return undefined;
    } finally {
      this.compiling = false;
    }
  }

  private async executeTestcase(
    executablePath: string,
    sourcePath: string,
    testcase: Testcase,
  ): Promise<TestcaseResult | undefined> {
    this.setResult({ ...emptyResult(testcase), status: "Running" });
    this.appendOutput(`\n[测试] ${testcase.name}\n`);
    const run = await this.execute(executablePath, sourcePath, testcase.input);
    if (!run) return undefined;
    let status: TestcaseStatus;
    if (run.status === "timedOut") status = "TLE";
    else if (run.status === "stopped") status = "Stopped";
    else if (run.exitCode !== 0) status = "RE";
    else status = await compareTestcaseOutput(run.stdout, testcase.expectedOutput) ? "AC" : "WA";
    const result: TestcaseResult = {
      testcaseId: testcase.id,
      name: testcase.name,
      status,
      durationMs: run.durationMs,
      actualOutput: run.stdout,
      expectedOutput: testcase.expectedOutput,
      stderr: run.stderr,
      exitCode: run.exitCode,
    };
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
    this.streamReceived = false;
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
      if (!this.streamReceived) {
        this.appendOutput(result.stdout);
        this.appendOutput(result.stderr);
      }
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

function compileFailureResult(testcase: Testcase): TestcaseResult {
  return { ...emptyResult(testcase), status: "CE" };
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
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
