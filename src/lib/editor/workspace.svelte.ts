import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  closeBrackets,
  closeBracketsKeymap,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { cpp } from "@codemirror/lang-cpp";
import { setDiagnostics } from "@codemirror/lint";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { getTextFileRevision, readTextFile, writeTextFile } from "../api/workspace";
import type { AppSettings } from "../types/settings";
import type { LspClient } from "../lsp/client";
import type { TemplateDetail } from "../types/templates";
import type {
  LspDiagnostic,
  LspLocation,
  LspPosition,
} from "../types/lsp";
import type { WorkspaceChange } from "../types/workspace";
import type {
  EditorRecoverySelection,
  EditorRecoverySnapshot,
  EditorRecoveryTab,
} from "../types/session";
import { documentRevision, documentRevisionExtension } from "./documentRevision";
import { createAppearanceExtension } from "./appearance";
import {
  detectLineEnding,
  editorDocument,
  editorText,
  lineEndingText,
  type LineEnding,
} from "./lineEndings";
import { usesLanguageServices } from "./languageServicePolicy";
import { normalizeSnippetTemplate } from "./snippets";
import {
  completionType,
  createLspExtensions,
  createTextTooltip,
  incrementalChanges,
  offsetAt,
  positionAt,
  showSignatureTooltip,
  toCodeMirrorDiagnostic,
} from "./lspCodeMirror";
import { buildTemplateCompletionResult } from "./templateCompletion";

export interface EditorTab {
  id: string;
  title: string;
  path?: string;
  state: EditorState;
  savedRevision: number;
  diskRevision?: string;
  eol: LineEnding;
  scrollTop: number;
  dirty: boolean;
  deleted: boolean;
  externalModified: boolean;
  externalRevision?: string;
  deferredSelection?: EditorRecoverySelection;
  deferred?: boolean;
  loading?: boolean;
}

export interface EditorBreakpointLocation {
  file: string;
  line: number;
}

export interface TemplateReferenceDraft {
  template: TemplateDetail;
  tabId: string;
  from: number;
  to: number;
}

type TemplateCompletionProvider = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly TemplateDetail[]>;

interface SaveSnapshot {
  tabId: string;
  title: string;
  path: string;
  content: string;
  revision: number;
  expectedDiskRevision: string;
}

export interface SaveAllResult {
  saved: number;
  failed: number;
  skipped: number;
}

export interface ExternalConflict {
  path: string;
  title: string;
}

type ExternalConflictResolver = (conflict: ExternalConflict) => Promise<boolean>;

class BreakpointGutterMarker extends GutterMarker {
  elementClass = "cm-breakpoint-marker";

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-breakpoint-dot";
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

const breakpointMarker = new BreakpointGutterMarker();
const breakpointSpacer = new class extends GutterMarker {
  elementClass = "cm-breakpoint-spacer";
}();
const setBreakpointLines = StateEffect.define<readonly number[]>();
const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, transaction) {
    markers = markers.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setBreakpointLines)) continue;
      const ranges = effect.value
        .filter((line) => line >= 1 && line <= transaction.state.doc.lines)
        .map((line) => breakpointMarker.range(transaction.state.doc.line(line).from));
      markers = RangeSet.of(ranges, true);
    }
    return markers;
  },
});

const setDebugLocation = StateEffect.define<number | null>({
  map(value, changes) {
    return value === null ? null : changes.mapPos(value);
  },
});
const debugLocationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decoration, transaction) {
    decoration = decoration.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setDebugLocation)) continue;
      decoration = effect.value === null
        ? Decoration.none
        : Decoration.set([
            Decoration.line({ class: "cm-debug-current-line" }).range(effect.value),
          ]);
    }
    return decoration;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export class EditorWorkspace {
  tabs = $state.raw<EditorTab[]>([]);
  activeId = $state("");
  cursorLine = $state(1);
  cursorColumn = $state(1);
  saveState = $state<"idle" | "saving" | "saved" | "error">("idle");
  notice = $state("");
  templateReference = $state.raw<TemplateReferenceDraft>();

  private view: EditorView | undefined;
  private readonly appearance = new Compartment();
  private readonly lineEnding = new Compartment();
  private currentAppearance: Extension;
  private nextTabNumber = 1;
  private suppressDirty = false;
  private breakpointToggleHandler: ((file: string, line: number) => void) | undefined;
  private breakpointMoveHandler: ((file: string, lines: number[]) => void) | undefined;
  private readonly breakpointLinesByPath = new Map<string, readonly number[]>();
  private debugLocationPath = "";
  private lspClient: LspClient | undefined;
  private templateCompletionProvider: TemplateCompletionProvider | undefined;
  private templateCompletionPickedHandler: ((id: number) => void) | undefined;
  private signatureTimer: ReturnType<typeof setTimeout> | undefined;
  private openSequence = 0;
  private readonly hydrationRequests = new Map<string, Promise<void>>();
  private readonly saveQueues = new Map<string, Promise<boolean>>();
  private readonly pendingSaveRevisions = new Map<string, { revision: number; promise: Promise<boolean> }>();
  private saveOperationSequence = 0;
  private externalConflictResolver: ExternalConflictResolver | undefined;
  private sessionChangeHandler: (() => void) | undefined;

  constructor(settings: AppSettings) {
    this.currentAppearance = createAppearanceExtension(settings);
  }

  get activeTab(): EditorTab | undefined {
    return this.tabs.find((tab) => tab.id === this.activeId);
  }

  attach(parent: HTMLElement): void {
    if (this.view) return;
    const activeTab = this.activeTab;
    if (!activeTab) return;

    this.view = new EditorView({ state: activeTab.state, parent });
    this.restoreScroll(activeTab.scrollTop);
    this.updateCursor(this.view.state);
  }

  detach(): void {
    this.captureActiveView();
    this.view?.destroy();
    this.view = undefined;
  }

  focus(): void {
    this.view?.focus();
  }

  dispose(): void {
    if (this.signatureTimer) clearTimeout(this.signatureTimer);
    this.signatureTimer = undefined;
    this.detach();
    this.lspClient = undefined;
    this.sessionChangeHandler = undefined;
    this.templateReference = undefined;
  }

  setLspClient(client: LspClient | undefined): void {
    this.lspClient = client;
  }

  setExternalConflictResolver(resolver: ExternalConflictResolver | undefined): void {
    this.externalConflictResolver = resolver;
  }

  setSessionChangeHandler(handler: (() => void) | undefined): void {
    this.sessionChangeHandler = handler;
  }

  setTemplateCompletionProvider(
    provider: TemplateCompletionProvider | undefined,
    onPicked?: (id: number) => void,
  ): void {
    this.templateCompletionProvider = provider;
    this.templateCompletionPickedHandler = onPicked;
    if (!provider) this.templateReference = undefined;
  }

  closeTemplateReference(): void {
    this.templateReference = undefined;
    this.focus();
  }

  insertTemplateReference(code: string, edited: boolean): boolean {
    const reference = this.templateReference;
    if (!reference || !this.view || reference.tabId !== this.activeId) return false;

    const from = Math.min(this.view.state.doc.length, Math.max(0, reference.from));
    const to = Math.min(this.view.state.doc.length, Math.max(from, reference.to));
    this.templateReference = undefined;
    if (edited) {
      this.view.dispatch({
        changes: { from, to, insert: code },
        selection: { anchor: from + code.length },
      });
    } else {
      snippet(normalizeSnippetTemplate(reference.template.code))(this.view, null, from, to);
    }
    this.templateCompletionPickedHandler?.(reference.template.id);
    this.view.focus();
    this.notice = edited
      ? "已插入当前临时副本；原模板未修改。"
      : "已插入代码片段。使用 Tab 和 Shift+Tab 在字段间移动。";
    return true;
  }

  openLspDocuments(): { path: string; text: string }[] {
    this.captureActiveView();
    return this.tabs.flatMap((tab) =>
      tab.path && !tab.deleted && !tab.deferred
        && usesLanguageServices(tab.state.doc)
        ? [{ path: tab.path, text: tab.state.doc.toString() }]
        : [],
    );
  }

  setLspDiagnostics(path: string, diagnostics: readonly LspDiagnostic[]): void {
    const tab = this.tabs.find((candidate) => candidate.path && samePath(candidate.path, path));
    if (!tab) return;
    const state = tab.id === this.activeId && this.view ? this.view.state : tab.state;
    const mapped = diagnostics.map((diagnostic) => toCodeMirrorDiagnostic(state, diagnostic));
    if (tab.id === this.activeId && this.view) {
      this.view.dispatch(setDiagnostics(this.view.state, mapped));
      return;
    }
    this.replaceTab(tab.id, { ...tab, state: state.update(setDiagnostics(state, mapped)).state });
  }

  clearLspDiagnostics(): void {
    this.tabs = this.tabs.map((tab) => {
      if (tab.id === this.activeId && this.view) return tab;
      return { ...tab, state: tab.state.update(setDiagnostics(tab.state, [])).state };
    });
    if (this.view) this.view.dispatch(setDiagnostics(this.view.state, []));
  }

  setBreakpointHandlers(
    toggle: (file: string, line: number) => void,
    moved: (file: string, lines: number[]) => void,
  ): void {
    this.breakpointToggleHandler = toggle;
    this.breakpointMoveHandler = moved;
  }

  setBreakpointLocations(locations: readonly EditorBreakpointLocation[]): void {
    const linesByPath = new Map<string, number[]>();
    for (const location of locations) {
      if (!Number.isSafeInteger(location.line) || location.line < 1) continue;
      const key = normalizedPath(location.file);
      const lines = linesByPath.get(key);
      if (lines) lines.push(location.line);
      else linesByPath.set(key, [location.line]);
    }
    for (const [key, lines] of linesByPath) {
      linesByPath.set(key, lines.sort((left, right) => left - right));
    }

    let tabsChanged = false;
    const nextTabs = this.tabs.map((tab) => {
      if (!tab.path || tab.id === this.activeId && this.view) return tab;
      const key = normalizedPath(tab.path);
      const lines = linesByPath.get(normalizedPath(tab.path)) ?? [];
      if (sameLineNumbers(this.breakpointLinesByPath.get(key) ?? [], lines)) return tab;
      tabsChanged = true;
      return { ...tab, state: tab.state.update({ effects: setBreakpointLines.of(lines) }).state };
    });
    if (tabsChanged) this.tabs = nextTabs;
    const active = this.activeTab;
    if (active?.path && this.view) {
      const key = normalizedPath(active.path);
      const lines = linesByPath.get(key) ?? [];
      if (!sameLineNumbers(this.breakpointLinesByPath.get(key) ?? [], lines)) {
        this.view.dispatch({ effects: setBreakpointLines.of(lines) });
      }
    }
    this.breakpointLinesByPath.clear();
    for (const [key, lines] of linesByPath) {
      this.breakpointLinesByPath.set(key, lines);
    }
  }

  async revealDebugLocation(path: string, line: number): Promise<void> {
    if (!path || !Number.isSafeInteger(line) || line < 1) return;
    this.clearDebugLocation();
    await this.openFile(path);
    const tab = this.activeTab;
    if (!tab?.path || !samePath(tab.path, path)) return;
    const state = this.view?.state ?? tab.state;
    const targetLine = state.doc.line(Math.min(line, state.doc.lines));
    this.debugLocationPath = tab.path;
    if (this.view) {
      this.view.dispatch({
        selection: { anchor: targetLine.from },
        effects: [
          setDebugLocation.of(targetLine.from),
          EditorView.scrollIntoView(targetLine.from, { y: "center" }),
        ],
      });
      this.view.focus();
      return;
    }
    this.replaceTab(tab.id, {
      ...tab,
      state: tab.state.update({ effects: setDebugLocation.of(targetLine.from) }).state,
    });
  }

  clearDebugLocation(): void {
    const path = this.debugLocationPath;
    if (!path) return;
    this.debugLocationPath = "";
    const active = this.activeTab;
    if (active?.path && samePath(active.path, path) && this.view) {
      this.view.dispatch({ effects: setDebugLocation.of(null) });
    }
    this.tabs = this.tabs.map((tab) => {
      if (!tab.path || tab.id === this.activeId && this.view || !samePath(tab.path, path)) return tab;
      return { ...tab, state: tab.state.update({ effects: setDebugLocation.of(null) }).state };
    });
  }

  getSelectedText(): string {
    const state = this.view?.state ?? this.activeTab?.state;
    if (!state) return "";
    const selection = state.selection.main;
    return state.doc.sliceString(selection.from, selection.to);
  }

  insertSnippet(template: string): void {
    const tab = this.activeTab;
    if (!tab) return;
    const normalized = normalizeSnippetTemplate(template);
    const state = this.view?.state ?? tab.state;
    const selection = state.selection.main;
    const apply = snippet(normalized);

    if (this.view) {
      apply(this.view, null, selection.from, selection.to);
      this.view.focus();
      this.notice = "已插入代码片段。使用 Tab 和 Shift+Tab 在字段间移动。";
      return;
    }

    let nextState = state;
    apply(
      {
        state,
        dispatch: (transaction: Transaction) => {
          nextState = transaction.state;
        },
      },
      null,
      selection.from,
      selection.to,
    );
    this.tabs = this.tabs.map((candidate) =>
      candidate.id === tab.id ? { ...candidate, state: nextState, dirty: true } : candidate,
    );
    this.notice = "已插入代码片段。使用 Tab 和 Shift+Tab 在字段间移动。";
  }

  switchTab(id: string): void {
    if (!this.tabs.some((tab) => tab.id === id)) return;
    if (id === this.activeId) {
      if (this.activeTab?.deferred) void this.hydrateTab(id);
      return;
    }
    this.templateReference = undefined;
    this.captureActiveView();
    this.activeId = id;

    let activeTab = this.activeTab;
    if (this.view && activeTab) {
      activeTab = {
        ...activeTab,
        state: activeTab.state.update({
          effects: this.appearance.reconfigure(this.currentAppearance),
        }).state,
      };
      this.replaceTab(id, activeTab);
      this.view.setState(activeTab.state);
      this.restoreScroll(activeTab.scrollTop);
      this.updateCursor(activeTab.state);
      this.view.focus();
    }
    if (activeTab?.deferred) void this.hydrateTab(id);
    this.notifySessionChange();
  }

  createTab(): void {
    this.templateReference = undefined;
    this.captureActiveView();
    const id = `untitled-${Date.now()}-${this.nextTabNumber}`;
    const title = `未命名-${this.nextTabNumber++}.cpp`;
    const eol: LineEnding = "lf";
    const state = this.createState("", undefined, this.currentAppearance, eol);
    const tab: EditorTab = {
      id,
      title,
      state,
      savedRevision: documentRevision(state),
      eol,
      scrollTop: 0,
      dirty: false,
      deleted: false,
      externalModified: false,
    };
    this.tabs = [...this.tabs, tab];
    this.activeId = id;
    this.view?.setState(tab.state);
    this.restoreScroll(0);
    this.view?.focus();
    this.notifySessionChange();
  }

  async openFile(path: string): Promise<void> {
    const request = ++this.openSequence;
    const existing = this.tabs.find((tab) => tab.path && samePath(tab.path, path));
    if (existing) {
      this.switchTab(existing.id);
      await this.hydrateTab(existing.id);
      return;
    }

    this.notice = `正在打开 ${fileName(path)}…`;
    try {
      const file = await readTextFile(path);
      const duplicate = this.tabs.find(
        (tab) => tab.path && samePath(tab.path, file.path),
      );
      if (duplicate) {
        if (request === this.openSequence) this.switchTab(duplicate.id);
        return;
      }

      this.captureActiveView();
      const document = editorDocument(file.content);
      const { eol } = document;
      const state = this.withBreakpointLines(
        this.createState(document.text, undefined, this.currentAppearance, eol),
        file.path,
      );
      const tab: EditorTab = {
        id: `file-${Date.now()}-${this.nextTabNumber++}`,
        title: fileName(file.path),
        path: file.path,
        state,
        savedRevision: documentRevision(state),
        diskRevision: file.revision,
        eol,
        scrollTop: 0,
        dirty: false,
        deleted: false,
        externalModified: false,
      };
      this.tabs = [...this.tabs, tab];
      if (usesLanguageServices(state.doc)) {
        this.lspClient?.didOpen(file.path, state.doc.toString());
      }
      if (request === this.openSequence) {
        this.templateReference = undefined;
        this.activeId = tab.id;
        this.view?.setState(tab.state);
        this.restoreScroll(0);
        this.view?.focus();
        this.notice = `已打开 ${tab.title}`;
      }
      this.notifySessionChange();
    } catch (error) {
      this.saveState = "error";
      this.notice = errorMessage(error);
    }
  }

  async saveActive(): Promise<boolean> {
    const activeId = this.activeId;
    if (!activeId) {
      this.saveState = "error";
      this.notice = "当前编辑器尚未对应工作区文件。";
      return false;
    }
    return this.saveTab(activeId);
  }

  async saveTab(id: string): Promise<boolean> {
    const requested = this.tabs.find((tab) => tab.id === id);
    if (requested?.deferred) await this.hydrateTab(id);
    this.captureActiveView();
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab?.path) {
      this.saveState = "error";
      this.notice = tab
        ? `${tab.title} 尚未对应工作区文件。`
        : "要保存的编辑器已关闭。";
      return false;
    }
    if (tab.deleted) {
      this.saveState = "error";
      this.notice = `${tab.title} 已在 LightCP 外部被删除。`;
      return false;
    }
    if (!tab.diskRevision) {
      this.saveState = "error";
      this.notice = `无法确认 ${tab.title} 的磁盘版本，请重新打开文件后再保存。`;
      return false;
    }

    const revision = documentRevision(tab.state);
    const pending = this.pendingSaveRevisions.get(tab.id);
    if (pending?.revision === revision) return pending.promise;
    const snapshot: SaveSnapshot = {
      tabId: tab.id,
      title: tab.title,
      path: tab.path,
      content: tab.state.sliceDoc(),
      revision,
      expectedDiskRevision: tab.diskRevision,
    };
    this.saveState = "saving";
    this.notice = `正在保存 ${tab.title}…`;
    const previous = this.saveQueues.get(tab.id) ?? Promise.resolve(true);
    let request: Promise<boolean>;
    request = previous
      .catch(() => false)
      .then(() => this.performSave(snapshot))
      .finally(() => {
        if (this.saveQueues.get(tab.id) === request) this.saveQueues.delete(tab.id);
        if (this.pendingSaveRevisions.get(tab.id)?.promise === request) {
          this.pendingSaveRevisions.delete(tab.id);
        }
      });
    this.saveQueues.set(tab.id, request);
    this.pendingSaveRevisions.set(tab.id, { revision, promise: request });
    return request;
  }

  async saveAll(): Promise<SaveAllResult> {
    this.captureActiveView();
    const dirtyIds = this.tabs.filter((tab) => tab.dirty).map((tab) => tab.id);
    const result: SaveAllResult = { saved: 0, failed: 0, skipped: 0 };

    for (const id of dirtyIds) {
      const tab = this.tabs.find((candidate) => candidate.id === id);
      if (!tab?.path || tab.deleted || !tab.diskRevision) {
        result.skipped += 1;
        continue;
      }
      if (await this.saveTab(id)) result.saved += 1;
      else result.failed += 1;
    }

    if (dirtyIds.length === 0) {
      this.saveState = "saved";
      this.notice = "没有需要保存的文件。";
    } else if (result.failed === 0 && result.skipped === 0) {
      this.saveState = "saved";
      this.notice = `已保存 ${result.saved} 个文件。`;
    } else {
      this.saveState = "error";
      this.notice = `保存完成：成功 ${result.saved} 个，失败 ${result.failed} 个，跳过 ${result.skipped} 个。`;
    }
    return result;
  }

  private async performSave(snapshot: SaveSnapshot): Promise<boolean> {
    const operation = ++this.saveOperationSequence;
    const current = this.tabs.find((tab) => tab.id === snapshot.tabId);
    const expectedRevision = current?.path && samePath(current.path, snapshot.path)
      ? current.diskRevision ?? snapshot.expectedDiskRevision
      : snapshot.expectedDiskRevision;
    try {
      let result = await writeTextFile(snapshot.path, snapshot.content, expectedRevision);
      if (result.status === "conflict") {
        this.markExternalConflict(snapshot.tabId, result.revision);
        if (operation === this.saveOperationSequence) {
          this.saveState = "error";
          this.notice = `${snapshot.title} 的磁盘内容已更改，未覆盖外部版本。`;
        }
        const overwrite = await this.externalConflictResolver?.({
          path: snapshot.path,
          title: snapshot.title,
        }) ?? false;
        if (!overwrite) return false;
        result = await writeTextFile(snapshot.path, snapshot.content, result.revision);
        if (result.status === "conflict") {
          this.markExternalConflict(snapshot.tabId, result.revision);
          if (operation === this.saveOperationSequence) {
            this.saveState = "error";
            this.notice = `${snapshot.title} 在确认期间再次被修改，保存已取消。`;
          }
          return false;
        }
      }
      this.tabs = this.tabs.map((tab) => {
        if (tab.id !== snapshot.tabId) return tab;
        const state = tab.id === this.activeId && this.view ? this.view.state : tab.state;
        return {
          ...tab,
          state,
          savedRevision: snapshot.revision,
          diskRevision: result.revision,
          dirty: documentRevision(state) !== snapshot.revision,
          externalModified: false,
          externalRevision: undefined,
        };
      });
      this.notifySessionChange();
      if (operation === this.saveOperationSequence) {
        this.saveState = "saved";
        this.notice = `已保存 ${snapshot.title}`;
      }
      this.lspClient?.didSave(snapshot.path);
      return true;
    } catch (error) {
      if (operation === this.saveOperationSequence) {
        this.saveState = "error";
        this.notice = errorMessage(error);
      }
      return false;
    }
  }

  async handleExternalChange(change: WorkspaceChange): Promise<void> {
    if (change.kind === "renamed" && change.paths.length >= 2) {
      this.handlePathRenamed(change.paths[0], change.paths[1]);
      return;
    }
    if (change.kind === "deleted") {
      for (const path of change.paths) this.handlePathDeleted(path);
      return;
    }
    if (change.kind === "created") {
      for (const path of change.paths) await this.handlePathRecreated(path);
      return;
    }
    if (change.kind !== "changed") return;

    for (const path of change.paths) {
      const tab = this.tabs.find((candidate) => candidate.path && samePath(candidate.path, path));
      if (!tab) continue;

      try {
        const observed = await getTextFileRevision(path);
        const current = this.tabs.find((candidate) => candidate.id === tab.id);
        if (!current || current.deleted || !current.path || !samePath(current.path, path)) continue;
        if (current.diskRevision === observed.revision) continue;
        if (current.dirty) {
          this.markExternalConflict(current.id, observed.revision);
          this.notice = `${current.title} 在磁盘上已更改，但编辑器中仍有未保存内容。`;
          continue;
        }

        const file = await readTextFile(path);
        const latest = this.tabs.find((candidate) => candidate.id === tab.id);
        if (!latest || latest.deleted || !latest.path || !samePath(latest.path, path)) continue;
        if (latest.dirty) {
          if (latest.diskRevision !== file.revision) {
            this.markExternalConflict(latest.id, file.revision);
          }
          continue;
        }
        if (latest.diskRevision === file.revision) continue;
        this.replaceDocument(tab.id, file.content, file.revision);
        this.notice = `检测到外部更改，已重新加载 ${latest.title}。`;
      } catch {
        // A remove/rename notification can race a preceding modify notification.
      }
    }
  }

  handlePathRenamed(previousPath: string, nextPath: string): void {
    this.captureActiveView();
    const renamed: { previous: string; next: string; text?: string }[] = [];
    this.tabs = this.tabs.map((tab) => {
      if (!tab.path || !sameOrChildPath(tab.path, previousPath)) return tab;
      const suffix = tab.path.slice(previousPath.length);
      const path = `${nextPath}${suffix}`;
      renamed.push({
        previous: tab.path,
        next: path,
        text: usesLanguageServices(tab.state.doc) ? tab.state.doc.toString() : undefined,
      });
      return {
        ...tab,
        path,
        title: fileName(path),
        deleted: false,
      };
    });
    for (const document of renamed) {
      this.lspClient?.didClose(document.previous);
      if (document.text !== undefined) this.lspClient?.didOpen(document.next, document.text);
    }
    if (renamed.length) this.notifySessionChange();
  }

  handlePathDeleted(path: string): void {
    let affected = false;
    this.tabs = this.tabs.map((tab) => {
      if (!tab.path || tab.deleted || !sameOrChildPath(tab.path, path)) return tab;
      affected = true;
      this.lspClient?.didClose(tab.path);
      return { ...tab, deleted: true };
    });
    if (affected) this.notice = `${fileName(path)} 已在当前编辑器外部被删除。`;
    if (affected) this.notifySessionChange();
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    if (id === this.activeId) {
      this.templateReference = undefined;
      this.captureActiveView();
    }
    const closing = this.tabs[index];
    if (closing.path && !closing.deleted && !closing.deferred) this.lspClient?.didClose(closing.path);
    const remaining = this.tabs.filter((tab) => tab.id !== id);

    if (remaining.length === 0) {
      this.tabs = [];
      this.activeId = "";
      this.notifySessionChange();
      return;
    }

    this.tabs = remaining;
    if (id === this.activeId) {
      let next = remaining[Math.min(index, remaining.length - 1)];
      this.activeId = next.id;
      next = {
        ...next,
        state: next.state.update({
          effects: this.appearance.reconfigure(this.currentAppearance),
        }).state,
      };
      this.replaceTab(next.id, next);
      this.view?.setState(next.state);
      this.restoreScroll(next.scrollTop);
      this.updateCursor(next.state);
      this.view?.focus();
    }
    this.notifySessionChange();
  }

  updateAppearance(settings: AppSettings): void {
    const extension = createAppearanceExtension(settings);
    this.currentAppearance = extension;

    if (this.view) {
      this.view.dispatch({ effects: this.appearance.reconfigure(extension) });
    } else {
      const active = this.activeTab;
      if (active) {
        this.replaceTab(active.id, {
          ...active,
          state: active.state.update({
            effects: this.appearance.reconfigure(extension),
          }).state,
        });
      }
    }
  }

  async goToDefinition(): Promise<void> {
    const context = this.lspPosition();
    if (!context) return;
    const initialState = this.view?.state;
    const locations = await this.lspClient?.definition(context.path, context.position) ?? [];
    if (initialState && this.view?.state !== initialState) return;
    if (locations.length === 0) {
      this.notice = this.lspClient?.ready ? "未找到定义。" : "clangd 尚未就绪。";
      return;
    }
    await this.openLocation(locations[0]);
  }

  async findReferences(): Promise<void> {
    const context = this.lspPosition();
    if (!context) return;
    const initialState = this.view?.state;
    const locations = await this.lspClient?.references(context.path, context.position) ?? [];
    if (initialState && this.view?.state !== initialState) return;
    this.lspClient?.revealReferences(locations);
    this.notice = locations.length ? `找到 ${locations.length} 处引用。` : "未找到引用。";
  }

  async requestSignatureHelp(): Promise<void> {
    const context = this.lspPosition();
    if (!context || !this.view) return;
    const initialState = this.view.state;
    const signature = await this.lspClient?.signatureHelp(context.path, context.position);
    if (!signature || !this.view || this.view.state !== initialState || !samePath(this.activeTab?.path ?? "", context.path)) {
      if (this.view) showSignatureTooltip(this.view, null);
      return;
    }
    const parameter = signature.activeParameter + 1;
    const text = signature.documentation
      ? `${signature.label}\n参数 ${parameter}\n${signature.documentation}`
      : `${signature.label}\n参数 ${parameter}`;
    showSignatureTooltip(this.view, {
      position: this.view.state.selection.main.head,
      text,
    });
  }

  async openLocation(location: LspLocation): Promise<void> {
    await this.openFile(location.path);
    const tab = this.activeTab;
    if (!tab || !tab.path || !samePath(tab.path, location.path)) return;
    const state = this.view?.state ?? tab.state;
    const position = offsetAt(state, location.range.start);
    if (this.view) {
      this.view.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: "center" }),
      });
      this.view.focus();
    }
  }

  private async handlePathRecreated(path: string): Promise<void> {
    const deleted = this.tabs.find((tab) => tab.deleted && tab.path && samePath(tab.path, path));
    if (!deleted) return;
    try {
      const file = await readTextFile(path);
      const current = this.tabs.find((tab) => tab.id === deleted.id);
      if (!current?.deleted || !current.path || !samePath(current.path, file.path)) return;
      const disk = editorDocument(file.content);
      const state = current.id === this.activeId && this.view ? this.view.state : current.state;
      if (!current.dirty || (state.doc.eq(disk.text) && current.eol === disk.eol)) {
        this.replaceDocument(current.id, file.content, file.revision);
        this.notice = `已重新打开恢复的 ${current.title}。`;
        return;
      }

      this.replaceTab(current.id, {
        ...current,
        state,
        deleted: false,
        externalModified: true,
        externalRevision: file.revision,
      });
      if (usesLanguageServices(state.doc)) this.lspClient?.didOpen(file.path, state.doc.toString());
      this.notice = `${current.title} 已在磁盘上重新创建，编辑器中的未保存内容已保留。`;
      this.notifySessionChange();
    } catch {
      // A create notification can arrive before a writer has finished replacing the file.
    }
  }

  closeAllTabs(): void {
    this.captureActiveView();
    for (const tab of this.tabs) {
      if (tab.path && !tab.deleted && !tab.deferred) this.lspClient?.didClose(tab.path);
    }
    this.tabs = [];
    this.activeId = "";
    this.saveState = "idle";
    this.notice = "已关闭全部编辑器。";
    this.notifySessionChange();
  }

  async openSearchMatch(path: string, line: number, column: number): Promise<void> {
    const position = {
      line: Math.max(0, Math.trunc(line) - 1),
      character: Math.max(0, Math.trunc(column) - 1),
    };
    await this.openLocation({ path, range: { start: position, end: position } });
  }

  async restoreSessionTabs(paths: readonly string[], activePath?: string): Promise<void> {
    const uniquePaths = [...new Map(
      paths
        .filter((path) => typeof path === "string" && path.trim())
        .slice(0, 64)
        .map((path) => [normalizedPath(path), path]),
    ).values()];
    if (uniquePaths.length === 0) return;

    this.captureActiveView();
    for (const tab of this.tabs) {
      if (tab.path && !tab.deleted && !tab.deferred) this.lspClient?.didClose(tab.path);
    }
    this.tabs = uniquePaths.map((path, index) => {
      const eol: LineEnding = "lf";
      const state = this.createState("", undefined, this.currentAppearance, eol);
      return {
        id: `restored-${Date.now()}-${index}`,
        title: fileName(path),
        path,
        state,
        savedRevision: documentRevision(state),
        eol,
        scrollTop: 0,
        dirty: false,
        deleted: false,
        externalModified: false,
        deferred: true,
        loading: false,
      };
    });
    const active = this.tabs.find((tab) => activePath && samePath(tab.path ?? "", activePath))
      ?? this.tabs[0];
    this.activeId = active.id;
    this.view?.setState(active.state);
    this.restoreScroll(0);
    this.notice = `正在恢复 ${active.title}…`;
    await this.hydrateTab(active.id);
  }

  sessionFiles(): { openFiles: string[]; activeFile?: string } {
    this.captureActiveView();
    return {
      openFiles: this.tabs.flatMap((tab) => tab.path && !tab.deleted ? [tab.path] : []),
      activeFile: this.activeTab?.path,
    };
  }

  recoverySnapshot(workspacePath?: string): EditorRecoverySnapshot {
    this.captureActiveView();
    return {
      version: 1,
      workspacePath,
      activeTabId: this.activeId || undefined,
      tabs: this.tabs.slice(0, 64).map((tab): EditorRecoveryTab => {
        const selection = tab.state.selection.main;
        const preserveContent = tab.dirty || !tab.path || tab.deleted;
        return {
          id: tab.id,
          title: tab.title,
          path: tab.path,
          dirty: tab.dirty,
          deleted: tab.deleted,
          externalModified: tab.externalModified,
          diskRevision: tab.diskRevision,
          externalRevision: tab.externalRevision,
          eol: tab.eol,
          content: preserveContent ? tab.state.sliceDoc() : undefined,
          selection: { anchor: selection.anchor, head: selection.head },
          scrollTop: Math.max(0, tab.scrollTop),
        };
      }),
    };
  }

  async restoreRecoverySnapshot(snapshot: EditorRecoverySnapshot): Promise<void> {
    this.captureActiveView();
    for (const tab of this.tabs) {
      if (tab.path && !tab.deleted && !tab.deferred) this.lspClient?.didClose(tab.path);
    }

    const restored: EditorTab[] = [];
    for (const record of snapshot.tabs.slice(0, 64)) {
      if (!record.id || !record.title) continue;
      const recoveredContent = typeof record.content === "string" ? record.content : undefined;
      if (recoveredContent === undefined) {
        if (!record.path) continue;
        const state = this.createState("", undefined, this.currentAppearance, record.eol);
        restored.push({
          id: record.id,
          title: record.title,
          path: record.path,
          state,
          savedRevision: documentRevision(state),
          diskRevision: record.diskRevision,
          eol: record.eol,
          scrollTop: record.scrollTop,
          dirty: false,
          deleted: false,
          externalModified: false,
          deferredSelection: record.selection,
          deferred: true,
          loading: false,
        });
        continue;
      }

      let eol = record.eol;
      let state = this.withBreakpointLines(
        this.createState(recoveredContent, undefined, this.currentAppearance, eol),
        record.path,
      );
      state = restoreSelection(state, record.selection);
      let dirty = record.dirty;
      let deleted = record.deleted;
      let diskRevision = record.diskRevision;
      let externalModified = record.externalModified;
      let externalRevision = record.externalRevision;

      if (record.path) {
        try {
          const disk = await readTextFile(record.path);
          const diskDocument = editorDocument(disk.content);
          const diskEol = diskDocument.eol;
          const matchesDisk = state.doc.eq(diskDocument.text) && eol === diskEol;
          deleted = false;
          if (matchesDisk) {
            eol = diskEol;
            diskRevision = disk.revision;
            dirty = false;
            externalModified = false;
            externalRevision = undefined;
          } else {
            diskRevision ??= "recovery-unknown";
            externalModified ||= diskRevision !== disk.revision;
            if (externalModified) externalRevision = disk.revision;
          }
        } catch {
          deleted = true;
          externalModified = false;
          externalRevision = undefined;
        }
      }

      const savedRevision = dirty || deleted ? 0 : documentRevision(state);
      const tab: EditorTab = {
        id: record.id,
        title: record.title,
        path: record.path,
        state,
        savedRevision,
        diskRevision,
        eol,
        scrollTop: record.scrollTop,
        dirty: dirty || deleted,
        deleted,
        externalModified,
        externalRevision,
        deferred: false,
        loading: false,
      };
      restored.push(tab);
      if (tab.path && !tab.deleted && usesLanguageServices(tab.state.doc)) {
        this.lspClient?.didOpen(tab.path, tab.state.doc.toString());
      }
    }

    this.tabs = restored;
    const active = restored.find((tab) => tab.id === snapshot.activeTabId) ?? restored[0];
    this.activeId = active?.id ?? "";
    if (active) {
      this.view?.setState(active.state);
      this.restoreScroll(active.scrollTop);
      this.updateCursor(active.state);
      if (active.deferred) await this.hydrateTab(active.id);
    }
    this.notifySessionChange();
  }

  private hydrateTab(id: string): Promise<void> {
    const existing = this.hydrationRequests.get(id);
    if (existing) return existing;
    const request = this.performHydration(id).finally(() => this.hydrationRequests.delete(id));
    this.hydrationRequests.set(id, request);
    return request;
  }

  private async performHydration(id: string): Promise<void> {
    const pending = this.tabs.find((tab) => tab.id === id);
    if (!pending?.deferred || !pending.path) return;
    this.replaceTab(id, { ...pending, loading: true });
    try {
      const file = await readTextFile(pending.path);
      const current = this.tabs.find((tab) => tab.id === id);
      if (!current?.deferred) return;
      const document = editorDocument(file.content);
      const { eol } = document;
      let state = this.withBreakpointLines(
        this.createState(document.text, undefined, this.currentAppearance, eol),
        file.path,
      );
      state = restoreSelection(state, current.deferredSelection ?? current.state.selection.main);
      const hydrated: EditorTab = {
        ...current,
        title: fileName(file.path),
        path: file.path,
        state,
        savedRevision: documentRevision(state),
        diskRevision: file.revision,
        eol,
        dirty: false,
        deferredSelection: undefined,
        deferred: false,
        loading: false,
        deleted: false,
      };
      this.replaceTab(id, hydrated);
      if (usesLanguageServices(state.doc)) {
        this.lspClient?.didOpen(file.path, state.doc.toString());
      }
      if (this.activeId === id) {
        this.view?.setState(hydrated.state);
        this.restoreScroll(hydrated.scrollTop);
        this.updateCursor(hydrated.state);
        this.notice = `已恢复 ${hydrated.title}`;
      }
      this.notifySessionChange();
    } catch (error) {
      const current = this.tabs.find((tab) => tab.id === id);
      if (!current) return;
      this.replaceTab(id, { ...current, deferred: false, loading: false, deleted: true });
      if (this.activeId === id) this.notice = `无法恢复 ${current.title}：${errorMessage(error)}`;
    }
  }

  private createState(
    document: string | Text,
    settings?: AppSettings,
    appearanceExtension?: Extension,
    preferredLineEnding?: LineEnding,
  ): EditorState {
    const appearance =
      appearanceExtension ??
      (settings ? createAppearanceExtension(settings) : createAppearanceExtension({}));

    const text = typeof document === "string" ? editorText(document) : document;
    const largeFile = !usesLanguageServices(text);
    const editingExtensions: Extension[] = largeFile
      ? []
      : [
          foldGutter(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          cpp(),
          EditorView.lineWrapping,
        ];

    const eol = preferredLineEnding
      ?? (typeof document === "string" ? detectLineEnding(document) : "lf");
    return EditorState.create({
      doc: text,
      extensions: [
        createBreakpointGutter((line) => {
          const path = this.activeTab?.path;
          if (!path) {
            this.notice = "请先打开工作区中的 C++ 文件，再设置断点。";
            return;
          }
          this.breakpointToggleHandler?.(path, line);
        }),
        debugLocationField,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        documentRevisionExtension,
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        ...createLspExtensions({
          templateCompletion: (context) => this.templateCompletion(context),
          completion: (context) => this.lspCompletion(context),
          hover: (view, position) => this.lspHoverTooltip(view, position),
          definition: () => void this.goToDefinition(),
          references: () => void this.findReferences(),
          signatureHelp: () => void this.requestSignatureHelp(),
        }, !largeFile),
        ...editingExtensions,
        EditorState.allowMultipleSelections.of(true),
        EditorState.tabSize.of(4),
        indentUnit.of("    "),
        keymap.of([indentWithTab]),
        this.lineEnding.of(EditorState.lineSeparator.of(lineEndingText(eol))),
        this.appearance.of(appearance),
        EditorView.updateListener.of((update) => this.handleViewUpdate(update)),
      ],
    });
  }

  private handleViewUpdate(update: ViewUpdate): void {
    const id = this.activeId;
    const tab = this.activeTab;
    const reference = this.templateReference;
    if (reference && reference.tabId === id && update.docChanged) {
      this.templateReference = {
        ...reference,
        from: update.changes.mapPos(reference.from, -1),
        to: update.changes.mapPos(reference.to, 1),
      };
    }
    if (tab && update.docChanged && !this.suppressDirty) {
      const dirty = documentRevision(update.state) !== tab.savedRevision;
      if (dirty !== tab.dirty) this.replaceTab(id, { ...tab, dirty });
    }
    this.updateCursor(update.state);
    const path = this.activeTab?.path;
    if (update.docChanged && path && this.lspClient?.ready) {
      const wasEnabled = usesLanguageServices(update.startState.doc);
      const isEnabled = usesLanguageServices(update.state.doc);
      const changes = isEnabled ? incrementalChanges(update) : [];
      if (wasEnabled && !isEnabled) {
        this.lspClient.didClose(path);
      } else if (!wasEnabled && isEnabled) {
        this.lspClient.didOpen(path, update.state.doc.toString());
      } else if (isEnabled && changes.length) {
        this.lspClient.didChange(path, changes);
      }
      const signatureTrigger = changes.some((change) => /[(,]$/.test(change.text));
      if (!isEnabled && this.signatureTimer) {
        clearTimeout(this.signatureTimer);
        this.signatureTimer = undefined;
      }
      if (isEnabled && signatureTrigger) {
        if (this.signatureTimer) clearTimeout(this.signatureTimer);
        this.signatureTimer = setTimeout(() => {
          this.signatureTimer = undefined;
          void this.requestSignatureHelp();
        }, 140);
      }
    }
    if (update.docChanged && path) {
      const key = normalizedPath(path);
      const previousLines = this.breakpointLinesByPath.get(key) ?? [];
      if (previousLines.length) {
        const lines = breakpointLines(update.state);
        if (!sameLineNumbers(previousLines, lines)) {
          this.breakpointLinesByPath.set(key, lines);
          this.breakpointMoveHandler?.(path, lines);
        }
      }
    }
    if (update.docChanged) this.notifySessionChange();
  }

  private captureActiveView(): void {
    if (!this.view) return;
    const id = this.activeId;
    const state = this.view.state;
    const scrollTop = this.view.scrollDOM.scrollTop;
    const tab = this.activeTab;
    if (tab) this.replaceTab(id, { ...tab, state, scrollTop });
  }

  private restoreScroll(scrollTop: number): void {
    requestAnimationFrame(() => {
      if (this.view) this.view.scrollDOM.scrollTop = scrollTop;
    });
  }

  private markExternalConflict(id: string, revision: string): void {
    this.tabs = this.tabs.map((tab) =>
      tab.id === id
        ? { ...tab, externalModified: true, externalRevision: revision }
        : tab
    );
    this.notifySessionChange();
  }

  private replaceDocument(id: string, content: string, diskRevision: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    const document = editorDocument(content);
    const { eol, text: replacement } = document;
    const currentState = id === this.activeId && this.view ? this.view.state : tab.state;
    if (currentState.doc.eq(replacement) && tab.eol === eol) {
      this.replaceTab(id, {
        ...tab,
        state: currentState,
        savedRevision: documentRevision(currentState),
        diskRevision,
        eol,
        dirty: false,
        externalModified: false,
        externalRevision: undefined,
        deleted: false,
      });
      this.notifySessionChange();
      return;
    }

    if (id === this.activeId && this.view) {
      this.suppressDirty = true;
      try {
        this.view.dispatch({
          changes: { from: 0, to: this.view.state.doc.length, insert: replacement },
          effects: this.lineEnding.reconfigure(EditorState.lineSeparator.of(lineEndingText(eol))),
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        this.suppressDirty = false;
      }
      const current = this.tabs.find((candidate) => candidate.id === id);
      if (current) {
        this.replaceTab(id, {
          ...current,
          state: this.view.state,
          savedRevision: documentRevision(this.view.state),
          diskRevision,
          eol,
          dirty: false,
          externalModified: false,
          externalRevision: undefined,
          deleted: false,
        });
      }
      this.notifySessionChange();
      return;
    }

    const previousState = tab.state;
    const state = tab.state.update({
      changes: { from: 0, to: tab.state.doc.length, insert: replacement },
      effects: this.lineEnding.reconfigure(EditorState.lineSeparator.of(lineEndingText(eol))),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    this.tabs = this.tabs.map((candidate) =>
      candidate.id === id
        ? {
            ...candidate,
            state,
            savedRevision: documentRevision(state),
            diskRevision,
            eol,
            dirty: false,
            externalModified: false,
            externalRevision: undefined,
            deleted: false,
          }
        : candidate,
    );
    if (tab.path && this.lspClient?.ready) {
      const wasEnabled = usesLanguageServices(previousState.doc);
      const isEnabled = usesLanguageServices(state.doc);
      if (wasEnabled && !isEnabled) {
        this.lspClient.didClose(tab.path);
      } else if (!wasEnabled && isEnabled) {
        this.lspClient.didOpen(tab.path, state.doc.toString());
      } else if (isEnabled) {
        this.lspClient.didChange(tab.path, [{
          range: {
            start: { line: 0, character: 0 },
            end: positionAt(previousState, previousState.doc.length),
          },
          text: state.doc.toString(),
        }]);
      }
    }
    this.notifySessionChange();
  }

  private lspPosition(): { path: string; position: LspPosition } | undefined {
    const tab = this.activeTab;
    const state = this.view?.state ?? tab?.state;
    if (!tab?.path || !state || !this.lspClient?.ready || !usesLanguageServices(state.doc)) {
      return undefined;
    }
    return { path: tab.path, position: positionAt(state, state.selection.main.head) };
  }

  private async lspCompletion(context: CompletionContext): Promise<CompletionResult | null> {
    const tab = this.activeTab;
    if (!tab?.path || !this.lspClient?.ready || !usesLanguageServices(context.state.doc)) {
      return null;
    }
    const word = context.matchBefore(/[\w:]*$/);
    if (!context.explicit && (!word || word.from === word.to)) {
      const trigger = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos);
      if (![".", ">", ":"].includes(trigger)) return null;
    }
    const controller = new AbortController();
    context.addEventListener("abort", () => controller.abort(), { onDocChange: true });
    const triggerCharacter = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos);
    const items = await this.lspClient.completion(
      tab.path,
      positionAt(context.state, context.pos),
      [".", ">", ":"].includes(triggerCharacter)
        ? { triggerKind: 2, triggerCharacter }
        : { triggerKind: 1 },
      controller.signal,
    );
    if (controller.signal.aborted || items.length === 0) return null;
    const from = word?.from ?? context.pos;
    const options: Completion[] = items.map((item) => ({
      label: item.label,
      detail: item.detail || undefined,
      info: item.documentation || undefined,
      type: completionType(item.kind),
      sortText: item.sortText || undefined,
      apply: (view, _completion, completionFrom, completionTo) => {
        const edit = item.textEdit;
        const editFrom = edit ? offsetAt(view.state, edit.range.start) : completionFrom;
        const editTo = edit ? offsetAt(view.state, edit.range.end) : completionTo;
        view.dispatch({
          changes: { from: editFrom, to: editTo, insert: item.insertText },
          selection: { anchor: editFrom + item.insertText.length },
        });
      },
    }));
    return { from, options, validFor: /^[\w:]*$/ };
  }

  private async templateCompletion(context: CompletionContext): Promise<CompletionResult | null> {
    if (!this.templateCompletionProvider || !usesLanguageServices(context.state.doc)) {
      return null;
    }
    const word = context.matchBefore(/[\w\u3400-\u9fff]*$/);
    if (!word || word.from === word.to) return null;

    const controller = new AbortController();
    context.addEventListener("abort", () => controller.abort(), { onDocChange: true });
    const templates = await this.templateCompletionProvider(word.text, controller.signal);
    if (controller.signal.aborted) return null;
    return buildTemplateCompletionResult(
      word.from,
      templates,
      (template, completionFrom, completionTo) => {
        this.templateReference = {
          template,
          tabId: this.activeId,
          from: completionFrom,
          to: completionTo,
        };
      },
      (id) => this.templateReference?.template.id === id,
      (id) => {
        this.templateReference = undefined;
        this.templateCompletionPickedHandler?.(id);
      },
    );
  }

  private async lspHoverTooltip(view: EditorView, position: number): Promise<Tooltip | null> {
    const tab = this.activeTab;
    if (!tab?.path || !this.lspClient?.ready || !usesLanguageServices(view.state.doc)) {
      return null;
    }
    const initialState = view.state;
    const text = await this.lspClient.hover(tab.path, positionAt(initialState, position));
    if (!text || this.view !== view || view.state !== initialState || !samePath(this.activeTab?.path ?? "", tab.path)) return null;
    const word = view.state.wordAt(position);
    return createTextTooltip(word?.from ?? position, text, "cm-lsp-hover", word?.to);
  }

  private updateCursor(state: EditorState): void {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    this.cursorLine = line.number;
    this.cursorColumn = head - line.from + 1;
  }

  private replaceTab(id: string, replacement: EditorTab): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const tabs = this.tabs.slice();
    tabs[index] = replacement;
    this.tabs = tabs;
  }

  private withBreakpointLines(state: EditorState, path?: string): EditorState {
    if (!path) return state;
    const lines = this.breakpointLinesByPath.get(normalizedPath(path));
    return lines?.length
      ? state.update({ effects: setBreakpointLines.of(lines) }).state
      : state;
  }

  private notifySessionChange(): void {
    this.sessionChangeHandler?.();
  }
}

function createBreakpointGutter(toggle: (line: number) => void): Extension {
  return [
    breakpointField,
    gutter({
      class: "cm-breakpoint-gutter",
      markers: (view) => view.state.field(breakpointField),
      initialSpacer: () => breakpointSpacer,
      domEventHandlers: {
        mousedown(view, line, event) {
          if (!(event instanceof MouseEvent) || event.button !== 0) return false;
          event.preventDefault();
          toggle(view.state.doc.lineAt(line.from).number);
          return true;
        },
      },
    }),
  ];
}

function breakpointLines(state: EditorState): number[] {
  const lines: number[] = [];
  state.field(breakpointField).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number);
  });
  return lines;
}

function sameLineNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function restoreSelection(
  state: EditorState,
  selection: EditorRecoverySelection,
): EditorState {
  const anchor = Math.max(0, Math.min(state.doc.length, selection.anchor));
  const head = Math.max(0, Math.min(state.doc.length, selection.head));
  return state.update({ selection: { anchor, head } }).state;
}

function normalizedPath(path: string): string {
  return path.replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function samePath(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

function sameOrChildPath(path: string, parent: string): boolean {
  const normalized = normalizedPath(path);
  const prefix = normalizedPath(parent);
  return normalized === prefix || normalized.startsWith(`${prefix}\\`);
}

function fileName(path: string): string {
  return path.replaceAll("/", "\\").split("\\").at(-1) || path;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { technicalMessage?: unknown; userMessage?: unknown };
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
