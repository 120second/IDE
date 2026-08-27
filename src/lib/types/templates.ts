export type TemplateKind = "snippet" | "file";

export type TemplateSort =
  | "manual"
  | "name"
  | "recentlyUsed"
  | "usageCount"
  | "updated"
  | "created";

export type TemplateCollection = "all" | "favorites" | "recent";

export interface TemplateFilter {
  kind: TemplateKind;
  search: string;
  favoriteOnly: boolean;
  recentOnly: boolean;
  categoryId?: number;
  sort: TemplateSort;
}

export interface TemplateCategory {
  id: number;
  name: string;
  parentId?: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateMetadata {
  id: number;
  kind: TemplateKind;
  name: string;
  trigger: string;
  aliases: string[];
  description: string;
  language: string;
  categoryId?: number;
  favorite: boolean;
  sortOrder: number;
  useCount: number;
  lastUsed?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateMetadata {
  code: string;
}

export interface TemplateInput {
  kind: TemplateKind;
  name: string;
  trigger: string;
  aliases: string[];
  description: string;
  language: string;
  categoryId?: number;
  favorite: boolean;
  code: string;
}

export interface TemplateVersionMetadata {
  id: number;
  templateId: number;
  versionNumber: number;
  name: string;
  createdAt: string;
}

export interface TemplateVersionDetail {
  id: number;
  templateId: number;
  versionNumber: number;
  kind: TemplateKind;
  name: string;
  trigger: string;
  aliases: string[];
  description: string;
  language: string;
  categoryId?: number;
  favorite: boolean;
  code: string;
  createdAt: string;
}

export interface TemplateCategoryRow {
  category: TemplateCategory;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
}

export interface TemplateTreeCategoryRow extends TemplateCategoryRow {
  kind: "category";
}

export interface TemplateTreeFileRow {
  kind: "template";
  template: TemplateMetadata;
  depth: number;
}

export type TemplateTreeRow = TemplateTreeCategoryRow | TemplateTreeFileRow;
