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

export function listTemplateCategories(): Promise<TemplateCategory[]> {
  return isTauri()
    ? invoke<TemplateCategory[]>("list_template_categories").then((items) => items.map(normalizeCategory))
    : Promise.resolve([]);
}

export function createTemplateCategory(name: string, parentId?: number): Promise<TemplateCategory> {
  return invoke<TemplateCategory>("create_template_category", { name, parentId: parentId ?? null })
    .then(normalizeCategory);
}

export function renameTemplateCategory(id: number, name: string): Promise<void> {
  return invoke<void>("rename_template_category", { id, name });
}

export function deleteTemplateCategory(id: number): Promise<void> {
  return invoke<void>("delete_template_category", { id });
}

export function moveTemplateCategory(
  id: number,
  parentId: number | undefined,
  targetIndex: number,
): Promise<void> {
  return invoke<void>("move_template_category", { id, parentId: parentId ?? null, targetIndex });
}

export function listTemplates(filter: TemplateFilter): Promise<TemplateMetadata[]> {
  return isTauri()
    ? invoke<TemplateMetadata[]>("list_templates", { filter }).then((items) => items.map(normalizeMetadata))
    : Promise.resolve([]);
}

export function getTemplate(id: number): Promise<TemplateDetail> {
  return invoke<TemplateDetail>("get_template", { id }).then(normalizeDetail);
}

export function createTemplate(input: TemplateInput): Promise<TemplateDetail> {
  return invoke<TemplateDetail>("create_template", { input }).then(normalizeDetail);
}

export function updateTemplate(id: number, input: TemplateInput): Promise<TemplateDetail> {
  return invoke<TemplateDetail>("update_template", { id, input }).then(normalizeDetail);
}

export function deleteTemplate(id: number): Promise<void> {
  return invoke<void>("delete_template", { id });
}

export function setTemplateFavorite(id: number, favorite: boolean): Promise<void> {
  return invoke<void>("set_template_favorite", { id, favorite });
}

export function recordTemplateUse(id: number): Promise<void> {
  return invoke<void>("record_template_use", { id });
}

export function moveTemplate(
  id: number,
  categoryId: number | undefined,
  targetIndex: number,
): Promise<void> {
  return invoke<void>("move_template", { id, categoryId: categoryId ?? null, targetIndex });
}

export function listTemplateVersions(templateId: number): Promise<TemplateVersionMetadata[]> {
  return invoke<TemplateVersionMetadata[]>("list_template_versions", { templateId });
}

export function getTemplateVersion(versionId: number): Promise<TemplateVersionDetail> {
  return invoke<TemplateVersionDetail>("get_template_version", { versionId }).then(normalizeVersion);
}

export function restoreTemplateVersion(
  templateId: number,
  versionId: number,
): Promise<TemplateDetail> {
  return invoke<TemplateDetail>("restore_template_version", { templateId, versionId })
    .then(normalizeDetail);
}

function normalizeCategory(category: TemplateCategory): TemplateCategory {
  return { ...category, parentId: category.parentId ?? undefined };
}

function normalizeMetadata(template: TemplateMetadata): TemplateMetadata {
  return {
    ...template,
    categoryId: template.categoryId ?? undefined,
    lastUsed: template.lastUsed ?? undefined,
  };
}

function normalizeDetail(template: TemplateDetail): TemplateDetail {
  return { ...normalizeMetadata(template), code: template.code };
}

function normalizeVersion(version: TemplateVersionDetail): TemplateVersionDetail {
  return { ...version, categoryId: version.categoryId ?? undefined };
}
