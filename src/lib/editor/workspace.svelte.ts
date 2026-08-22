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
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  crosshairCursor,
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
import { tags } from "@lezer/highlight";
import { readTextFile, writeTextFile } from "../api/workspace";
import type { AppSettings } from "../types/settings";
import type { LspClient } from "../lsp/client";
import type { TemplateDetail } from "../types/templates";
import type {
  LspDiagnostic,
  LspLocation,
  LspPosition,
} from "../types/lsp";
import type { WorkspaceChange } from "../types/workspace";
import { normalizeSnippetTemplate } from "./snippets";
import {
  completionType,
  createLspExtensions,
  createTextTooltip,
  incrementalChange,
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
  scrollTop: number;
  dirty: boolean;
  deleted: boolean;
  externalModified: boolean;
  deferred?: boolean;
  loading?: boolean;
}

const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024;

export interface EditorBreakpointLocation {
  file: string;
  line: number;
}

type TemplateCompletionProvider = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly TemplateDetail[]>;

class BreakpointGutterMarker extends GutterMarker {
  elementClass = "cm-breakpoint-marker";

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

const breakpointMarker = new BreakpointGutterMarker();
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

export class EditorWorkspace {
  tabs = $state.raw<EditorTab[]>([]);
  activeId = $state("");
  cursorLine = $state(1);
  cursorColumn = $state(1);
  saveState = $state<"idle" | "saving" | "saved" | "error">("idle");
  notice = $state("");

  private view: EditorView | undefined;
  private readonly appearance = new Compartment();
  private currentAppearance: Extension;
  private nextTabNumber = 1;
  private suppressDirty = false;
  private breakpointToggleHandler: ((file: string, line: number) => void) | undefined;
  private breakpointMoveHandler: ((file: string, lines: number[]) => void) | undefined;
  private lspClient: LspClient | undefined;
  private templateCompletionProvider: TemplateCompletionProvider | undefined;
  private templateCompletionPickedHandler: ((id: number) => void) | undefined;
  private signatureTimer: ReturnType<typeof setTimeout> | undefined;
  private openSequence = 0;
  private readonly recentWrites = new Map<string, number>();
  private readonly hydrationRequests = new Map<string, Promise<void>>();

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
  }

  setLspClient(client: LspClient | undefined): void {
    this.lspClient = client;
  }

  setTemplateCompletionProvider(
    provider: TemplateCompletionProvider | undefined,
    onPicked?: (id: number) => void,
  ): void {
    this.templateCompletionProvider = provider;
    this.templateCompletionPickedHandler = onPicked;
  }

  openLspDocuments(): { path: string; text: string }[] {
    this.captureActiveView();
    return this.tabs.flatMap((tab) =>
      tab.path && !tab.deleted && !tab.deferred
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
      const key = normalizedPath(location.file);
      linesByPath.set(key, [...(linesByPath.get(key) ?? []), location.line]);
    }
    this.tabs = this.tabs.map((tab) => {
      if (!tab.path || tab.id === this.activeId && this.view) return tab;
      const lines = linesByPath.get(normalizedPath(tab.path)) ?? [];
      return { ...tab, state: tab.state.update({ effects: setBreakpointLines.of(lines) }).state };
    });
    const active = this.activeTab;
    if (active?.path && this.view) {
      this.view.dispatch({
        effects: setBreakpointLines.of(linesByPath.get(normalizedPath(active.path)) ?? []),
      });
    }
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
  }

  createTab(): void {
    this.captureActiveView();
    const id = `untitled-${Date.now()}-${this.nextTabNumber}`;
    const title = `未命名-${this.nextTabNumber++}.cpp`;
    const tab: EditorTab = {
      id,
      title,
      state: this.createState("", undefined, this.currentAppearance),
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
      const tab: EditorTab = {
        id: `file-${Date.now()}-${this.nextTabNumber++}`,
        title: fileName(file.path),
        path: file.path,
        state: this.createState(file.content, undefined, this.currentAppearance),
        scrollTop: 0,
        dirty: false,
        deleted: false,
        externalModified: false,
      };
      this.tabs = [...this.tabs, tab];
      this.lspClient?.didOpen(file.path, file.content);
      if (request === this.openSequence) {
        this.activeId = tab.id;
        this.view?.setState(tab.state);
        this.restoreScroll(0);
        this.view?.focus();
        this.notice = `已打开 ${tab.title}`;
      }
    } catch (error) {
      this.saveState = "error";
      this.notice = errorMessage(error);
    }
  }

  async saveActive(): Promise<boolean> {
    if (this.activeTab?.deferred) await this.hydrateTab(this.activeTab.id);
    this.captureActiveView();
    const active = this.activeTab;
    if (!active?.path) {
      this.saveState = "error";
      this.notice = "当前编辑器尚未对应工作区文件。";
      return false;
    }
    if (active.deleted) {
      this.saveState = "error";
      this.notice = `${active.title} 已在 LightCP 外部被删除。`;
      return false;
    }

    const content = active.state.doc.toString();
    this.saveState = "saving";
    this.notice = `正在保存 ${active.title}…`;
    try {
      await writeTextFile(active.path, content);
      this.recentWrites.set(normalizedPath(active.path), performance.now());
      this.tabs = this.tabs.map((tab) =>
        tab.id === active.id
          ? {
              ...tab,
              dirty: tab.state.doc.toString() !== content,
              externalModified: false,
            }
          : tab,
      );
      this.saveState = "saved";
      this.notice = `已保存 ${active.title}`;
      this.lspClient?.didSave(active.path);
      return true;
    } catch (error) {
      this.saveState = "error";
      this.notice = errorMessage(error);
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
    if (change.kind !== "changed") return;

    for (const path of change.paths) {
      const key = normalizedPath(path);
      const writtenAt = this.recentWrites.get(key);
      if (writtenAt !== undefined) {
        this.recentWrites.delete(key);
        if (performance.now() - writtenAt < 1_000) continue;
      }
      const tab = this.tabs.find((candidate) => candidate.path && samePath(candidate.path, path));
      if (!tab) continue;
      if (tab.dirty) {
        this.tabs = this.tabs.map((candidate) =>
          candidate.id === tab.id ? { ...candidate, externalModified: true } : candidate,
        );
        this.notice = `${tab.title} 在磁盘上已更改，但编辑器中仍有未保存内容。`;
        continue;
      }

      try {
        const file = await readTextFile(path);
        const current = this.tabs.find((candidate) => candidate.id === tab.id);
        if (!current || current.dirty || current.deleted) {
          if (current?.dirty) {
            this.tabs = this.tabs.map((candidate) =>
              candidate.id === tab.id ? { ...candidate, externalModified: true } : candidate,
            );
          }
          continue;
        }
        this.replaceDocument(tab.id, file.content);
        this.notice = `检测到外部更改，已重新加载 ${tab.title}。`;
      } catch {
        // A remove/rename notification can race a preceding modify notification.
      }
    }
  }

  handlePathRenamed(previousPath: string, nextPath: string): void {
    this.captureActiveView();
    const renamed: { previous: string; next: string; text: string }[] = [];
    this.tabs = this.tabs.map((tab) => {
      if (!tab.path || !sameOrChildPath(tab.path, previousPath)) return tab;
      const suffix = tab.path.slice(previousPath.length);
      const path = `${nextPath}${suffix}`;
      renamed.push({ previous: tab.path, next: path, text: tab.state.doc.toString() });
      return {
        ...tab,
        path,
        title: fileName(path),
        deleted: false,
      };
    });
    for (const document of renamed) {
      this.lspClient?.didClose(document.previous);
      this.lspClient?.didOpen(document.next, document.text);
    }
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
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    if (id === this.activeId) this.captureActiveView();
    const closing = this.tabs[index];
    if (closing.path && !closing.deleted && !closing.deferred) this.lspClient?.didClose(closing.path);
    const remaining = this.tabs.filter((tab) => tab.id !== id);

    if (remaining.length === 0) {
      this.tabs = [];
      this.activeId = "";
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
    this.tabs = uniquePaths.map((path, index) => ({
      id: `restored-${Date.now()}-${index}`,
      title: fileName(path),
      path,
      state: this.createState("", undefined, this.currentAppearance),
      scrollTop: 0,
      dirty: false,
      deleted: false,
      externalModified: false,
      deferred: true,
      loading: false,
    }));
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
      const hydrated: EditorTab = {
        ...current,
        title: fileName(file.path),
        path: file.path,
        state: this.createState(file.content, undefined, this.currentAppearance),
        deferred: false,
        loading: false,
        deleted: false,
      };
      this.replaceTab(id, hydrated);
      this.lspClient?.didOpen(file.path, file.content);
      if (this.activeId === id) {
        this.view?.setState(hydrated.state);
        this.restoreScroll(hydrated.scrollTop);
        this.updateCursor(hydrated.state);
        this.notice = `已恢复 ${hydrated.title}`;
      }
    } catch (error) {
      const current = this.tabs.find((tab) => tab.id === id);
      if (!current) return;
      this.replaceTab(id, { ...current, deferred: false, loading: false, deleted: true });
      if (this.activeId === id) this.notice = `无法恢复 ${current.title}：${errorMessage(error)}`;
    }
  }

  private createState(
    document: string,
    settings?: AppSettings,
    appearanceExtension?: Extension,
  ): EditorState {
    const appearance =
      appearanceExtension ??
      (settings ? createAppearanceExtension(settings) : createAppearanceExtension({}));

    const largeFile = document.length >= LARGE_FILE_THRESHOLD;
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

    return EditorState.create({
      doc: document,
      extensions: [
        createBreakpointGutter((line) => {
          const path = this.activeTab?.path;
          if (!path) {
            this.notice = "请先打开工作区中的 C++ 文件，再设置断点。";
            return;
          }
          this.breakpointToggleHandler?.(path, line);
        }),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
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
        this.appearance.of(appearance),
        EditorView.updateListener.of((update) => this.handleViewUpdate(update)),
      ],
    });
  }

  private handleViewUpdate(update: ViewUpdate): void {
    const id = this.activeId;
    const tab = this.activeTab;
    if (tab && update.docChanged && !this.suppressDirty && !tab.dirty) {
      this.replaceTab(id, { ...tab, dirty: true });
    }
    this.updateCursor(update.state);
    const path = this.activeTab?.path;
    if (update.docChanged && path && this.lspClient?.ready) {
      const change = incrementalChange(update);
      if (change) this.lspClient.didChange(path, [change]);
      if (update.state.doc.length < LARGE_FILE_THRESHOLD && change && /[(,]$/.test(change.text)) {
        if (this.signatureTimer) clearTimeout(this.signatureTimer);
        this.signatureTimer = setTimeout(() => {
          this.signatureTimer = undefined;
          void this.requestSignatureHelp();
        }, 140);
      }
    }
    if (update.docChanged && path && this.breakpointMoveHandler) {
      this.breakpointMoveHandler(path, breakpointLines(update.state));
    }
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

  private replaceDocument(id: string, content: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab || tab.state.doc.toString() === content) return;

    if (id === this.activeId && this.view) {
      this.suppressDirty = true;
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: content },
      });
      this.suppressDirty = false;
      const current = this.tabs.find((candidate) => candidate.id === id);
      if (current) {
        this.replaceTab(id, {
          ...current,
          state: this.view.state,
          dirty: false,
          externalModified: false,
          deleted: false,
        });
      }
      return;
    }

    const previousState = tab.state;
    this.suppressDirty = true;
    const state = tab.state.update({
      changes: { from: 0, to: tab.state.doc.length, insert: content },
    }).state;
    this.suppressDirty = false;
    this.tabs = this.tabs.map((candidate) =>
      candidate.id === id
        ? { ...candidate, state, dirty: false, externalModified: false, deleted: false }
        : candidate,
    );
    if (tab.path && this.lspClient?.ready) {
      this.lspClient.didChange(tab.path, [{
        range: {
          start: { line: 0, character: 0 },
          end: positionAt(previousState, previousState.doc.length),
        },
        text: content,
      }]);
    }
  }

  private lspPosition(): { path: string; position: LspPosition } | undefined {
    const tab = this.activeTab;
    const state = this.view?.state ?? tab?.state;
    if (!tab?.path || !state || !this.lspClient?.ready) return undefined;
    return { path: tab.path, position: positionAt(state, state.selection.main.head) };
  }

  private async lspCompletion(context: CompletionContext): Promise<CompletionResult | null> {
    const tab = this.activeTab;
    if (!tab?.path || !this.lspClient?.ready || context.state.doc.length >= LARGE_FILE_THRESHOLD) {
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
    if (!this.templateCompletionProvider || context.state.doc.length >= LARGE_FILE_THRESHOLD) {
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
      (id) => this.templateCompletionPickedHandler?.(id),
    );
  }

  private async lspHoverTooltip(view: EditorView, position: number): Promise<Tooltip | null> {
    const tab = this.activeTab;
    if (!tab?.path || !this.lspClient?.ready || view.state.doc.length >= LARGE_FILE_THRESHOLD) {
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
}

function createBreakpointGutter(toggle: (line: number) => void): Extension {
  return [
    breakpointField,
    gutter({
      class: "cm-breakpoint-gutter",
      markers: (view) => view.state.field(breakpointField),
      initialSpacer: () => breakpointMarker,
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

function createAppearanceExtension(settings: Partial<AppSettings>): Extension {
  const light = settings.theme === "light";
  const fontFamily = settings.fontFamily ?? "JetBrains Mono, Consolas, monospace";
  const fontSize = settings.fontSize ?? 14;
  const lineHeight = settings.lineHeight ?? 1.62;

  const colors = light
    ? {
        text: "#20242c",
        muted: "#7b8291",
        activeLine: "rgba(59, 130, 246, 0.075)",
        selection: "rgba(55, 116, 205, 0.22)",
        cursor: "#2563eb",
        keyword: "#8b3fc7",
        type: "#096f78",
        string: "#9b4b12",
        number: "#2266a8",
        comment: "#71806c",
        function: "#2459a5",
        variable: "#20242c",
      }
    : {
        text: "#d9dde7",
        muted: "#626a79",
        activeLine: "rgba(103, 155, 235, 0.08)",
        selection: "rgba(78, 133, 209, 0.3)",
        cursor: "#82b7ff",
        keyword: "#c78bdf",
        type: "#68c8c0",
        string: "#d7a86e",
        number: "#75b7e8",
        comment: "#788775",
        function: "#82aef2",
        variable: "#d9dde7",
      };

  const editorTheme = EditorView.theme(
    {
      "&": {
        height: "100%",
        color: colors.text,
        backgroundColor: "transparent",
        fontSize: `${fontSize}px`,
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily,
        lineHeight: String(lineHeight),
      },
      ".cm-content": {
        minHeight: "100%",
        padding: "12px 0 32px",
        caretColor: colors.cursor,
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.cursor },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: colors.selection,
      },
      ".cm-activeLine": { backgroundColor: colors.activeLine },
      ".cm-gutters": {
        minWidth: "46px",
        color: colors.muted,
        backgroundColor: "transparent",
        borderRight: "1px solid var(--border)",
      },
      ".cm-activeLineGutter": {
        color: colors.text,
        backgroundColor: colors.activeLine,
      },
      ".cm-foldPlaceholder": {
        color: colors.muted,
        backgroundColor: "transparent",
        border: "0",
      },
      ".cm-panels": {
        color: colors.text,
        backgroundColor: "var(--panel-background)",
      },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
      ".cm-searchMatch": { backgroundColor: "rgba(231, 175, 75, 0.28)" },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(78, 133, 209, 0.38)" },
    },
    { dark: !light },
  );

  const highlightStyle = HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: colors.keyword },
    { tag: [tags.typeName, tags.className, tags.namespace], color: colors.type },
    { tag: [tags.string, tags.character, tags.special(tags.string)], color: colors.string },
    { tag: [tags.number, tags.bool, tags.null], color: colors.number },
    { tag: [tags.lineComment, tags.blockComment], color: colors.comment, fontStyle: "italic" },
    { tag: [tags.function(tags.variableName), tags.labelName], color: colors.function },
    { tag: [tags.variableName, tags.propertyName], color: colors.variable },
    { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: colors.function },
    { tag: tags.meta, color: colors.keyword },
  ]);

  return [editorTheme, syntaxHighlighting(highlightStyle)];
}
