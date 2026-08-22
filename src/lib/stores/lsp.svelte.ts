import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  cancelLspRequest,
  lspCompletion,
  lspDefinition,
  lspDidChange,
  lspDidClose,
  lspDidOpen,
  lspDidSave,
  lspHover,
  lspReferences,
  lspSignatureHelp,
  startClangd,
  stopClangd,
} from "../api/lsp";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type { LspClient, LspCompletionContext } from "../lsp/client";
import {
  parseCompletionResponse,
  parseHoverResponse,
  parseLocationResponse,
  parseSignatureResponse,
} from "../lsp/protocol";
import { recordIpcEvent } from "../performance";
import type {
  LspCompletionItem,
  LspConnectionState,
  LspDiagnostic,
  LspEvent,
  LspLocation,
  LspPosition,
  LspSignatureHelp,
  LspTextChange,
} from "../types/lsp";
import type { ShellStore } from "./shell.svelte";

const CHANGE_BATCH_MS = 32;
const CONFIGURE_DEBOUNCE_MS = 450;

interface PendingChanges {
  changes: LspTextChange[];
  version: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class LspStore implements LspClient {
  state = $state<LspConnectionState>("idle");
  message = $state("尚未打开工作区");
  serverVersion = $state("");
  executable = $state("");
  diagnostics = $state.raw<LspDiagnostic[]>([]);
  referencesResult = $state.raw<LspLocation[]>([]);

  private readonly diagnosticsByPath = new Map<string, LspDiagnostic[]>();
  private readonly documentVersions = new Map<string, number>();
  private readonly openedDocuments = new Set<string>();
  private readonly pendingChanges = new Map<string, PendingChanges>();
  private readonly documentQueues = new Map<string, Promise<void>>();
  private readonly activeRequests = new Set<number>();
  private readonly latestRequestByKind = new Map<string, number>();
  private requestSequence = 0;
  private desiredWorkspace = "";
  private desiredClangdPath = "";
  private desiredCompilerPath = "g++";
  private desiredCompilerStandard = "c++20";
  private desiredCompilerArgs: string[] = [];
  private appliedConfiguration = "";
  private configureTimer: ReturnType<typeof setTimeout> | undefined;
  private connectionQueue: Promise<void> = Promise.resolve();
  private listenPromise: Promise<void> | undefined;
  private unlisten: UnlistenFn | undefined;
  private disposed = false;

  constructor(
    private readonly editor: EditorWorkspace,
    private readonly shell: ShellStore,
  ) {
    editor.setLspClient(this);
  }

  get ready(): boolean {
    return this.state === "ready";
  }

  get errorCount(): number {
    return this.diagnostics.filter((diagnostic) => diagnostic.severity === 1).length;
  }

  get warningCount(): number {
    return this.diagnostics.filter((diagnostic) => diagnostic.severity === 2).length;
  }

  configure(
    workspace: string | undefined,
    clangdPath: string,
    compilerPath: string,
    compilerStandard: string,
    compilerArgs: readonly string[],
  ): void {
    const nextWorkspace = workspace?.trim() ?? "";
    const nextPath = clangdPath.trim();
    const nextCompiler = compilerPath.trim() || "g++";
    const nextStandard = compilerStandard.trim() || "c++20";
    const nextArgs = compilerArgs.map((argument) => argument.trim()).filter(Boolean);
    const unchanged = nextWorkspace === this.desiredWorkspace
      && nextPath === this.desiredClangdPath
      && nextCompiler === this.desiredCompilerPath
      && nextStandard === this.desiredCompilerStandard
      && JSON.stringify(nextArgs) === JSON.stringify(this.desiredCompilerArgs);
    if (unchanged) return;
    this.desiredWorkspace = nextWorkspace;
    this.desiredClangdPath = nextPath;
    this.desiredCompilerPath = nextCompiler;
    this.desiredCompilerStandard = nextStandard;
    this.desiredCompilerArgs = nextArgs;
    if (this.configureTimer) clearTimeout(this.configureTimer);
    this.configureTimer = setTimeout(() => {
      this.configureTimer = undefined;
      this.enqueueReconnect();
    }, CONFIGURE_DEBOUNCE_MS);
  }

  reconnect(): void {
    if (this.configureTimer) clearTimeout(this.configureTimer);
    this.configureTimer = undefined;
    this.appliedConfiguration = "";
    this.enqueueReconnect();
  }

  didOpen(path: string, text: string): void {
    if (!this.ready || this.openedDocuments.has(pathKey(path))) return;
    const key = pathKey(path);
    const version = 1;
    this.openedDocuments.add(key);
    this.documentVersions.set(key, version);
    void this.enqueueDocumentNotification(path, () => lspDidOpen(path, text, version))
      .catch(() => undefined);
  }

  didChange(path: string, changes: readonly LspTextChange[]): void {
    const key = pathKey(path);
    if (!this.ready || !this.openedDocuments.has(key) || changes.length === 0) return;
    const version = (this.documentVersions.get(key) ?? 1) + 1;
    this.documentVersions.set(key, version);
    let pending = this.pendingChanges.get(key);
    if (!pending) {
      pending = { changes: [], version };
      this.pendingChanges.set(key, pending);
    }
    pending.changes.push(...changes);
    pending.version = version;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => void this.flushPath(path), CHANGE_BATCH_MS);
  }

  didSave(path: string): void {
    if (!this.ready || !this.openedDocuments.has(pathKey(path))) return;
    void (async () => {
      await this.flushPath(path);
      await this.enqueueDocumentNotification(path, () => lspDidSave(path));
    })().catch((error) => this.handleNotificationError(error));
  }

  didClose(path: string): void {
    const key = pathKey(path);
    if (!this.openedDocuments.delete(key)) return;
    this.dropPending(key);
    this.documentVersions.delete(key);
    this.clearDiagnostics(path);
    if (this.ready) {
      void this.enqueueDocumentNotification(path, () => lspDidClose(path))
        .catch(() => undefined);
    }
  }

  async completion(
    path: string,
    position: LspPosition,
    context: LspCompletionContext,
    signal: AbortSignal,
  ): Promise<LspCompletionItem[]> {
    if (!this.ready || signal.aborted) return [];
    await this.flushPath(path);
    if (!this.ready || signal.aborted) return [];
    const requestId = this.nextRequest("completion");
    const cancel = () => this.cancelRequest(requestId);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const value = await lspCompletion(path, position, context, requestId);
      return signal.aborted || this.latestRequestByKind.get("completion") !== requestId
        ? []
        : parseCompletionResponse(value);
    } catch (error) {
      if (!signal.aborted) this.handleRequestError(error);
      return [];
    } finally {
      signal.removeEventListener("abort", cancel);
      this.finishRequest(requestId);
    }
  }

  async hover(path: string, position: LspPosition): Promise<string> {
    const value = await this.positionRequest("hover", path, position, lspHover);
    return value === undefined ? "" : parseHoverResponse(value);
  }

  async definition(path: string, position: LspPosition): Promise<LspLocation[]> {
    const value = await this.positionRequest("definition", path, position, lspDefinition);
    return value === undefined ? [] : parseLocationResponse(value);
  }

  async signatureHelp(
    path: string,
    position: LspPosition,
  ): Promise<LspSignatureHelp | undefined> {
    const value = await this.positionRequest(
      "signature",
      path,
      position,
      lspSignatureHelp,
    );
    return value === undefined ? undefined : parseSignatureResponse(value);
  }

  async references(path: string, position: LspPosition): Promise<LspLocation[]> {
    const value = await this.positionRequest("references", path, position, lspReferences);
    return value === undefined ? [] : parseLocationResponse(value);
  }

  revealReferences(locations: LspLocation[]): void {
    this.referencesResult = locations;
    this.shell.showBottomPanel("problems");
  }

  clearReferences(): void {
    this.referencesResult = [];
  }

  diagnosticsFor(path: string): readonly LspDiagnostic[] {
    return this.diagnosticsByPath.get(pathKey(path)) ?? [];
  }

  dispose(): void {
    this.disposed = true;
    if (this.configureTimer) clearTimeout(this.configureTimer);
    this.configureTimer = undefined;
    this.clearPendingChanges();
    this.cancelActiveRequests();
    this.unlisten?.();
    this.unlisten = undefined;
    this.editor.setLspClient(undefined);
    if (isTauri()) void stopClangd();
  }

  private enqueueReconnect(): void {
    this.connectionQueue = this.connectionQueue
      .catch(() => undefined)
      .then(() => this.applyLatestConfiguration())
      .catch((error) => {
        if (this.disposed) return;
        this.state = "unavailable";
        this.message = lspErrorMessage(error);
      });
  }

  private async applyLatestConfiguration(): Promise<void> {
    if (this.disposed) return;
    await this.ensureListener();
    while (!this.disposed) {
      const workspace = this.desiredWorkspace;
      const clangdPath = this.desiredClangdPath;
      const compilerPath = this.desiredCompilerPath;
      const compilerStandard = this.desiredCompilerStandard;
      const compilerArgs = [...this.desiredCompilerArgs];
      const configuration = [
        pathKey(workspace),
        clangdPath,
        compilerPath,
        compilerStandard,
        JSON.stringify(compilerArgs),
      ].join("\0");
      if (configuration === this.appliedConfiguration && this.ready) return;

      this.clearPendingChanges();
      this.cancelActiveRequests();
      await Promise.allSettled([...this.documentQueues.values()]);
      this.openedDocuments.clear();
      this.documentVersions.clear();
      this.documentQueues.clear();
      this.clearAllDiagnostics();
      this.referencesResult = [];
      if (!isTauri()) {
        this.state = "idle";
        this.message = workspace ? "浏览器预览模式不启动 clangd" : "尚未打开工作区";
        this.appliedConfiguration = configuration;
        return;
      }
      try {
        await stopClangd();
      } catch {
        // A previous crashed process may already be gone.
      }
      if (!workspace) {
        this.state = "idle";
        this.message = "尚未打开工作区";
        this.appliedConfiguration = configuration;
        return;
      }

      this.state = "starting";
      this.message = "正在启动 clangd…";
      try {
        const result = await startClangd(
          clangdPath,
          compilerPath,
          compilerStandard,
          compilerArgs,
        );
        if (configuration !== [
          pathKey(this.desiredWorkspace),
          this.desiredClangdPath,
          this.desiredCompilerPath,
          this.desiredCompilerStandard,
          JSON.stringify(this.desiredCompilerArgs),
        ].join("\0")) {
          continue;
        }
        this.appliedConfiguration = configuration;
        this.executable = result.executable;
        this.serverVersion = result.serverVersion;
        this.state = "ready";
        this.message = result.serverVersion
          ? `clangd ${result.serverVersion} 已就绪`
          : "clangd 已就绪";
        await this.syncOpenDocuments();
        return;
      } catch (error) {
        if (configuration !== [
          pathKey(this.desiredWorkspace),
          this.desiredClangdPath,
          this.desiredCompilerPath,
          this.desiredCompilerStandard,
          JSON.stringify(this.desiredCompilerArgs),
        ].join("\0")) {
          continue;
        }
        this.appliedConfiguration = configuration;
        this.state = "unavailable";
        this.message = lspErrorMessage(error);
        return;
      }
    }
  }

  private async ensureListener(): Promise<void> {
    if (this.listenPromise) return this.listenPromise;
    if (!isTauri()) return;
    const pending = listen<LspEvent>("lsp-event", (event) => {
      recordIpcEvent();
      this.handleEvent(event.payload);
    }).then((unlisten) => {
      if (this.disposed) unlisten();
      else this.unlisten = unlisten;
    });
    this.listenPromise = pending;
    try {
      await pending;
    } catch (error) {
      if (this.listenPromise === pending) this.listenPromise = undefined;
      this.message = lspErrorMessage(error);
      throw error;
    }
  }

  private handleEvent(event: LspEvent): void {
    if (event.type === "state") {
      this.state = event.state;
      this.message = event.message;
      if (event.state === "crashed") {
        this.clearPendingChanges();
        this.openedDocuments.clear();
        this.documentVersions.clear();
      }
      return;
    }
    if (this.desiredWorkspace && !sameOrChildPath(event.path, this.desiredWorkspace)) return;
    const diagnostics = event.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      path: event.path,
    }));
    this.diagnosticsByPath.set(pathKey(event.path), diagnostics);
    this.rebuildDiagnostics();
    this.editor.setLspDiagnostics(event.path, diagnostics);
  }

  private async syncOpenDocuments(): Promise<void> {
    for (const document of this.editor.openLspDocuments()) {
      if (!this.ready || this.disposed) return;
      const key = pathKey(document.path);
      this.openedDocuments.add(key);
      this.documentVersions.set(key, 1);
      try {
        await this.enqueueDocumentNotification(
          document.path,
          () => lspDidOpen(document.path, document.text, 1),
        );
      } catch (error) {
        this.handleNotificationError(error);
      }
    }
  }

  private async flushPath(path: string): Promise<void> {
    const key = pathKey(path);
    const pending = this.pendingChanges.get(key);
    if (!pending) return;
    this.pendingChanges.delete(key);
    if (pending.timer) clearTimeout(pending.timer);
    if (!this.ready || !this.openedDocuments.has(key)) return;
    try {
      await this.enqueueDocumentNotification(
        path,
        () => lspDidChange(path, pending.version, pending.changes),
      );
    } catch (error) {
      this.handleNotificationError(error);
    }
  }

  private async positionRequest(
    kind: string,
    path: string,
    position: LspPosition,
    invokeRequest: (path: string, position: LspPosition, requestId: number) => Promise<unknown>,
  ): Promise<unknown | undefined> {
    if (!this.ready) return undefined;
    await this.flushPath(path);
    if (!this.ready) return undefined;
    const requestId = this.nextRequest(kind);
    try {
      const value = await invokeRequest(path, position, requestId);
      return this.latestRequestByKind.get(kind) === requestId ? value : undefined;
    } catch (error) {
      if (this.latestRequestByKind.get(kind) === requestId) this.handleRequestError(error);
      return undefined;
    } finally {
      this.finishRequest(requestId);
    }
  }

  private enqueueDocumentNotification(
    path: string,
    notification: () => Promise<void>,
  ): Promise<void> {
    const key = pathKey(path);
    const previous = this.documentQueues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(notification)
      .catch((error) => {
        this.handleNotificationError(error);
        throw error;
      });
    this.documentQueues.set(key, next);
    void next.finally(() => {
      if (this.documentQueues.get(key) === next) this.documentQueues.delete(key);
    }).catch(() => undefined);
    return next;
  }

  private nextRequest(kind: string): number {
    const previous = this.latestRequestByKind.get(kind);
    if (previous !== undefined) this.cancelRequest(previous);
    const requestId = ++this.requestSequence;
    this.latestRequestByKind.set(kind, requestId);
    this.activeRequests.add(requestId);
    return requestId;
  }

  private finishRequest(requestId: number): void {
    this.activeRequests.delete(requestId);
  }

  private cancelRequest(requestId: number): void {
    if (!this.activeRequests.delete(requestId)) return;
    void cancelLspRequest(requestId).catch(() => undefined);
  }

  private cancelActiveRequests(): void {
    for (const requestId of this.activeRequests) void cancelLspRequest(requestId).catch(() => undefined);
    this.activeRequests.clear();
    this.latestRequestByKind.clear();
  }

  private dropPending(key: string): void {
    const pending = this.pendingChanges.get(key);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pendingChanges.delete(key);
  }

  private clearPendingChanges(): void {
    for (const pending of this.pendingChanges.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pendingChanges.clear();
  }

  private clearDiagnostics(path: string): void {
    this.diagnosticsByPath.delete(pathKey(path));
    this.rebuildDiagnostics();
    this.editor.setLspDiagnostics(path, []);
  }

  private clearAllDiagnostics(): void {
    this.diagnosticsByPath.clear();
    this.diagnostics = [];
    this.editor.clearLspDiagnostics();
  }

  private rebuildDiagnostics(): void {
    this.diagnostics = [...this.diagnosticsByPath.values()].flat();
  }

  private handleNotificationError(error: unknown): void {
    const message = lspErrorMessage(error);
    if (/not running|has exited|已退出/i.test(message)) {
      this.state = "crashed";
      this.message = `${message}。可点击状态栏重新连接。`;
    }
  }

  private handleRequestError(error: unknown): void {
    const message = lspErrorMessage(error);
    if (/cancel/i.test(message)) return;
    this.handleNotificationError(error);
  }
}

function pathKey(path: string): string {
  return path.replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function sameOrChildPath(path: string, parent: string): boolean {
  const candidate = pathKey(path);
  const root = pathKey(parent);
  return candidate === root || candidate.startsWith(`${root}\\`);
}

function lspErrorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { technicalMessage?: unknown; userMessage?: unknown };
    if (typeof commandError.technicalMessage === "string") {
      return commandError.technicalMessage.replace(/^process (could not start|error):\s*/i, "");
    }
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
