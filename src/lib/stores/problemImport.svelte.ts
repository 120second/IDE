import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as api from "../api/problemImport";
import type { ImportedProblem } from "../api/problemImport";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type { WorkspaceStore } from "./workspace.svelte";
import type { ShellStore } from "./shell.svelte";
import type { ExecutionStore } from "./execution.svelte";
import type { UxStore } from "./ux.svelte";
import { flushNotebookWrites } from "../notebookStorage";

const samePath = (a?: string, b?: string) => Boolean(a && b
  && a.replaceAll("/", "\\").toLowerCase() === b.replaceAll("/", "\\").toLowerCase());

export class ProblemImportStore {
  listening = $state(false);
  ready = $state(false);
  busy = $state(false);
  error = $state("");
  workspacePath = $state<string>();
  port = $state(27121);
  lastImported = $state<string>();
  templateId = $state<number>();
  templateName = $state<string>();
  private initialization?: Promise<void>;
  private unlisten?: UnlistenFn;
  private disposed = false;
  private imports = Promise.resolve();

  constructor(
    private readonly editor: EditorWorkspace,
    private readonly files: WorkspaceStore,
    private readonly shell: ShellStore,
    private readonly execution: ExecutionStore,
    private readonly ux: UxStore,
  ) {}

  initialize(): Promise<void> {
    return this.initialization ??= this.connect();
  }

  private async connect(): Promise<void> {
    if (!isTauri()) return;
    try {
      const unlisten = await listen<ImportedProblem>("problem-imported", ({ payload }) => {
        this.imports = this.imports.then(() => this.openImported(payload)).catch((error) => {
          this.error = errorMessage(error);
          this.ux.error(`题目已保存，但打开失败：${this.error}`);
        });
      });
      if (this.disposed) { unlisten(); return; }
      this.unlisten = unlisten;
      const status = await api.problemListenerStatus();
      if (this.disposed) return;
      this.applyStatus(status);
      this.ready = true;
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async start(templateCode: string): Promise<void> {
    if (this.busy || this.listening || this.disposed) return;
    this.busy = true;
    this.error = "";
    try {
      await this.initialize();
      if (!this.ready) throw new Error("题目监听需要在 LightCP 桌面版中使用。");
      if (!this.files.info) throw new Error("请先打开用于保存题目的工作区。");
      const status = await api.startProblemListener(templateCode);
      if (this.disposed) { await api.stopProblemListener(); return; }
      if (!samePath(status.workspacePath, this.files.info?.path)) {
        await api.stopProblemListener();
        throw new Error("工作区已更换，请重新开启题目监听。");
      }
      this.applyStatus(status);
    } catch (error) {
      this.error = errorMessage(error);
    } finally { this.busy = false; }
  }

  async stop(): Promise<void> {
    if (this.busy || !this.listening) return;
    this.busy = true;
    this.error = "";
    try {
      await api.stopProblemListener();
      this.listening = false;
      this.workspacePath = undefined;
    } catch (error) { this.error = errorMessage(error); }
    finally { this.busy = false; }
  }

  workspaceChanged(path?: string): void {
    if (this.listening && !samePath(path, this.workspacePath)) void this.stop();
  }

  private applyStatus(status: api.ProblemListenerStatus): void {
    this.listening = status.listening;
    this.port = status.port;
    this.workspacePath = status.workspacePath ?? undefined;
  }

  private async openImported(problem: ImportedProblem): Promise<void> {
    if (this.disposed) return;
    const root = this.files.info?.path;
    const path = problem.sourcePath.replaceAll("/", "\\").toLowerCase();
    if (!root || !path.startsWith(root.replaceAll("/", "\\").toLowerCase().replace(/\\$/, "") + "\\")) return;
    await flushNotebookWrites();
    if (this.disposed || !samePath(root, this.files.info?.path)) return;
    await this.editor.openFile(problem.sourcePath);
    if (this.disposed || !samePath(root, this.files.info?.path)) return;
    const tab = this.editor.tabs.find((tab) => samePath(tab.path, problem.sourcePath));
    if (!tab || tab.loading) throw new Error(this.editor.notice || "无法打开导入的 C++ 文件。");
    this.shell.activeActivity = "explorer";
    this.shell.generatorOpen = false;
    this.shell.problemReaderVisible = true;
    await this.execution.syncActiveSource(problem.sourcePath, true);
    await this.files.refresh();
    this.lastImported = problem.title;
    this.ux.success(problem.alreadyImported
      ? `已打开 ${problem.title}，保留已有代码和题面。`
      : `已导入 ${problem.title} 和 ${problem.sampleCount} 个样例。`);
  }

  dispose(): void {
    this.disposed = true;
    this.unlisten?.();
    this.unlisten = undefined;
    if (isTauri()) void api.stopProblemListener().catch(() => {});
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "userMessage" in error) return String(error.userMessage);
  return error instanceof Error ? error.message : String(error);
}
