import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as api from "../api/problemImport";
import type { ImportedProblem } from "../api/problemImport";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type { WorkspaceStore } from "./workspace.svelte";
import type { ShellStore } from "./shell.svelte";
import type { ExecutionStore } from "./execution.svelte";
import type { UxStore } from "./ux.svelte";
import type { TemplateStore } from "./templates.svelte";
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
  private operations = Promise.resolve();

  constructor(
    private readonly editor: EditorWorkspace,
    private readonly files: WorkspaceStore,
    private readonly shell: ShellStore,
    private readonly execution: ExecutionStore,
    private readonly ux: UxStore,
    private readonly templates: TemplateStore,
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

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.operations = this.operations.then(async () => {
      if (this.disposed) return;
      this.busy = true;
      this.error = "";
      try { await operation(); }
      catch (error) { this.error = errorMessage(error); }
      finally { this.busy = false; }
    });
    return this.operations;
  }

  start(templateCode: string): Promise<void> {
    return this.enqueue(async () => {
      await this.initialize();
      if (this.listening || this.disposed) return;
      if (!this.ready) throw new Error("题目导入需要在 LightCP 桌面版中使用。");
      await this.startNow(templateCode);
    });
  }

  private async startNow(templateCode: string): Promise<void> {
    if (!this.files.info) throw new Error("请先打开用于保存题目的工作区。");
    const status = await api.startProblemListener(templateCode);
    if (this.disposed) { await api.stopProblemListener(); return; }
    if (!samePath(status.workspacePath, this.files.info?.path)) {
      await api.stopProblemListener();
      throw new Error("工作区已更换，正在为当前工作区准备题目导入。");
    }
    this.applyStatus(status);
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.stopNow());
  }

  private async stopNow(): Promise<void> {
    if (!this.listening) return;
    await api.stopProblemListener();
    this.listening = false;
    this.workspacePath = undefined;
  }

  workspaceChanged(path?: string): Promise<void> {
    return this.enqueue(async () => {
      await this.initialize();
      if (!this.ready || this.disposed) return;
      if (path !== this.files.info?.path) return;
      if (!path) { await this.stopNow(); return; }
      if (this.listening && samePath(path, this.workspacePath)) return;
      await this.stopNow();
      if (this.disposed || path !== this.files.info?.path) return;
      await this.prepare(this.templateId);
    });
  }

  configure(templateId?: number): Promise<void> {
    return this.enqueue(async () => {
      await this.initialize();
      if (this.disposed) return;
      if (!this.ready) throw new Error("题目导入需要在 LightCP 桌面版中使用。");
      await this.prepare(templateId);
    });
  }

  private async prepare(templateId?: number): Promise<void> {
    const root = this.files.info?.path;
    if (!root) throw new Error("请先打开用于保存题目的工作区。");
    await this.templates.ensureFileTemplates();
    const template = this.templates.fileTemplates.find((item) => item.id === templateId)
      ?? this.templates.fileTemplates.find((item) => item.name === "Contest C++")
      ?? this.templates.fileTemplates[0];
    if (!template) throw new Error(this.templates.error || "没有可用的 C++ 文件模板。");
    const detail = await this.templates.loadTemplateCode(template.id);
    if (!detail) throw new Error(this.templates.error || "无法读取所选模板。");
    if (this.disposed || !samePath(root, this.files.info?.path)) return;
    await this.stopNow();
    if (this.disposed || !samePath(root, this.files.info?.path)) return;
    await this.startNow(detail.code);
    if (this.listening) {
      this.templateId = template.id;
      this.templateName = template.name;
    }
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
    this.shell.showSublimeTool("statement");
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
