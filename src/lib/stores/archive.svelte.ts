import {
  bulkUpdateArchive,
  createSmartCollection,
  deleteSmartCollection,
  emptyArchiveFacets,
  getArchiveFile,
  listArchiveFacets,
  listArchiveFiles,
  listArchiveTags,
  listSmartCollections,
  saveArchiveFile,
  setArchiveFavorite,
  updateSmartCollection,
} from "../api/archive";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type {
  ArchiveBulkInput,
  ArchiveFile,
  ArchiveInput,
  ArchiveQuery,
  ArchiveFacets,
  SmartCollection,
  SmartCollectionInput,
} from "../types/archive";

const EMPTY_QUERY: ArchiveQuery = {
  search: "",
  inboxOnly: false,
  favoriteOnly: false,
  recentOnly: false,
};

export class ArchiveStore {
  files = $state.raw<ArchiveFile[]>([]);
  facets = $state.raw<ArchiveFacets>(emptyArchiveFacets());
  collections = $state.raw<SmartCollection[]>([]);
  knownTags = $state.raw<string[]>([]);
  selectedIds = $state.raw<number[]>([]);
  activeView = $state("inbox");
  activeLabel = $state("收件箱");
  search = $state("");
  loading = $state(false);
  saving = $state(false);
  workspaceReady = $state(false);
  error = $state("");
  notice = $state("");
  quickArchivePath = $state<string>();

  private query: ArchiveQuery = { ...EMPTY_QUERY, inboxOnly: true };
  private request = 0;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly editor: EditorWorkspace) {}

  dispose(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  async setWorkspaceReady(ready: boolean): Promise<void> {
    this.workspaceReady = ready;
    this.selectedIds = [];
    this.error = "";
    if (ready) {
      await this.selectView("inbox", "收件箱", { inboxOnly: true });
    } else {
      this.files = [];
      this.facets = emptyArchiveFacets();
      this.collections = [];
    }
  }

  async refreshAll(): Promise<void> {
    if (!this.workspaceReady) return;
    this.error = "";
    try {
      const [facets, collections, tags] = await Promise.all([
        listArchiveFacets(),
        listSmartCollections(),
        listArchiveTags(),
      ]);
      this.facets = facets;
      this.collections = collections;
      this.knownTags = tags;
      await this.refreshFiles();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async refreshFiles(): Promise<void> {
    if (!this.workspaceReady) return;
    const request = ++this.request;
    this.loading = true;
    try {
      const files = await listArchiveFiles({ ...this.query, search: this.search });
      if (request !== this.request) return;
      this.files = files;
      const visible = new Set(files.map((file) => file.id));
      this.selectedIds = this.selectedIds.filter((id) => visible.has(id));
    } catch (error) {
      if (request === this.request) this.error = errorMessage(error);
    } finally {
      if (request === this.request) this.loading = false;
    }
  }

  async selectView(
    id: string,
    label: string,
    query: Partial<ArchiveQuery> = {},
  ): Promise<void> {
    this.activeView = id;
    this.activeLabel = label;
    this.query = { ...EMPTY_QUERY, ...query };
    this.selectedIds = [];
    await this.refreshFiles();
  }

  setSearch(search: string): void {
    this.search = search;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.refreshFiles(), 180);
  }

  toggleSelected(id: number, selected: boolean): void {
    this.selectedIds = selected
      ? [...new Set([...this.selectedIds, id])]
      : this.selectedIds.filter((candidate) => candidate !== id);
  }

  selectAll(selected: boolean): void {
    this.selectedIds = selected ? this.files.map((file) => file.id) : [];
  }

  isSelected(id: number): boolean {
    return this.selectedIds.includes(id);
  }

  async openFile(file: ArchiveFile): Promise<void> {
    await this.editor.openFile(file.path);
    await this.refreshAll();
  }

  openQuickArchive(): boolean {
    const path = this.editor.activeTab?.path;
    if (!path || !path.toLowerCase().endsWith(".cpp")) {
      this.error = "请先打开一个工作区中的 .cpp 文件。";
      this.editor.notice = this.error;
      return false;
    }
    if (this.knownTags.length === 0) {
      void listArchiveTags()
        .then((tags) => (this.knownTags = tags))
        .catch(() => undefined);
    }
    this.quickArchivePath = path;
    return true;
  }

  closeQuickArchive(): void {
    this.quickArchivePath = undefined;
    this.editor.focus();
  }

  loadFile(path: string): Promise<ArchiveFile | undefined> {
    return getArchiveFile(path);
  }

  async saveFile(input: ArchiveInput): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    this.error = "";
    try {
      const saved = await saveArchiveFile(input);
      this.notice = `已归档 ${saved.title}`;
      await this.refreshAll();
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      return false;
    } finally {
      this.saving = false;
    }
  }

  async toggleFavorite(file: ArchiveFile): Promise<void> {
    try {
      await setArchiveFavorite(file.id, !file.favorite);
      await this.refreshAll();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async bulkUpdate(input: Omit<ArchiveBulkInput, "fileIds">): Promise<boolean> {
    if (!this.selectedIds.length) return false;
    this.saving = true;
    try {
      await bulkUpdateArchive({ ...input, fileIds: [...this.selectedIds] });
      this.notice = `已更新 ${this.selectedIds.length} 个文件`;
      this.selectedIds = [];
      await this.refreshAll();
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      return false;
    } finally {
      this.saving = false;
    }
  }

  async createCollection(input: SmartCollectionInput): Promise<SmartCollection | undefined> {
    try {
      const collection = await createSmartCollection(input);
      await this.refreshAll();
      return collection;
    } catch (error) {
      this.error = errorMessage(error);
      return undefined;
    }
  }

  async updateCollection(
    id: number,
    input: SmartCollectionInput,
  ): Promise<SmartCollection | undefined> {
    try {
      const collection = await updateSmartCollection(id, input);
      await this.refreshAll();
      return collection;
    } catch (error) {
      this.error = errorMessage(error);
      return undefined;
    }
  }

  async deleteCollection(collection: SmartCollection): Promise<void> {
    if (!window.confirm(`确定删除智能集合“${collection.name}”吗？`)) return;
    try {
      await deleteSmartCollection(collection.id);
      if (this.activeView === `collection-${collection.id}`) {
        await this.selectView("inbox", "收件箱", { inboxOnly: true });
      }
      await this.refreshAll();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { userMessage?: unknown; technicalMessage?: unknown };
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
