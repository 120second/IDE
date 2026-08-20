import {
  createTemplate,
  createTemplateCategory,
  deleteTemplate,
  deleteTemplateCategory,
  getTemplate,
  getTemplateVersion,
  listTemplateCategories,
  listTemplates,
  listTemplateVersions,
  moveTemplate,
  moveTemplateCategory,
  recordTemplateUse,
  renameTemplateCategory,
  restoreTemplateVersion,
  setTemplateFavorite,
  updateTemplate,
} from "../api/templates";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type {
  TemplateCategory,
  TemplateCategoryRow,
  TemplateCollection,
  TemplateDetail,
  TemplateFilter,
  TemplateInput,
  TemplateKind,
  TemplateMetadata,
  TemplateSort,
  TemplateVersionDetail,
  TemplateVersionMetadata,
} from "../types/templates";
import { buildTemplateCategoryRows } from "../templateTree";

const EMPTY_DRAFT: TemplateInput = {
  kind: "snippet",
  name: "",
  trigger: "",
  aliases: [],
  description: "",
  language: "cpp",
  categoryId: undefined,
  favorite: false,
  code: "",
};

export class TemplateStore {
  categories = $state.raw<TemplateCategory[]>([]);
  templates = $state.raw<TemplateMetadata[]>([]);
  fileTemplates = $state.raw<TemplateMetadata[]>([]);
  quickResults = $state.raw<TemplateMetadata[]>([]);
  versions = $state.raw<TemplateVersionMetadata[]>([]);
  versionPreview = $state<TemplateVersionDetail>();
  detail = $state<TemplateDetail>();
  draft = $state<TemplateInput>({ ...EMPTY_DRAFT });

  kind = $state<TemplateKind>("snippet");
  sort = $state<TemplateSort>("manual");
  collection = $state<TemplateCollection>("all");
  selectedCategoryId = $state<number>();
  selectedId = $state<number>();
  mode = $state<"empty" | "view" | "create">("empty");
  search = $state("");
  loading = $state(false);
  detailLoading = $state(false);
  saving = $state(false);
  historyLoading = $state(false);
  error = $state("");
  notice = $state("");

  private readonly expandedCategories = new Set<number>();
  private categoryRevision = $state(0);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private listRequest = 0;
  private quickRequest = 0;
  private initialized = false;
  private initializePromise: Promise<void> | undefined;
  private fileTemplatesLoaded = false;
  private fileTemplatesPromise: Promise<void> | undefined;
  private categoryRowsCache: TemplateCategoryRow[] = [];
  private categoryRowsCacheRevision = -1;

  constructor(private readonly editor: EditorWorkspace) {}

  get categoryRows(): TemplateCategoryRow[] {
    const revision = this.categoryRevision;
    if (revision !== this.categoryRowsCacheRevision) {
      this.categoryRowsCache = this.buildCategoryRows();
      this.categoryRowsCacheRevision = revision;
    }
    return this.categoryRowsCache;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.loadInitialMetadata();
    await this.initializePromise;
  }

  private async loadInitialMetadata(): Promise<void> {
    const initialListRequest = this.listRequest;
    this.loading = true;
    try {
      const [categories, snippets] = await Promise.all([
        listTemplateCategories(),
        listTemplates(defaultFilter("snippet")),
      ]);
      this.categories = categories;
      if (this.kind === "snippet" && this.listRequest === initialListRequest) {
        this.templates = snippets;
      }
      this.categoryRevision += 1;
      this.initialized = true;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      if (this.listRequest === initialListRequest) this.loading = false;
      this.initializePromise = undefined;
    }
  }

  dispose(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  async setKind(kind: TemplateKind): Promise<void> {
    if (this.kind === kind) return;
    this.kind = kind;
    this.collection = "all";
    this.selectedCategoryId = undefined;
    this.selectedId = undefined;
    this.detail = undefined;
    this.mode = "empty";
    await this.refreshTemplates();
  }

  async setCollection(collection: TemplateCollection): Promise<void> {
    this.collection = collection;
    this.selectedCategoryId = undefined;
    await this.refreshTemplates();
  }

  async setCategory(categoryId?: number): Promise<void> {
    this.collection = "all";
    this.selectedCategoryId = categoryId;
    await this.refreshTemplates();
  }

  async setSort(sort: TemplateSort): Promise<void> {
    this.sort = sort;
    await this.refreshTemplates();
  }

  setSearch(search: string): void {
    this.search = search;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.refreshTemplates(), 180);
  }

  async refreshTemplates(): Promise<void> {
    const request = ++this.listRequest;
    this.loading = true;
    this.error = "";
    try {
      const results = await listTemplates(this.currentFilter());
      if (request !== this.listRequest) return;
      this.templates = results;
    } catch (error) {
      if (request === this.listRequest) this.error = errorMessage(error);
    } finally {
      if (request === this.listRequest) this.loading = false;
    }
  }

  async refreshFileTemplates(): Promise<void> {
    try {
      this.fileTemplates = await listTemplates(defaultFilter("file"));
      this.fileTemplatesLoaded = true;
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async ensureFileTemplates(): Promise<void> {
    if (this.fileTemplatesLoaded) return;
    if (this.fileTemplatesPromise) return this.fileTemplatesPromise;
    this.fileTemplatesPromise = this.refreshFileTemplates();
    try {
      await this.fileTemplatesPromise;
    } finally {
      this.fileTemplatesPromise = undefined;
    }
  }

  toggleCategory(id: number): void {
    if (this.expandedCategories.has(id)) this.expandedCategories.delete(id);
    else this.expandedCategories.add(id);
    this.categoryRevision += 1;
  }

  async createCategory(parentId?: number): Promise<void> {
    const name = window.prompt("分类名称")?.trim();
    if (!name) return;
    this.error = "";
    try {
      await createTemplateCategory(name, parentId);
      if (parentId) this.expandedCategories.add(parentId);
      await this.refreshCategories();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async renameCategory(category: TemplateCategory): Promise<void> {
    const name = window.prompt("重命名分类", category.name)?.trim();
    if (!name || name === category.name) return;
    try {
      await renameTemplateCategory(category.id, name);
      await this.refreshCategories();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async deleteCategory(category: TemplateCategory): Promise<void> {
    if (!window.confirm(`确定删除分类“${category.name}”及其所有子分类吗？`)) return;
    try {
      await deleteTemplateCategory(category.id);
      this.selectedCategoryId = undefined;
      await Promise.all([this.refreshCategories(), this.refreshTemplates()]);
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async moveCategory(id: number, parentId: number | undefined, targetIndex: number): Promise<void> {
    this.error = "";
    try {
      await moveTemplateCategory(id, parentId, targetIndex);
      if (parentId) this.expandedCategories.add(parentId);
      await this.refreshCategories();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  beginCreate(kind: TemplateKind = this.kind, code = ""): void {
    const kindChanged = this.kind !== kind;
    this.kind = kind;
    this.selectedId = undefined;
    this.detail = undefined;
    this.versions = [];
    this.versionPreview = undefined;
    this.draft = {
      ...EMPTY_DRAFT,
      kind,
      categoryId: this.selectedCategoryId,
      code,
    };
    this.mode = "create";
    if (kindChanged) void this.refreshTemplates();
  }

  async openTemplate(id: number): Promise<void> {
    if (this.selectedId === id && this.detail) return;
    this.selectedId = id;
    this.detail = undefined;
    this.versions = [];
    this.versionPreview = undefined;
    this.detailLoading = true;
    this.error = "";
    try {
      const detail = await getTemplate(id);
      if (this.selectedId !== id) return;
      this.detail = detail;
      this.draft = inputFromDetail(detail);
      this.mode = "view";
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      if (this.selectedId === id) this.detailLoading = false;
    }
  }

  async saveDraft(): Promise<void> {
    if (!this.draft.name.trim()) {
      this.error = "模板名称不能为空。";
      return;
    }
    this.saving = true;
    this.error = "";
    try {
      const detail = this.mode === "create" || !this.selectedId
        ? await createTemplate(this.draft)
        : await updateTemplate(this.selectedId, this.draft);
      this.selectedId = detail.id;
      this.detail = detail;
      this.draft = inputFromDetail(detail);
      this.mode = "view";
      this.notice = `已保存 ${detail.name}`;
      this.versions = [];
      await Promise.all([this.refreshTemplates(), this.refreshFileTemplates()]);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.saving = false;
    }
  }

  async deleteSelected(): Promise<void> {
    const detail = this.detail;
    if (!detail || !window.confirm(`确定删除模板“${detail.name}”吗？`)) return;
    try {
      await deleteTemplate(detail.id);
      this.selectedId = undefined;
      this.detail = undefined;
      this.mode = "empty";
      this.versions = [];
      await Promise.all([this.refreshTemplates(), this.refreshFileTemplates()]);
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async toggleFavorite(template: TemplateMetadata): Promise<void> {
    try {
      await setTemplateFavorite(template.id, !template.favorite);
      if (this.detail?.id === template.id) {
        this.detail = { ...this.detail, favorite: !template.favorite };
        this.draft.favorite = !template.favorite;
      }
      await Promise.all([this.refreshTemplates(), this.refreshFileTemplates()]);
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async moveTemplate(id: number, categoryId: number | undefined, targetIndex: number): Promise<void> {
    if (this.sort !== "manual") {
      this.notice = "请先切换到手动排序，再拖动模板。";
      return;
    }
    try {
      await moveTemplate(id, categoryId, targetIndex);
      await Promise.all([this.refreshTemplates(), this.refreshFileTemplates()]);
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async insertTemplate(template: TemplateMetadata): Promise<void> {
    try {
      const detail = this.detail?.id === template.id ? this.detail : await getTemplate(template.id);
      this.editor.insertSnippet(detail.code);
      await recordTemplateUse(template.id);
      this.notice = `已插入 ${template.name}`;
      await this.refreshTemplates();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async loadTemplateCode(id: number): Promise<TemplateDetail | undefined> {
    try {
      return await getTemplate(id);
    } catch (error) {
      this.error = errorMessage(error);
      return undefined;
    }
  }

  async materializeFileTemplate(id: number): Promise<string | undefined> {
    const detail = await this.loadTemplateCode(id);
    if (!detail) return undefined;
    try {
      await recordTemplateUse(id);
      void this.refreshFileTemplates();
    } catch (error) {
      this.error = errorMessage(error);
    }
    return detail.code;
  }

  async searchQuickly(search: string): Promise<void> {
    const request = ++this.quickRequest;
    try {
      const results = await listTemplates({
        ...defaultFilter("snippet"),
        search,
        sort: "recentlyUsed",
      });
      if (request === this.quickRequest) this.quickResults = results.slice(0, 50);
    } catch (error) {
      if (request === this.quickRequest) this.error = errorMessage(error);
    }
  }

  async loadHistory(): Promise<void> {
    if (!this.selectedId) return;
    this.historyLoading = true;
    try {
      this.versions = await listTemplateVersions(this.selectedId);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.historyLoading = false;
    }
  }

  async previewVersion(versionId: number): Promise<void> {
    try {
      this.versionPreview = await getTemplateVersion(versionId);
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async restoreVersion(versionId: number): Promise<void> {
    if (!this.selectedId || !window.confirm("确定将此版本恢复为当前模板吗？")) return;
    try {
      const detail = await restoreTemplateVersion(this.selectedId, versionId);
      this.detail = detail;
      this.draft = inputFromDetail(detail);
      this.versionPreview = undefined;
      this.notice = `已恢复 ${detail.name}`;
      await Promise.all([this.loadHistory(), this.refreshTemplates(), this.refreshFileTemplates()]);
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  private currentFilter(): TemplateFilter {
    return {
      kind: this.kind,
      search: this.search,
      favoriteOnly: this.collection === "favorites",
      recentOnly: this.collection === "recent",
      categoryId: this.selectedCategoryId,
      sort: this.sort,
    };
  }

  private async refreshCategories(): Promise<void> {
    this.categories = await listTemplateCategories();
    this.categoryRevision += 1;
  }

  private buildCategoryRows(): TemplateCategoryRow[] {
    return buildTemplateCategoryRows(this.categories, this.expandedCategories);
  }
}

function defaultFilter(kind: TemplateKind): TemplateFilter {
  return {
    kind,
    search: "",
    favoriteOnly: false,
    recentOnly: false,
    categoryId: undefined,
    sort: "manual",
  };
}

function inputFromDetail(detail: TemplateDetail): TemplateInput {
  return {
    kind: detail.kind,
    name: detail.name,
    trigger: detail.trigger,
    aliases: [...detail.aliases],
    description: detail.description,
    language: detail.language,
    categoryId: detail.categoryId,
    favorite: detail.favorite,
    code: detail.code,
  };
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { technicalMessage?: unknown; userMessage?: unknown };
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
