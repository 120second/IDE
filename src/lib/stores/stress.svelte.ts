import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { chooseCppSource, chooseReplayFile, exportStressReplay, replayStressTest, startStressTest, stopStressTest } from "../api/stress";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type {
  StressEvent,
  StressCasePassed,
  StressFailure,
  StressLogEntry,
  StressRunRequest,
  StressStats,
  StressStatus,
  StressSummary,
} from "../types/stress";
import type { DebugStore } from "./debug.svelte";
import type { ExecutionStore } from "./execution.svelte";
import type { GeneratorStore } from "./generator.svelte";
import type { SettingsStore } from "./settings.svelte";
import type { ShellStore } from "./shell.svelte";
import { recordIpcEvent } from "../performance";

const MAX_LOG_ENTRIES = 500;
const EMPTY_STATS: StressStats = {
  totalCases: 0,
  passed: 0,
  failed: 0,
  elapsedMs: 0,
  casesPerSecond: 0,
};

export class StressStore {
  status = $state<StressStatus>("idle");
  sessionId = $state("");
  solutionPath = $state("");
  brutePath = $state("");
  iterations = $state(1000);
  infinite = $state(false);
  seed = $state("16574989564519419765");
  timeoutMs = $state(1000);
  message = $state("");
  error = $state("");
  running = $state(false);
  stopping = $state(false);
  logs = $state.raw<StressLogEntry[]>([]);
  stats = $state.raw<StressStats>({ ...EMPTY_STATS });
  failure = $state<StressFailure>();
  notice = $state("");
  exporting = $state(false);
  replayMode = $state(false);

  private unlisten: UnlistenFn | undefined;
  private sequence = 0;
  private disposed = false;
  private cancelRequested = false;
  private lastBrutePath = "";

  constructor(
    private readonly editor: EditorWorkspace,
    private readonly generator: GeneratorStore,
    private readonly execution: ExecutionStore,
    private readonly debuggerStore: DebugStore,
    private readonly settings: SettingsStore,
    private readonly shell: ShellStore,
  ) {
    this.seed = generator.seed;
    this.timeoutMs = settings.value.runTimeoutMs;
  }

  async initialize(): Promise<void> {
    if (!isTauri()) return;
    try {
      const unlisten = await listen<StressEvent>("stress-event", (event) => {
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
    this.cancelRequested = true;
    if (this.running) void stopStressTest().catch(() => undefined);
  }

  async chooseBrute(): Promise<void> {
    const selected = await chooseCppSource("选择暴力程序 C++ 源文件");
    if (selected) this.brutePath = selected;
  }

  randomizeSeed(): void {
    const words = new Uint32Array(2);
    crypto.getRandomValues(words);
    this.seed = ((BigInt(words[0]) << 32n) | BigInt(words[1])).toString();
  }

  openGenerator(): void {
    this.generator.requestEditor();
    this.shell.activeActivity = "testcases";
    this.shell.sidebarVisible = true;
  }

  async start(): Promise<void> {
    await this.launch(false);
  }

  async stop(): Promise<void> {
    if (!this.running || this.stopping) return;
    this.stopping = true;
    this.cancelRequested = true;
    try {
      await stopStressTest();
    } catch (error) {
      this.error = errorMessage(error);
      this.stopping = false;
    }
  }

  async continueAfterFailure(): Promise<void> {
    if (!this.failure || this.running || this.replayMode) return;
    if (!samePath(this.editor.activeTab?.path ?? "", this.solutionPath) || !samePath(this.brutePath, this.lastBrutePath)) {
      this.error = "待测程序或暴力程序已切换，请开始新的对拍。";
      return;
    }
    await this.launch(true);
  }

  async saveFailureAsTestcase(): Promise<void> {
    const failure = this.failure;
    if (!failure || !this.solutionPath || this.replayMode) return;
    await this.execution.syncActiveSource(this.solutionPath, true);
    const saved = await this.execution.saveTestcase({
      sourcePath: this.solutionPath,
      kind: "hack",
      name: `对拍反例 · #${failure.index} · 种子 ${failure.seed}`,
      input: failure.input,
      expectedOutput: failure.bruteOutput,
      enabled: true,
    });
    this.notice = saved ? "失败用例已保存为固定测试点。" : "";
  }

  async debugFailure(): Promise<void> {
    const failure = this.failure;
    if (!failure || this.running || this.debuggerStore.active || this.replayMode) return;
    if (!samePath(this.editor.activeTab?.path ?? "", this.solutionPath)) {
      await this.editor.openFile(this.solutionPath);
    }
    this.shell.activeActivity = "debug";
    this.shell.sidebarVisible = true;
    await this.debuggerStore.startInput(failure.input, `对拍反例 #${failure.index}`);
  }

  async copyFailureInput(): Promise<void> {
    if (!this.failure) return;
    try {
      await navigator.clipboard.writeText(this.failure.input);
      this.notice = "失败输入已复制。";
    } catch {
      this.notice = "复制失败，请从输入框手动复制。";
    }
  }

  clear(): void {
    if (this.running) return;
    this.logs = [];
    this.stats = { ...EMPTY_STATS };
    this.failure = undefined;
    this.status = "idle";
    this.message = "";
    this.error = "";
    this.notice = "";
    this.replayMode = false;
  }

  async exportReplay(): Promise<void> {
    const failure = this.failure;
    if (!failure?.replay || this.exporting || this.running) return;
    this.exporting = true;
    this.error = "";
    try {
      if (await exportStressReplay(failure)) this.notice = "重放包已导出，包含双方源码和完整输入输出。";
    } catch (error) { this.error = errorMessage(error); }
    finally { this.exporting = false; }
  }

  async importReplay(): Promise<void> {
    if (this.running || this.execution.running || this.execution.compiling || this.debuggerStore.active || this.disposed) return;
    this.running = true;
    this.cancelRequested = false;
    const previousStatus = this.status;
    let launched = false;
    try {
      const path = await chooseReplayFile();
      if (!path || this.cancelRequested || this.disposed) return;
      const sessionId = `replay-${Date.now()}-${++this.sequence}`;
      this.sessionId = sessionId;
      this.replayMode = true;
      this.failure = undefined;
      this.logs = [];
      this.stats = { ...EMPTY_STATS };
      this.error = this.notice = "";
      this.status = "compiling";
      this.message = "正在编译并重放保存的输入…";
      launched = true;
      const result = await replayStressTest(path, sessionId, this.settings.value.compilerPath);
      if (!this.disposed) this.applySummary(result);
    } catch (error) {
      this.status = "error";
      this.message = this.error = errorMessage(error);
      launched = true;
    } finally {
      if (!launched) this.status = previousStatus;
      this.running = this.stopping = false;
    }
  }

  private async launch(continuing: boolean): Promise<void> {
    if (this.running || this.execution.running || this.execution.compiling || this.debuggerStore.active || this.disposed) return;
    const active = this.editor.activeTab;
    if (!active?.path?.toLowerCase().endsWith(".cpp")) {
      this.error = "请先打开作为待测程序的工作区 .cpp 文件。";
      return;
    }
    if (!this.brutePath.toLowerCase().match(/\.(cpp|cc|cxx)$/)) {
      this.error = "请选择暴力程序 C++ 源文件。";
      return;
    }
    if (samePath(active.path, this.brutePath)) {
      this.error = "待测程序和暴力程序不能是同一个文件。";
      return;
    }
    if (this.generator.loading) {
      this.error = "正在加载当前文件的随机生成规则，请稍候。";
      return;
    }
    if (!this.generator.valid) {
      this.error = "当前随机生成规则存在错误，请先修正规则。";
      return;
    }
    if (!this.infinite && (!Number.isFinite(this.iterations) || this.iterations < 1)) {
      this.error = "迭代次数必须至少为 1。";
      return;
    }
    if (!/^\d+$/.test(this.seed) || BigInt(this.seed) > 18_446_744_073_709_551_615n) {
      this.error = "种子必须是 uint64 十进制整数。";
      return;
    }
    this.running = true;
    this.cancelRequested = false;
    this.stopping = false;
    try {
      if (active.dirty && !(await this.editor.saveActive())) {
        this.error = this.editor.notice;
        this.running = false;
        return;
      }
      if (this.cancelRequested || this.disposed || !samePath(this.editor.activeTab?.path ?? "", active.path)) {
        this.running = false;
        return;
      }
    } catch (error) {
      this.running = false;
      this.error = errorMessage(error);
      return;
    } finally {
      if (!this.running) this.stopping = false;
    }

    const previousFailure = continuing ? this.failure : undefined;
    const initialStats = previousFailure?.stats ?? { ...EMPTY_STATS };
    const startSeed = previousFailure?.nextSeed ?? this.seed;
    const sessionId = `stress-${Date.now()}-${++this.sequence}`;
    this.sessionId = sessionId;
    this.solutionPath = active.path;
    this.lastBrutePath = this.brutePath;
    this.replayMode = false;
    this.running = true;
    this.stopping = false;
    this.status = "compiling";
    this.message = continuing ? "正在继续对拍…" : "正在准备对拍…";
    this.error = "";
    this.notice = "";
    if (!continuing) {
      this.logs = [];
      this.stats = { ...EMPTY_STATS };
    }
    this.failure = undefined;

    const settings = this.settings.value;
    const request: StressRunRequest = {
      sessionId,
      solutionPath: active.path,
      brutePath: this.brutePath,
      generatorProfile: structuredClone(this.generator.profile),
      iterations: Math.min(10_000_000, Math.max(1, Math.trunc(this.iterations))),
      infinite: this.infinite,
      seed: startSeed,
      timeoutMs: Math.min(60_000, Math.max(50, Math.trunc(this.timeoutMs))),
      maxOutputBytes: settings.maxOutputBytes,
      compilerConfig: {
        compilerPath: settings.compilerPath,
        standard: settings.compilerStandard,
        releaseArgs: [...settings.releaseArgs],
        debugArgs: [...settings.debugArgs],
        maxOutputBytes: settings.maxOutputBytes,
      },
      startCase: initialStats.totalCases,
      initialPassed: initialStats.passed,
      initialFailed: initialStats.failed,
      initialElapsedMs: initialStats.elapsedMs,
    };
    try {
      const result = await startStressTest(request);
      if (!this.disposed) this.applySummary(result);
    } catch (error) {
      this.status = "error";
      this.error = errorMessage(error);
      this.message = this.error;
    } finally {
      if (this.sessionId === sessionId) {
        this.running = false;
        this.stopping = false;
      }
    }
  }

  private handleEvent(event: StressEvent): void {
    if (this.disposed || event.sessionId !== this.sessionId) return;
    if (event.kind === "state") {
      this.status = event.status;
      this.message = event.message;
      return;
    }
    if (event.kind === "casePassed") {
      this.appendPassed([event.result]);
      return;
    }
    if (event.kind === "casesPassed") {
      this.appendPassed(event.results);
      return;
    }
    this.failure = event.failure;
    this.stats = event.failure.stats;
    this.appendLog({
      status: "FAILED",
      index: event.failure.index,
      seed: event.failure.seed,
      reason: event.failure.reason,
    });
  }

  private applySummary(summary: StressSummary): void {
    if (summary.sessionId !== this.sessionId) return;
    this.status = summary.status;
    this.message = summary.message;
    this.stats = summary.stats;
    if (summary.failure || summary.replayResult) this.failure = summary.failure ?? summary.replayResult;
    this.seed = summary.nextSeed;
  }

  private appendLog(entry: StressLogEntry): void {
    const next = [...this.logs, entry];
    this.logs = next.length <= MAX_LOG_ENTRIES
      ? next
      : next.slice(next.length - MAX_LOG_ENTRIES);
  }

  private appendPassed(results: StressCasePassed[]): void {
    if (results.length === 0) return;
    this.stats = results[results.length - 1].stats;
    const entries: StressLogEntry[] = results.map((result) => ({
      status: "AC",
      index: result.index,
      seed: result.seed,
      solutionTimeMs: result.solutionTimeMs,
      bruteTimeMs: result.bruteTimeMs,
    }));
    const next = [...this.logs, ...entries];
    this.logs = next.length <= MAX_LOG_ENTRIES
      ? next
      : next.slice(next.length - MAX_LOG_ENTRIES);
  }
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll("/", "\\").toLocaleLowerCase()
    === right.replaceAll("/", "\\").toLocaleLowerCase();
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const value = error as { userMessage?: unknown; technicalMessage?: unknown };
    if (typeof value.technicalMessage === "string" && value.technicalMessage.includes("stress:")) {
      return value.technicalMessage.replace(/^.*stress:\s*/, "");
    }
    if (typeof value.userMessage === "string") return value.userMessage;
    if (typeof value.technicalMessage === "string") return value.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
