import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  chooseWorkspaceFolder,
  createDirectory,
  createFile,
  deleteEntry,
  listDirectory,
  listRecentWorkspaces,
  moveEntry,
  openWorkspace,
  renameEntry,
} from "../api/workspace";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type { ArchiveStore } from "./archive.svelte";
import type {
  FileEntry,
  TreeRow,
  WorkspaceChange,
  WorkspaceInfo,
} from "../types/workspace";
import { recordIpcEvent, recordWorkspaceLoad } from "../performance";

interface DirectoryState {
  loaded: boolean;
  expanded: boolean;
  loading: boolean;
  children: FileEntry[];
}

type WorkspaceChangeGuard = (nextPath: string) => Promise<boolean>;

export class WorkspaceStore {
  info = $state<WorkspaceInfo>();
  recent = $state.raw<WorkspaceInfo[]>([]);
  selectedPath = $state("");
  loading = $state(false);
  error = $state("");

  private readonly directories = new Map<string, DirectoryState>();
  private revision = $state(0);
  private unlisten: UnlistenFn | undefined;
  private pendingChanges: WorkspaceChange[] = [];
  private eventTimer: ReturnType<typeof setTimeout> | undefined;
  private visibleRowsCache: TreeRow[] = [];
  private visibleRowsRevision = -1;
  private disposed = false;
  private workspaceChangeGuard: WorkspaceChangeGuard | undefined;
  private openQueue: Promise<void> = Promise.resolve();
  private revealSequence = 0;

  constructor(
    private readonly editor: EditorWorkspace,
    private readonly archive?: ArchiveStore,
  ) {}

  get visibleRows(): TreeRow[] {
    const revision = this.revision;
    if (!this.info) return [];
    if (revision !== this.visibleRowsRevision) {
      const rows: TreeRow[] = [];
      this.appendRows(this.info.path, 0, rows);
      this.visibleRowsCache = rows;
      this.visibleRowsRevision = revision;
    }
    return this.visibleRowsCache;
  }

  async initialize(): Promise<void> {
    await this.refreshRecent();
    if (!isTauri()) return;
    try {
      const unlisten = await listen<WorkspaceChange[] | WorkspaceChange>("workspace-changed", (event) => {
        recordIpcEvent();
        this.pendingChanges.push(...(Array.isArray(event.payload) ? event.payload : [event.payload]));
        if (this.eventTimer) clearTimeout(this.eventTimer);
        this.eventTimer = setTimeout(() => void this.flushChanges(), 90);
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
    if (this.eventTimer) clearTimeout(this.eventTimer);
    this.eventTimer = undefined;
  }

  setWorkspaceChangeGuard(guard: WorkspaceChangeGuard | undefined): void {
    this.workspaceChangeGuard = guard;
  }

  async openFolderPicker(): Promise<void> {
    try {
      const path = await chooseWorkspaceFolder();
      if (path) await this.openPath(path);
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  openPath(path: string): Promise<void> {
    const operation = this.openQueue.then(() => this.performOpenPath(path));
    this.openQueue = operation.catch(() => undefined);
    return operation;
  }

  private async performOpenPath(path: string): Promise<void> {
    if (this.info && samePath(this.info.path, path)) return;
    if (this.editor.tabs.length > 0 && this.workspaceChangeGuard) {
      if (!await this.workspaceChangeGuard(path)) return;
    }
    const started = performance.now();
    this.loading = true;
    this.error = "";
    try {
      const info = await openWorkspace(path);
      if (this.editor.tabs.length > 0) this.editor.closeAllTabs();
      this.info = info;
      this.selectedPath = info.path;
      this.directories.clear();
      this.directories.set(pathKey(info.path), {
        loaded: false,
        expanded: true,
        loading: false,
        children: [],
      });
      this.bump();
      await this.loadDirectory(info.path, true);
      await this.refreshRecent();
      await this.archive?.setWorkspaceReady(true);
      recordWorkspaceLoad(performance.now() - started);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  select(path: string): void {
    this.selectedPath = path;
  }

  async revealPath(path: string): Promise<void> {
    const root = this.info?.path;
    if (!root || !sameOrChildKey(pathKey(path), pathKey(root))) return;
    const request = ++this.revealSequence;
    const directories: string[] = [];
    let current = samePath(path, root) ? root : parentPath(path);
    while (current && sameOrChildKey(pathKey(current), pathKey(root))) {
      directories.unshift(current);
      if (samePath(current, root)) break;
      current = parentPath(current);
    }
    if (!directories.some((directory) => samePath(directory, root))) return;

    for (const directory of directories) {
      const state = this.ensureDirectory(directory);
      if (!state.expanded) {
        state.expanded = true;
        this.bump();
      }
      if (!state.loaded) await this.loadDirectory(directory);
      if (request !== this.revealSequence || !samePath(this.info?.path ?? "", root)) return;
    }
    this.selectedPath = path;
    this.bump();
  }

  async toggleDirectory(entry: FileEntry): Promise<void> {
    if (entry.kind !== "directory") return;
    const state = this.ensureDirectory(entry.path);
    state.expanded = !state.expanded;
    this.bump();
    if (state.expanded && !state.loaded) await this.loadDirectory(entry.path);
  }

  async refresh(): Promise<void> {
    if (!this.info) return;
    const paths = [...this.directories.entries()]
      .filter(([, state]) => state.loaded)
      .map(([key]) => this.directoryPathForKey(key))
      .filter((path): path is string => Boolean(path));
    if (!paths.some((path) => samePath(path, this.info?.path ?? ""))) {
      paths.unshift(this.info.path);
    }
    await Promise.all(paths.map((path) => this.loadDirectory(path, true)));
    await this.archive?.refreshAll();
  }

  async create(
    parent: string,
    name: string,
    kind: "file" | "directory",
    content = "",
  ): Promise<string | undefined> {
    this.error = "";
    try {
      const result = kind === "file"
        ? await createFile(parent, name, content)
        : await createDirectory(parent, name);
      const parentState = this.ensureDirectory(parent);
      parentState.expanded = true;
      await this.loadDirectory(parent, true);
      this.selectedPath = result.path;
      if (kind === "file") await this.editor.openFile(result.path);
      await this.archive?.refreshAll();
      return result.path;
    } catch (error) {
      this.error = errorMessage(error);
      return undefined;
    }
  }

  async rename(entry: FileEntry, newName: string): Promise<void> {
    this.error = "";
    try {
      const result = await renameEntry(entry.path, newName);
      this.editor.handlePathRenamed(entry.path, result.path);
      this.dropDirectoryStates(entry.path);
      await this.refreshLoadedParent(entry.path);
      this.selectedPath = result.path;
      await this.archive?.refreshAll();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async delete(entry: FileEntry): Promise<void> {
    this.error = "";
    try {
      await deleteEntry(entry.path);
      this.editor.handlePathDeleted(entry.path);
      this.dropDirectoryStates(entry.path);
      await this.refreshLoadedParent(entry.path);
      this.selectedPath = this.info?.path ?? "";
      await this.archive?.refreshAll();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async move(entry: FileEntry, targetDirectory: string): Promise<void> {
    if (samePath(parentPath(entry.path), targetDirectory)) return;
    this.error = "";
    try {
      const result = await moveEntry(entry.path, targetDirectory);
      this.editor.handlePathRenamed(entry.path, result.path);
      this.dropDirectoryStates(entry.path);
      await Promise.all([
        this.refreshLoadedParent(entry.path),
        this.loadDirectory(targetDirectory, true),
      ]);
      this.selectedPath = result.path;
      await this.archive?.refreshAll();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  entryDirectory(entry?: FileEntry): string | undefined {
    if (!this.info) return undefined;
    if (!entry) return this.info.path;
    return entry.kind === "directory" ? entry.path : parentPath(entry.path);
  }

  private appendRows(directory: string, depth: number, rows: TreeRow[]): void {
    const state = this.directories.get(pathKey(directory));
    if (!state?.loaded) return;
    for (const entry of state.children) {
      const childState = entry.kind === "directory"
        ? this.directories.get(pathKey(entry.path))
        : undefined;
      rows.push({
        entry,
        depth,
        expanded: childState?.expanded ?? false,
        loading: childState?.loading ?? false,
      });
      if (entry.kind === "directory" && childState?.expanded) {
        this.appendRows(entry.path, depth + 1, rows);
      }
    }
  }

  private async loadDirectory(path: string, force = false): Promise<void> {
    const state = this.ensureDirectory(path);
    if (state.loading || (state.loaded && !force)) return;
    state.loading = true;
    this.bump();
    try {
      const children = await listDirectory(path);
      state.children = children;
      state.loaded = true;
      for (const child of children) {
        if (child.kind === "directory") this.ensureDirectory(child.path);
      }
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      state.loading = false;
      this.bump();
    }
  }

  private ensureDirectory(path: string): DirectoryState {
    const key = pathKey(path);
    let state = this.directories.get(key);
    if (!state) {
      state = { loaded: false, expanded: false, loading: false, children: [] };
      this.directories.set(key, state);
    }
    return state;
  }

  private async refreshRecent(): Promise<void> {
    try {
      this.recent = await listRecentWorkspaces();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  private async flushChanges(): Promise<void> {
    const changes = this.pendingChanges.splice(0);
    this.eventTimer = undefined;
    if (!this.info || changes.length === 0) return;

    const parents = new Map<string, string>();
    const grouped = coalesceChanges(changes);
    let structuralChange = false;
    for (const change of grouped) {
      structuralChange ||= change.kind !== "changed";
      await this.editor.handleExternalChange(change);
      for (const path of change.paths) {
        const parent = parentPath(path);
        if (parent) parents.set(pathKey(parent), parent);
      }
    }

    await Promise.all(
      [...parents.values()]
        .filter((path) => this.directories.get(pathKey(path))?.loaded)
        .map((path) => this.loadDirectory(path, true)),
    );
    if (structuralChange) await this.archive?.refreshAll();
  }

  private async refreshLoadedParent(path: string): Promise<void> {
    const parent = parentPath(path);
    if (parent && this.directories.get(pathKey(parent))?.loaded) {
      await this.loadDirectory(parent, true);
    }
  }

  private dropDirectoryStates(path: string): void {
    for (const key of this.directories.keys()) {
      if (sameOrChildKey(key, pathKey(path))) this.directories.delete(key);
    }
    this.bump();
  }

  private directoryPathForKey(key: string): string | undefined {
    if (this.info && pathKey(this.info.path) === key) return this.info.path;
    for (const state of this.directories.values()) {
      const entry = state.children.find(
        (child) => child.kind === "directory" && pathKey(child.path) === key,
      );
      if (entry) return entry.path;
    }
    return undefined;
  }

  private bump(): void {
    this.revision += 1;
  }
}

function coalesceChanges(changes: WorkspaceChange[]): WorkspaceChange[] {
  const pathsByKind = new Map<string, Map<string, string>>();
  const renamed: WorkspaceChange[] = [];
  for (const change of changes) {
    if (change.kind === "renamed") {
      renamed.push(change);
      continue;
    }
    let paths = pathsByKind.get(change.kind);
    if (!paths) {
      paths = new Map();
      pathsByKind.set(change.kind, paths);
    }
    for (const path of change.paths) paths.set(pathKey(path), path);
  }
  return [
    ...renamed,
    ...[...pathsByKind.entries()].map(([kind, paths]) => ({
      kind: kind as WorkspaceChange["kind"],
      paths: [...paths.values()],
    })),
  ];
}

function pathKey(path: string): string {
  return path.replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function sameOrChildKey(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}\\`);
}

function parentPath(path: string): string {
  const normalized = path.replaceAll("/", "\\").replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  if (index < 0) return "";
  if (index === 2 && normalized[1] === ":") return normalized.slice(0, 3);
  return normalized.slice(0, index);
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { technicalMessage?: unknown; userMessage?: unknown };
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
