import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { snippet } from "@codemirror/autocomplete";
import { cpp } from "@codemirror/lang-cpp";
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
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { readTextFile, writeTextFile } from "../api/workspace";
import type { AppSettings } from "../types/settings";
import type { WorkspaceChange } from "../types/workspace";
import { normalizeSnippetTemplate } from "./snippets";

export interface EditorTab {
  id: string;
  title: string;
  path?: string;
  state: EditorState;
  scrollTop: number;
  dirty: boolean;
  deleted: boolean;
  externalModified: boolean;
}

const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024;

export interface EditorBreakpointLocation {
  file: string;
  line: number;
}

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

const STARTER_TABS = [
  {
    title: "main.cpp",
    document: `#include <bits/stdc++.h>
using namespace std;

void solve() {
    int n;
    cin >> n;

    vector<int> a(n);
    for (int &value : a) cin >> value;

    cout << accumulate(a.begin(), a.end(), 0LL) << '\\n';
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int tests = 1;
    // cin >> tests;
    while (tests--) solve();
}
`,
  },
  {
    title: "graph.cpp",
    document: `#include <bits/stdc++.h>
using namespace std;

vector<int> bfs(const vector<vector<int>>& graph, int source) {
    vector<int> distance(graph.size(), -1);
    queue<int> pending;

    distance[source] = 0;
    pending.push(source);

    while (!pending.empty()) {
        int node = pending.front();
        pending.pop();
        for (int next : graph[node]) {
            if (distance[next] != -1) continue;
            distance[next] = distance[node] + 1;
            pending.push(next);
        }
    }
    return distance;
}
`,
  },
  {
    title: "scratch.cpp",
    document: `// Temporary contest notes
// Editor state, cursor, selection, undo history and scroll are kept per tab.

`,
  },
] as const;

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
  private openSequence = 0;
  private readonly recentWrites = new Map<string, number>();

  constructor(settings: AppSettings) {
    this.currentAppearance = createAppearanceExtension(settings);
    this.tabs = STARTER_TABS.map((tab, index) => ({
      id: `starter-${index + 1}`,
      title: tab.title,
      state: this.createState(tab.document, undefined, this.currentAppearance),
      scrollTop: 0,
      dirty: false,
      deleted: false,
      externalModified: false,
    }));
    this.activeId = this.tabs[0]?.id ?? "";
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
    if (id === this.activeId || !this.tabs.some((tab) => tab.id === id)) return;
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
    this.tabs = this.tabs.map((tab) => {
      if (!tab.path || !sameOrChildPath(tab.path, previousPath)) return tab;
      const suffix = tab.path.slice(previousPath.length);
      const path = `${nextPath}${suffix}`;
      return {
        ...tab,
        path,
        title: fileName(path),
        deleted: false,
      };
    });
  }

  handlePathDeleted(path: string): void {
    let affected = false;
    this.tabs = this.tabs.map((tab) => {
      if (!tab.path || !sameOrChildPath(tab.path, path)) return tab;
      affected = true;
      return { ...tab, deleted: true };
    });
    if (affected) this.notice = `${fileName(path)} 已在当前编辑器外部被删除。`;
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    if (id === this.activeId) this.captureActiveView();
    const remaining = this.tabs.filter((tab) => tab.id !== id);

    if (remaining.length === 0) {
      this.tabs = [];
      this.activeId = "";
      this.createTab();
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
        keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
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

  private handleViewUpdate(update: { state: EditorState; docChanged: boolean }): void {
    const id = this.activeId;
    const tab = this.activeTab;
    if (tab && update.docChanged && !this.suppressDirty && !tab.dirty) {
      this.replaceTab(id, { ...tab, dirty: true });
    }
    this.updateCursor(update.state);
    const path = this.activeTab?.path;
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
        gutter: "rgba(243, 245, 249, 0.92)",
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
        gutter: "rgba(18, 20, 25, 0.9)",
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
        backgroundColor: colors.gutter,
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
