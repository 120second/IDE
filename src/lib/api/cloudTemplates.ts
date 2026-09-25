import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  TemplateCategory,
  TemplateDetail,
  TemplateFilter,
  TemplateInput,
  TemplateMetadata,
  TemplateVersionDetail,
  TemplateVersionMetadata,
} from "../types/templates";

export interface TemplateTransferResult {
  categoriesCreated: number;
  categoriesReused: number;
  templatesCreated: number;
  templatesSkipped: number;
  historiesSkipped: boolean;
}

export function importLocalTemplatesToCloud(): Promise<TemplateTransferResult> {
  return invoke<TemplateTransferResult>("cloud_import_local_templates");
}

export function syncCloudTemplatesToLocal(): Promise<TemplateTransferResult> {
  return invoke<TemplateTransferResult>("cloud_sync_templates_to_local");
}

export function listTemplateCategories(): Promise<TemplateCategory[]> {
  return isTauri()
    ? invoke<TemplateCategory[]>("cloud_list_template_categories").then((items) => items.map(normalizeCategory))
    : Promise.resolve([]);
}

export function createTemplateCategory(name: string, parentId?: number): Promise<TemplateCategory> {
  return invoke<TemplateCategory>("cloud_create_template_category", { name, parentId: parentId ?? null })
    .then(normalizeCategory);
}

export function renameTemplateCategory(id: number, name: string): Promise<void> {
  return invoke<void>("cloud_rename_template_category", { id, name });
}

export function deleteTemplateCategory(id: number): Promise<void> {
  return invoke<void>("cloud_delete_template_category", { id });
}

export function moveTemplateCategory(id: number, parentId: number | undefined, targetIndex: number): Promise<void> {
  return invoke<void>("cloud_move_template_category", { id, parentId: parentId ?? null, targetIndex });
}

export function listTemplates(filter: TemplateFilter): Promise<TemplateMetadata[]> {
  return isTauri()
    ? invoke<TemplateMetadata[]>("cloud_list_templates", { filter }).then((items) => items.map(normalizeMetadata))
    : Promise.resolve([]);
}

export function searchTemplateCompletions(query: string, limit = 20): Promise<TemplateDetail[]> {
  return isTauri()
    ? invoke<TemplateDetail[]>("cloud_search_template_completions", { query, limit }).then((items) => items.map(normalizeDetail))
    : Promise.resolve([]);
}

export function getTemplate(id: number): Promise<TemplateDetail> {
  return invoke<TemplateDetail>("cloud_get_template", { id }).then(normalizeDetail);
}

export function getTemplates(ids: number[]): Promise<TemplateDetail[]> {
  return isTauri()
    ? invoke<TemplateDetail[]>("cloud_get_templates", { ids }).then((items) => items.map(normalizeDetail))
    : Promise.resolve([]);
}

export function createTemplate(input: TemplateInput): Promise<TemplateDetail> {
  return invoke<TemplateDetail>("cloud_create_template", { input }).then(normalizeDetail);
}

export function updateTemplate(id: number, input: TemplateInput): Promise<TemplateDetail> {
  return invoke<TemplateDetail>("cloud_update_template", { id, input }).then(normalizeDetail);
}

export function deleteTemplate(id: number): Promise<void> {
  return invoke<void>("cloud_delete_template", { id });
}

export function setTemplateFavorite(id: number, favorite: boolean): Promise<void> {
  return invoke<void>("cloud_set_template_favorite", { id, favorite });
}

export function recordTemplateUse(id: number): Promise<void> {
  return invoke<void>("cloud_record_template_use", { id });
}

export function moveTemplate(id: number, categoryId: number | undefined, targetIndex: number): Promise<void> {
  return invoke<void>("cloud_move_template", { id, categoryId: categoryId ?? null, targetIndex });
}

export function listTemplateVersions(_templateId: number): Promise<TemplateVersionMetadata[]> {
  return Promise.resolve([]);
}

export function getTemplateVersion(_versionId: number): Promise<TemplateVersionDetail> {
  return Promise.reject(new Error("云端模板暂不提供历史版本。"));
}

export function deleteTemplateVersion(_templateId: number, _versionId: number): Promise<void> {
  return Promise.reject(new Error("云端模板暂不提供历史版本。"));
}

export function restoreTemplateVersion(_templateId: number, _versionId: number): Promise<TemplateDetail> {
  return Promise.reject(new Error("云端模板暂不提供历史版本。"));
}

function normalizeCategory(category: TemplateCategory): TemplateCategory {
  return { ...category, parentId: category.parentId ?? undefined };
}

function normalizeMetadata(template: TemplateMetadata): TemplateMetadata {
  return { ...template, categoryId: template.categoryId ?? undefined, lastUsed: template.lastUsed ?? undefined };
}

function normalizeDetail(template: TemplateDetail): TemplateDetail {
  return { ...normalizeMetadata(template), code: template.code };
}
