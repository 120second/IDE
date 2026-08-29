import { cpp } from "@codemirror/lang-cpp";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import {
  createLayoutBlocks,
  paginateLayoutBlocks,
  PRINT_LAYOUT_CONFIG,
  type HandbookContentBand,
  type HandbookPageMetrics,
  type PrintLayoutConfig,
  type PrintableTemplate,
  type TemplateLayoutGroup,
  type TemplatePrintLayout,
  type TemplatePrintOptions,
} from "./templatePrintLayout";
import type { TemplateCategory, TemplateDetail } from "./types/templates";

export {
  createLayoutBlocks,
  paginateLayoutBlocks,
  PRINT_LAYOUT_CONFIG,
  printLayoutCssVariables,
} from "./templatePrintLayout";
export type {
  CodeLayoutBlock,
  HandbookColumn,
  HandbookContentBand,
  HandbookPageMetrics,
  HandbookPlacedBlock,
  LayoutBlock,
  PrintLayoutConfig,
  PrintableTemplate,
  SectionLayoutBlock,
  TemplatePrintLayout,
  TemplatePrintOptions,
  TemplatePrintSlice,
} from "./templatePrintLayout";

export interface HandbookTocEntry {
  templateId: number;
  name: string;
  section: string;
  chapterId: string;
  sectionId: string;
  majorSection: string;
  minorSection: string;
  pageNumber: number;
  chapterPageNumber: number;
  sectionPageNumber: number;
}

export interface HandbookTocItem {
  entry: HandbookTocEntry;
  showMajorHeading: boolean;
  showMinorHeading: boolean;
}

export interface HandbookTocPage {
  kind: "toc";
  number: number;
  columns: HandbookTocItem[][];
}

export interface HandbookContentPage {
  kind: "content";
  number: number;
  runningTitle: string;
  bands: HandbookContentBand[];
  metrics: HandbookPageMetrics;
}

export type TemplateHandbookPage = HandbookTocPage | HandbookContentPage;

export interface TemplateHandbook {
  pages: TemplateHandbookPage[];
  tocEntries: HandbookTocEntry[];
  compactCount: number;
  contentPageCount: number;
}

export function preparePrintableTemplate(
  detail: TemplateDetail,
  _layout: TemplatePrintLayout,
): PrintableTemplate {
  const sourceLines = normalizedLines(detail.code);
  const visualLineLengths = sourceLines.map(visualLineLength);
  const lineCount = sourceLines.length;
  const maxLineLength = visualLineLengths.reduce(
    (maximum, length) => Math.max(maximum, length),
    0,
  );

  return {
    detail,
    sourceLines,
    highlightedLines: highlightedCodeLines(detail.code, detail.language),
    visualLineLengths,
    lineCount,
    maxLineLength,
  };
}

export function buildTemplateHandbook(
  details: readonly TemplateDetail[],
  categories: readonly TemplateCategory[],
  layout: TemplatePrintLayout,
  options: TemplatePrintOptions,
  config: Readonly<PrintLayoutConfig> = PRINT_LAYOUT_CONFIG,
): TemplateHandbook {
  const groups = groupTemplates(details, categories, layout);
  const blocks = createLayoutBlocks(groups, layout, options, config);
  const contentLayout = paginateLayoutBlocks(blocks, options, config);
  const provisionalTocEntries: HandbookTocEntry[] = groups.flatMap((group) => (
    group.templates.map((template) => ({
      templateId: template.detail.id,
      name: template.detail.name,
      section: group.pathLabel,
      chapterId: group.chapterId,
      sectionId: group.sectionId,
      majorSection: group.chapterLabel,
      minorSection: group.sectionLabel,
      pageNumber: 0,
      chapterPageNumber: 0,
      sectionPageNumber: 0,
    }))
  ));
  const tocPageCount = paginateTocEntries(provisionalTocEntries, config).length;
  const tocEntries = provisionalTocEntries.map((entry) => ({
    ...entry,
    pageNumber: tocPageCount + (contentLayout.firstPageByTemplate.get(entry.templateId) ?? 1),
    chapterPageNumber: tocPageCount + (contentLayout.firstPageByChapter.get(entry.chapterId) ?? 1),
    sectionPageNumber: tocPageCount + (contentLayout.firstPageBySection.get(entry.sectionId) ?? 1),
  }));
  const tocColumns = paginateTocEntries(tocEntries, config);
  const tocPages: HandbookTocPage[] = tocColumns.map((columns, index) => ({
    kind: "toc",
    number: index + 1,
    columns,
  }));
  const contentPages: HandbookContentPage[] = contentLayout.pages.map((page, index) => ({
    kind: "content",
    number: tocPageCount + index + 1,
    runningTitle: page.runningTitle,
    bands: page.bands,
    metrics: page.metrics,
  }));

  return {
    pages: [...tocPages, ...contentPages],
    tocEntries,
    compactCount: contentLayout.columnTemplateCount,
    contentPageCount: contentPages.length,
  };
}

export function highlightedCodeLines(code: string, language: string): string[] {
  const lines = [""];
  const append = (text: string, classes: string): void => {
    const pieces = text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push("");
      if (!piece) return;
      const escaped = escapeHtml(piece);
      lines[lines.length - 1] += classes
        ? `<span class="${escapeAttribute(classes)}">${escaped}</span>`
        : escaped;
    });
  };

  if (language.trim().toLowerCase() !== "cpp" && language.trim().toLowerCase() !== "c++") {
    append(code, "");
    return lines;
  }

  const tree = cpp().language.parser.parse(code);
  highlightCode(code, tree, classHighlighter, append, () => lines.push(""));
  return lines;
}

function groupTemplates(
  details: readonly TemplateDetail[],
  categories: readonly TemplateCategory[],
  layout: TemplatePrintLayout,
): TemplateLayoutGroup[] {
  const grouped = new Map<string, TemplateLayoutGroup>();
  for (const detail of details) {
    const pathCategories = detail.categoryId === undefined
      ? []
      : categoryPathCategories(detail.categoryId, categories);
    const pathSegments = pathCategories.length > 0
      ? pathCategories.map((category) => category.name)
      : ["未分类"];
    const pathLabel = pathSegments.join(" / ");
    const chapterLabel = pathSegments[0];
    const sectionLabel = pathSegments.length > 1
      ? pathSegments.slice(1).join(" / ")
      : "本类模板";
    const chapterId = `chapter:${pathCategories[0]?.id ?? "root"}`;
    const sectionId = `section:${detail.categoryId ?? "root"}`;
    const group = grouped.get(sectionId) ?? {
      key: sectionId,
      chapterId,
      chapterLabel,
      sectionId,
      sectionLabel,
      pathLabel,
      templates: [],
    };
    group.templates.push(preparePrintableTemplate(detail, layout));
    grouped.set(sectionId, group);
  }
  const chapters = new Map<string, TemplateLayoutGroup[]>();
  for (const group of grouped.values()) {
    const chapterGroups = chapters.get(group.chapterId) ?? [];
    chapterGroups.push(group);
    chapters.set(group.chapterId, chapterGroups);
  }
  return [...chapters.values()].flat();
}

function paginateTocEntries(
  entries: readonly HandbookTocEntry[],
  config: Readonly<PrintLayoutConfig>,
): HandbookTocItem[][][] {
  if (entries.length === 0) return [[[], []]];
  const pages: HandbookTocItem[][][] = [];
  let entryIndex = 0;
  while (entryIndex < entries.length) {
    const pageIndex = pages.length;
    const columns: HandbookTocItem[][] = [];
    for (let columnIndex = 0; columnIndex < 2; columnIndex += 1) {
      const capacity = pageIndex === 0
        ? config.tocFirstColumnUnits
        : config.tocLaterColumnUnits;
      const items: HandbookTocItem[] = [];
      let usedUnits = 0;
      let previousMajor = "";
      let previousMinor = "";
      while (entryIndex < entries.length) {
        const entry = entries[entryIndex];
        const showMajorHeading = entry.majorSection !== previousMajor;
        const showMinorHeading = showMajorHeading || entry.minorSection !== previousMinor;
        const itemUnits = config.tocEntryUnits
          + (showMajorHeading ? config.tocChapterHeadingUnits : 0)
          + (showMinorHeading ? config.tocSectionHeadingUnits : 0);
        if (items.length > 0 && usedUnits + itemUnits > capacity) break;
        items.push({ entry, showMajorHeading, showMinorHeading });
        usedUnits += itemUnits;
        previousMajor = entry.majorSection;
        previousMinor = entry.minorSection;
        entryIndex += 1;
      }
      columns.push(items);
    }
    pages.push(columns);
  }
  return pages;
}

function categoryPathCategories(
  categoryId: number,
  categories: readonly TemplateCategory[],
): TemplateCategory[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path: TemplateCategory[] = [];
  const visited = new Set<number>();
  let current = byId.get(categoryId);
  while (current && !visited.has(current.id)) {
    path.unshift(current);
    visited.add(current.id);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return path;
}

function normalizedLines(code: string): string[] {
  return code.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function visualLineLength(line: string): number {
  let length = 0;
  for (const character of line) {
    if (character === "\t") {
      length += 4 - (length % 4);
    } else {
      length += character.codePointAt(0)! > 0xff ? 2 : 1;
    }
  }
  return length;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return value.replaceAll('"', "&quot;");
}
