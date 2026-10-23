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
import { mapDiagnosticChanges } from "../editor/diagnosticChanges";
import { isCppHeader, usesCppLanguageServices } from "../editor/languageServicePolicy";
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
import type { CompileResult } from "../types/execution";
import type { ShellStore } from "./shell.svelte";

// Coalesce short bursts before asking clangd to check this exact revision.
const CHANGE_BATCH_MS = 120;
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
  checkStates = $state.raw<Record<string, "checking" | "checked" | "stale" | "paused">>({});
  private readonly compileDiagnostics = new Map<string, { diagnostics: LspDiagnostic[]; dependencies: string[] }>();
  private readonly checkTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retryChecks = new Set<string>();
  private activeSessionId = "";
  private readonly documentVersions = new Map<string, number>();
  private readonly openedDocuments = new Set<string>();
  private readonly pendingChanges = new Map<string, PendingChanges>();
  private readonly pendingHeaders = new Map<string, number>();
  private headerSequence = 0;
  private readonly documentQueues = new Map<string, Promise<void>>();
  private readonly activeRequests = new Set<number>();
  private readonly latestRequestByKind = new Map<string, number>();
  private requestSequence = 0;
  private connectionGeneration = 0;
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
    const oldCompilePaths = [...this.compileDiagnostics.values()].flatMap((record) => record.diagnostics.map((d) => d.path));
    this.compileDiagnostics.clear();
    this.rebuildDiagnostics();
    for (const path of new Set(oldCompilePaths)) this.editor.setLspDiagnostics(path, this.diagnosticsFor(path));
    this.desiredWorkspace = nextWorkspace;
    this.desiredClangdPath = nextPath;
    this.desiredCompilerPath = nextCompiler;
    this.desiredCompilerStandard = nextStandard;
    this.desiredCompilerArgs = nextArgs;
    this.invalidateConnection();
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
    this.invalidateConnection();
    this.enqueueReconnect();
  }

  private invalidateConnection(): void {
    this.connectionGeneration++;
    this.activeSessionId = "";
    this.state = "starting";
    this.message = "正在按当前编译配置重新连接和检查…";
    this.clearPendingChanges();
    this.cancelActiveRequests();
    for (const key of this.checkTimers.keys()) this.cancelCheck(key);
    this.checkStates = {};
    this.clearAllDiagnostics();
  }

  didOpen(path: string, text: string): void {
    if (!this.ready || !usesCppLanguageServices(path, text) || this.openedDocuments.has(pathKey(path))) return;
    const key = pathKey(path);
    this.retryChecks.delete(key);
    const version = (this.documentVersions.get(key) ?? 0) + 1;
    this.openedDocuments.add(key);
    this.documentVersions.set(key, version);
    this.markChecking(path);
    const headerToken = isCppHeader(path) ? this.markHeaderPending(path) : undefined;
    const generation = this.connectionGeneration;
    void this.enqueueDocumentNotification(path, () => lspDidOpen(path, text, version))
      .then(() => { if (generation === this.connectionGeneration) { this.refreshTranslationUnits(path); this.clearHeaderPending(key, headerToken); } })
      .catch(() => undefined);
  }

  didChange(path: string, changes: readonly LspTextChange[]): void {
    const key = pathKey(path);
    if (changes.length) this.invalidateCompileDiagnostics(path);
    if (!this.ready || changes.length === 0) return;
    if (!this.openedDocuments.has(key)) {
      // A restored tab may finish loading after startup's document snapshot.
      // Open its current content rather than silently dropping all later edits.
      queueMicrotask(() => {
        if (this.disposed || !this.ready || this.openedDocuments.has(key)) return;
        const document = this.editor.openLspDocuments().find((item) => pathKey(item.path) === key);
        if (document) this.didOpen(document.path, document.text);
      });
      return;
    }
    this.retryChecks.delete(key);
    this.markChecking(path);
    if (isCppHeader(path)) this.markHeaderPending(path);
    // Edited tokens invalidate their own diagnostic immediately; untouched
    // errors follow their text while the exact new version is being checked.
    const previous = this.diagnosticsByPath.get(key);
    if (previous?.length) {
      this.diagnosticsByPath.set(key, mapDiagnosticChanges(previous, changes));
      this.rebuildDiagnostics();
      queueMicrotask(() => {
        if (!this.disposed) this.editor.setLspDiagnostics(path, this.diagnosticsFor(path));
      });
    }
    const version = (this.documentVersions.get(key) ?? 1) + 1;
    this.documentVersions.set(key, version);
    let pending = this.pendingChanges.get(key);
    if (!pending) {
      pending = { changes: [], version };
      this.pendingChanges.set(key, pending);
    }
    pending.changes.push(...changes);
    pending.version = version;
    pending.timer ??= setTimeout(() => void this.flushPath(path), CHANGE_BATCH_MS);
  }

  inputChanged(path: string, external = false): void {
    const affected = this.invalidateCompileDiagnostics(path);
    if (external) {
      // A closed header (or a renamed/deleted directory) still invalidates
      // checks of translation units that depended on its disk contents.
      for (const [key] of this.documentVersions) {
        if (sameOrChildPath(key, path)) affected.add(key);
      }
      for (const key of affected) {
        this.cancelCheck(key);
        this.checkStates = { ...this.checkStates, [key]: "stale" };
        const document = this.editor.openLspDocuments().find((item) => pathKey(item.path) === key);
        if (document && this.ready) queueMicrotask(() => {
          if (!this.disposed && this.ready) this.recheck(document.path);
        });
      }
    }
  }

  didSave(path: string): void {
    if (!this.ready || !this.openedDocuments.has(pathKey(path))) return;
    const generation = this.connectionGeneration;
    void (async () => {
      await this.flushPath(path);
      if (!this.ready || generation !== this.connectionGeneration) return;
      await this.enqueueDocumentNotification(path, () => lspDidSave(path));
    })().catch((error) => this.handleNotificationError(error, generation));
  }

  didClose(path: string, inputChanged = false): void {
    const key = pathKey(path);
    if (inputChanged) this.invalidateCompileDiagnostics(path);
    if (!this.openedDocuments.delete(key)) return;
    this.dropPending(key);
    this.cancelCheck(key);
    this.retryChecks.delete(key);
    this.checkStates = { ...this.checkStates, [key]: "paused" };
    this.clearDiagnostics(path);
    if (this.ready) {
      const generation = this.connectionGeneration;
      const headerToken = isCppHeader(path) ? this.markHeaderPending(path) : undefined;
      void this.enqueueDocumentNotification(path, () => lspDidClose(path))
        .then(() => { if (generation === this.connectionGeneration) { this.refreshTranslationUnits(path); this.clearHeaderPending(key, headerToken); } })
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
    const generation = this.connectionGeneration;
    const version = this.documentVersions.get(pathKey(path));
    await this.flushPath(path);
    if (!this.ready || generation !== this.connectionGeneration || signal.aborted || version !== this.documentVersions.get(pathKey(path))) return [];
    const requestId = this.nextRequest("completion");
    const cancel = () => this.cancelRequest(requestId);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const value = await lspCompletion(path, position, context, requestId);
      return generation !== this.connectionGeneration || signal.aborted || this.latestRequestByKind.get("completion") !== requestId
        || version !== this.documentVersions.get(pathKey(path))
        ? []
        : parseCompletionResponse(value);
    } catch (error) {
      if (!signal.aborted && this.latestRequestByKind.get("completion") === requestId) this.handleRequestError(error, generation);
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
    return this.diagnostics.filter((diagnostic) => pathKey(diagnostic.path) === pathKey(path));
  }

  checkStatus(path?: string): string {
    if (!path) return "尚未打开文件";
    if (!this.ready) return this.message;
    const status = this.checkStates[pathKey(path)];
    if (status === "checking") return "正在检查当前文件…";
    if (status === "checked") return "当前版本已检查";
    if (status === "stale") return "检查未完成，请重新检查";
    if (status === "paused") return "当前文件已暂停实时检查（文件过大或已关闭）";
    return "当前文件尚未检查（文件过大时暂停实时检查）";
  }

  isChecked(path?: string): boolean {
    return this.ready && !!path && this.checkStates[pathKey(path)] === "checked";
  }

  recheck(path?: string, automatic = false): void {
    if (!path || !this.ready) { if (!automatic) this.reconnect(); return; }
    const document = this.editor.openLspDocuments().find((item) => pathKey(item.path) === pathKey(path));
    if (!document) return;
    // A language-service refresh cannot verify or clear linker/build errors.
    const key = pathKey(path);
    this.dropPending(key);
    this.openedDocuments.delete(key);
    this.diagnosticsByPath.delete(key);
    this.rebuildDiagnostics();
    this.editor.setLspDiagnostics(path, this.diagnosticsFor(path));
    void this.enqueueDocumentNotification(path, () => lspDidClose(path)).catch(() => undefined);
    this.didOpen(document.path, document.text);
    if (automatic) this.retryChecks.add(pathKey(path));
  }

  private translationUnitsFor(path: string): { path: string }[] {
    if (!isCppHeader(path) || !this.ready) return [];
    // Called from an editor update: inspecting tab paths must not capture or
    // dispatch to the active CodeMirror view recursively.
    return (this.editor.tabs ?? []).flatMap((tab) => tab.path && !isCppHeader(tab.path)
      && this.openedDocuments.has(pathKey(tab.path)) ? [{ path: tab.path }] : []);
  }

  private markTranslationUnitsPending(path: string): void {
    const documents = this.translationUnitsFor(path);
    if (!documents.length) return;
    for (const document of documents) {
      this.markChecking(document.path);
      this.diagnosticsByPath.delete(pathKey(document.path));
    }
    this.rebuildDiagnostics();
    queueMicrotask(() => {
      if (!this.disposed) for (const document of documents) this.editor.setLspDiagnostics(document.path, this.diagnosticsFor(document.path));
    });
  }

  private markHeaderPending(path: string): number {
    const token = ++this.headerSequence;
    this.pendingHeaders.set(pathKey(path), token);
    this.markTranslationUnitsPending(path);
    return token;
  }

  private clearHeaderPending(key: string, token?: number): void {
    if (token !== undefined && this.pendingHeaders.get(key) === token) this.pendingHeaders.delete(key);
  }

  private refreshTranslationUnits(path: string): void {
    // Empty didChange notifications can be elided by clangd. Reopen the unit
    // after the header write so its preamble and dependency contents are fresh.
    for (const document of this.translationUnitsFor(path)) {
      this.recheck(document.path);
    }
  }

  acceptCompileResult(path: string, result: CompileResult, snapshot?: { text: string; revision: number; documents?: { path: string; revision: number }[] }): void {
    const current = this.editor.sourceSnapshot?.(path);
    if (result.sourceChanged || !snapshot || !current || current.revision !== snapshot.revision || current.text !== snapshot.text) return;
    if (snapshot.documents?.some((document) => this.editor.sourceSnapshot(document.path)?.revision !== document.revision)) return;
    const oldPaths = this.compileDiagnostics.get(pathKey(path))?.diagnostics.map((diagnostic) => diagnostic.path) ?? [];
    this.compileDiagnostics.set(pathKey(path), { diagnostics: result.diagnostics ?? [], dependencies: result.dependencies?.map((doc) => pathKey(doc.path)) ?? snapshot.documents?.map((doc) => pathKey(doc.path)) ?? [pathKey(path)] });
    this.rebuildDiagnostics();
    for (const target of new Set([path, ...oldPaths, ...(result.diagnostics ?? []).map((diagnostic) => diagnostic.path)])) {
      this.editor.setLspDiagnostics(target, this.diagnosticsFor(target));
    }
  }

  private invalidateCompileDiagnostics(path: string): Set<string> {
    const changed = pathKey(path);
    const affected = new Set<string>();
    const roots = new Set<string>();
    for (const [key, record] of this.compileDiagnostics) {
      if (sameOrChildPath(key, changed) || record.dependencies.some((dependency) => sameOrChildPath(dependency, changed)) || record.diagnostics.some((d) => sameOrChildPath(d.path, changed))) {
        roots.add(key);
        this.cancelCheck(key);
        this.checkStates = { ...this.checkStates, [key]: "stale" };
        record.diagnostics.forEach((d) => affected.add(d.path));
        this.compileDiagnostics.delete(key);
      }
    }
    if (!affected.size) return roots;
    this.rebuildDiagnostics();
    // Called by CodeMirror's update listener: do not dispatch recursively.
    queueMicrotask(() => {
      if (!this.disposed) for (const target of affected) {
        this.editor.setLspDiagnostics(target, this.diagnosticsFor(target));
      }
    });
    return roots;
  }

  private cancelCheck(key: string): void {
    const timer = this.checkTimers.get(key);
    if (timer) clearTimeout(timer);
    this.checkTimers.delete(key);
  }

  private markChecking(path: string): void {
    const key = pathKey(path);
    this.cancelCheck(key);
    this.checkStates = { ...this.checkStates, [key]: "checking" };
    this.checkTimers.set(key, setTimeout(() => {
      this.checkTimers.delete(key);
      if (!this.ready || !this.openedDocuments.has(key)) return;
      if (!this.retryChecks.has(key)) { this.recheck(path, true); return; }
      this.checkStates = { ...this.checkStates, [key]: "stale" };
    }, 5000));
  }

  dispose(): void {
    this.disposed = true;
    if (this.configureTimer) clearTimeout(this.configureTimer);
    this.configureTimer = undefined;
    this.clearPendingChanges();
    for (const key of this.checkTimers.keys()) this.cancelCheck(key);
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

      this.state = "starting";
      this.clearPendingChanges();
      this.cancelActiveRequests();
      await Promise.allSettled([...this.documentQueues.values()]);
      this.openedDocuments.clear();
      this.activeSessionId = "";
      this.retryChecks.clear();
      for (const key of this.checkTimers.keys()) this.cancelCheck(key);
      this.checkStates = {};
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
        this.activeSessionId = result.sessionId ?? "";
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
    if (this.disposed || (event.sessionId !== undefined && event.sessionId !== this.activeSessionId)) return;
    if (event.type === "state") {
      // The backend emits this from initialize(), before the manager installs
      // the session. Only the completed start command can enable IPC writes.
      if (event.state === "ready") return;
      this.state = event.state;
      this.message = event.message;
      if (event.state === "crashed") {
        this.clearPendingChanges();
        this.openedDocuments.clear();
        for (const key of this.checkTimers.keys()) this.cancelCheck(key);
        this.clearAllDiagnostics();
      }
      return;
    }
    if (!this.ready) return;
    if (this.pendingHeaders.size && !isCppHeader(event.path)) return;
    if (this.desiredWorkspace && !sameOrChildPath(event.path, this.desiredWorkspace)) return;
    const key = pathKey(event.path);
    if (!this.openedDocuments.has(key)) return;
    const currentVersion = this.documentVersions.get(key);
    if (
      event.version === undefined
      || currentVersion === undefined
      || event.version !== currentVersion
    ) return;
    this.cancelCheck(key);
    this.retryChecks.delete(key);
    this.checkStates = { ...this.checkStates, [key]: "checked" };
    const diagnostics = event.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      path: event.path,
    }));
    this.diagnosticsByPath.set(key, diagnostics);
    this.rebuildDiagnostics();
    this.editor.setLspDiagnostics(event.path, this.diagnosticsFor(event.path));
  }

  private async syncOpenDocuments(): Promise<void> {
    for (const document of this.editor.openLspDocuments()) {
      if (!this.ready || this.disposed) return;
      // Register every file synchronously. Edits made while another file's
      // didOpen is in flight must queue behind their own file's didOpen.
      this.didOpen(document.path, document.text);
    }
    await Promise.allSettled([...this.documentQueues.values()]);
  }

  private async flushPath(path: string): Promise<void> {
    const generation = this.connectionGeneration;
    const key = pathKey(path);
    const pending = this.pendingChanges.get(key);
    if (!pending) {
      // A timer may already have taken the batch while its IPC write is still
      // in flight. Requests must wait for didOpen/didChange in that case too.
      try { await this.documentQueues.get(key); }
      catch (error) { this.handleNotificationError(error, generation); }
      return;
    }
    this.pendingChanges.delete(key);
    if (pending.timer) clearTimeout(pending.timer);
    if (!this.ready || !this.openedDocuments.has(key)) return;
    const headerToken = this.pendingHeaders.get(key);
    try {
      await this.enqueueDocumentNotification(
        path,
        () => lspDidChange(path, pending.version, pending.changes),
      );
      if (generation === this.connectionGeneration) {
        this.refreshTranslationUnits(path);
        this.clearHeaderPending(key, headerToken);
      }
    } catch (error) {
      this.handleNotificationError(error, generation);
    }
  }

  private async positionRequest(
    kind: string,
    path: string,
    position: LspPosition,
    invokeRequest: (path: string, position: LspPosition, requestId: number) => Promise<unknown>,
  ): Promise<unknown | undefined> {
    if (!this.ready) return undefined;
    const generation = this.connectionGeneration;
    const version = this.documentVersions.get(pathKey(path));
    await this.flushPath(path);
    if (!this.ready || generation !== this.connectionGeneration || version !== this.documentVersions.get(pathKey(path))) return undefined;
    const requestId = this.nextRequest(kind);
    try {
      const value = await invokeRequest(path, position, requestId);
      return generation === this.connectionGeneration && this.latestRequestByKind.get(kind) === requestId
        && version === this.documentVersions.get(pathKey(path)) ? value : undefined;
    } catch (error) {
      if (this.latestRequestByKind.get(kind) === requestId) this.handleRequestError(error, generation);
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
    const generation = this.connectionGeneration;
    const previous = this.documentQueues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => {
        if (generation !== this.connectionGeneration || this.disposed) return;
        return notification();
      })
      .catch((error) => {
        this.handleNotificationError(error, generation);
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
    this.pendingHeaders.clear();
  }

  private clearDiagnostics(path: string): void {
    this.diagnosticsByPath.delete(pathKey(path));
    this.rebuildDiagnostics();
    // A document can leave LSP mode inside CodeMirror's update listener.
    queueMicrotask(() => {
      if (!this.disposed && !this.diagnosticsByPath.has(pathKey(path))) this.editor.setLspDiagnostics(path, this.diagnosticsFor(path));
    });
  }

  private clearAllDiagnostics(): void {
    const paths = this.diagnostics.map((diagnostic) => diagnostic.path);
    this.diagnosticsByPath.clear();
    this.rebuildDiagnostics();
    this.editor.clearLspDiagnostics();
    for (const path of new Set(paths)) this.editor.setLspDiagnostics(path, this.diagnosticsFor(path));
  }

  private rebuildDiagnostics(): void {
    const seen = new Set<string>();
    const compiled = [...this.compileDiagnostics.values()].flatMap((record) => record.diagnostics);
    const compilerErrors = new Map<string, LspDiagnostic[]>();
    for (const diagnostic of compiled) {
      if (diagnostic.severity !== 1 || diagnostic.fileLevel) continue;
      const key = `${pathKey(diagnostic.path)}\0${diagnostic.range.start.line}`;
      const line = compilerErrors.get(key) ?? [];
      line.push(diagnostic);
      compilerErrors.set(key, line);
    }
    const live = [...this.diagnosticsByPath.values()].flat().filter((diagnostic) =>
      diagnostic.severity !== 1 || diagnostic.fileLevel
      || !compilerErrors.get(`${pathKey(diagnostic.path)}\0${diagnostic.range.start.line}`)?.some((build) => rangesOverlap(build.range, diagnostic.range)));
    this.diagnostics = compiled.concat(live).filter((diagnostic) => {
      const key = [pathKey(diagnostic.path), diagnostic.range.start.line, diagnostic.range.start.character, diagnostic.severity, diagnostic.message.toLowerCase()].join("\0");
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  private handleNotificationError(error: unknown, generation = this.connectionGeneration): void {
    if (this.disposed || generation !== this.connectionGeneration) return;
    const message = lspErrorMessage(error);
    this.state = /not running|has exited|已退出/i.test(message) ? "crashed" : "unavailable";
    this.message = `${message}。可点击状态栏重新连接。`;
    this.clearPendingChanges();
    this.openedDocuments.clear();
    for (const key of this.checkTimers.keys()) this.cancelCheck(key);
    this.clearAllDiagnostics();
  }

  private handleRequestError(error: unknown, generation = this.connectionGeneration): void {
    if (this.disposed || generation !== this.connectionGeneration) return;
    const message = lspErrorMessage(error);
    if (/cancel/i.test(message)) return;
    if (/not running|has exited|已退出/i.test(message)) this.handleNotificationError(error, generation);
  }
}

function rangesOverlap(a: LspDiagnostic["range"], b: LspDiagnostic["range"]): boolean {
  const compare = (x: LspPosition, y: LspPosition) => x.line - y.line || x.character - y.character;
  return compare(a.start, b.end) < 0 && compare(b.start, a.end) < 0
    || compare(a.start, b.start) === 0;
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
