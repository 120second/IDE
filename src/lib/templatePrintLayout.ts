import type { TemplateDetail } from "./types/templates";

export type TemplatePrintLayout = "auto" | "single" | "compact";

export interface TemplatePrintOptions {
  showDescription: boolean;
  showMetadata: boolean;
  showLineNumbers: boolean;
}

export interface PrintLayoutConfig {
  pageWidthMm: number;
  pageHeightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  columnGapMm: number;
  codeFontSizePt: number;
  codeLineHeight: number;
  sectionGapMm: number;
  chapterGapMm: number;
  pageColumnUnits: number;
  chapterHeadingUnits: number;
  sectionHeadingUnits: number;
  initialHeaderUnits: number;
  continuationHeaderUnits: number;
  descriptionLineUnits: number;
  codePaddingUnits: number;
  blockGapUnits: number;
  keepTogetherRatio: number;
  chapterBreakRemainingRatio: number;
  minSplitCodeUnits: number;
  minSplitLines: number;
  columnLineCapacity: number;
  columnLineCapacityWithNumbers: number;
  fullLineCapacity: number;
  fullLineCapacityWithNumbers: number;
  autoFullWidthThreshold: number;
  compactFullWidthThreshold: number;
  tocFirstColumnUnits: number;
  tocLaterColumnUnits: number;
  tocEntryUnits: number;
  tocChapterHeadingUnits: number;
  tocSectionHeadingUnits: number;
  epsilon: number;
}

export const PRINT_LAYOUT_CONFIG: Readonly<PrintLayoutConfig> = Object.freeze({
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginTopMm: 9.5,
  marginBottomMm: 9.5,
  marginLeftMm: 11,
  marginRightMm: 11,
  columnGapMm: 5.5,
  codeFontSizePt: 7.6,
  codeLineHeight: 1.22,
  sectionGapMm: 3.2,
  chapterGapMm: 4.2,
  pageColumnUnits: 81,
  chapterHeadingUnits: 3.2,
  sectionHeadingUnits: 2.4,
  initialHeaderUnits: 1.8,
  continuationHeaderUnits: 1.2,
  descriptionLineUnits: 0.9,
  codePaddingUnits: 1.5,
  blockGapUnits: 1.05,
  keepTogetherRatio: 0.78,
  chapterBreakRemainingRatio: 0.28,
  minSplitCodeUnits: 8,
  minSplitLines: 8,
  columnLineCapacity: 52,
  columnLineCapacityWithNumbers: 46,
  fullLineCapacity: 108,
  fullLineCapacityWithNumbers: 98,
  autoFullWidthThreshold: 78,
  compactFullWidthThreshold: 88,
  tocFirstColumnUnits: 54,
  tocLaterColumnUnits: 62,
  tocEntryUnits: 2,
  tocChapterHeadingUnits: 3,
  tocSectionHeadingUnits: 2,
  epsilon: 0.05,
});

export interface PrintableTemplate {
  detail: TemplateDetail;
  sourceLines: string[];
  highlightedLines: string[];
  visualLineLengths: number[];
  lineCount: number;
  maxLineLength: number;
}

export interface TemplateLayoutGroup {
  key: string;
  chapterId: string;
  chapterLabel: string;
  sectionId: string;
  sectionLabel: string;
  pathLabel: string;
  templates: PrintableTemplate[];
}

interface LayoutBlockBase {
  blockId: string;
  estimatedHeight: number;
  measuredHeight?: number;
  maxContentWidth: number;
  keepTogether: boolean;
  keepWithNext: boolean;
  splittable: boolean;
  chapterId: string;
  sectionId: string;
}

export interface ChapterLayoutBlock extends LayoutBlockBase {
  kind: "chapter";
  label: string;
  fullWidth: boolean;
  minimumNextUnits: number;
}

export interface SectionLayoutBlock extends LayoutBlockBase {
  kind: "section";
  label: string;
  fullWidth: boolean;
  minimumNextUnits: number;
}

export interface CodeLayoutBlock extends LayoutBlockBase {
  kind: "code";
  template: PrintableTemplate;
  fullWidth: boolean;
}

export type LayoutBlock = ChapterLayoutBlock | SectionLayoutBlock | CodeLayoutBlock;

export interface TemplatePrintSlice {
  template: PrintableTemplate;
  lines: string[];
  startLine: number;
  continuation: boolean;
  compact: boolean;
  fullWidth: boolean;
  estimatedUnits: number;
}

export type HandbookPlacedBlock =
  | { kind: "chapter"; blockId: string; label: string; estimatedUnits: number }
  | { kind: "section"; blockId: string; label: string; estimatedUnits: number }
  | { kind: "code"; blockId: string; slice: TemplatePrintSlice; estimatedUnits: number };

export interface HandbookColumn {
  blocks: HandbookPlacedBlock[];
  usedUnits: number;
  capacityUnits: number;
}

export type HandbookContentBand =
  | { kind: "columns"; columns: [HandbookColumn, HandbookColumn] }
  | { kind: "full"; block: HandbookPlacedBlock; usedUnits: number };

export interface HandbookPageMetrics {
  usedUnits: number;
  availableUnits: number;
  utilization: number;
  columnUtilization: [number, number];
  breakReasons: string[];
}

export interface LayoutContentPage {
  runningTitle: string;
  bands: HandbookContentBand[];
  metrics: HandbookPageMetrics;
}

export interface PrintLayoutResult {
  pages: LayoutContentPage[];
  firstPageByTemplate: Map<number, number>;
  firstPageByChapter: Map<string, number>;
  firstPageBySection: Map<string, number>;
  columnTemplateCount: number;
}

interface PageDraft {
  runningTitle: string;
  bands: HandbookContentBand[];
  breakReasons: string[];
}

interface ColumnCursor {
  band: Extract<HandbookContentBand, { kind: "columns" }>;
  columnIndex: 0 | 1;
}

export function createLayoutBlocks(
  groups: readonly TemplateLayoutGroup[],
  layout: TemplatePrintLayout,
  options: TemplatePrintOptions,
  config: Readonly<PrintLayoutConfig> = PRINT_LAYOUT_CONFIG,
): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  let previousChapterId = "";
  for (const group of groups) {
    const codeBlocks = group.templates.map((template): CodeLayoutBlock => {
      const fullWidth = isFullWidthTemplate(template, layout, config);
      const estimatedHeight = templateCardUnits(template, fullWidth, options, false, config);
      const columnCapacity = config.pageColumnUnits;
      return {
        kind: "code",
        blockId: `template:${template.detail.id}`,
        estimatedHeight,
        maxContentWidth: template.maxLineLength,
        keepTogether: estimatedHeight <= columnCapacity * config.keepTogetherRatio,
        keepWithNext: false,
        splittable: estimatedHeight > columnCapacity * config.keepTogetherRatio,
        chapterId: group.chapterId,
        sectionId: group.sectionId,
        template,
        fullWidth,
      };
    });
    const firstCode = codeBlocks[0];
    const firstMinimumUnits = firstCode
      ? minimumCodePlacementUnits(firstCode, options, config)
      : config.minSplitCodeUnits;
    const headingsFullWidth = firstCode?.fullWidth ?? false;
    if (group.chapterId !== previousChapterId) {
      blocks.push({
        kind: "chapter",
        blockId: `chapter:${group.chapterId}`,
        label: group.chapterLabel,
        estimatedHeight: config.chapterHeadingUnits,
        maxContentWidth: 0,
        keepTogether: true,
        keepWithNext: true,
        splittable: false,
        chapterId: group.chapterId,
        sectionId: group.sectionId,
        fullWidth: headingsFullWidth,
        minimumNextUnits: config.sectionHeadingUnits + firstMinimumUnits,
      });
      previousChapterId = group.chapterId;
    }
    blocks.push({
      kind: "section",
      blockId: `section:${group.sectionId}`,
      label: group.sectionLabel,
      estimatedHeight: config.sectionHeadingUnits,
      maxContentWidth: 0,
      keepTogether: true,
      keepWithNext: true,
      splittable: false,
      chapterId: group.chapterId,
      sectionId: group.sectionId,
      fullWidth: headingsFullWidth,
      minimumNextUnits: firstMinimumUnits,
    });
    blocks.push(...codeBlocks);
  }
  return blocks;
}

export function paginateLayoutBlocks(
  blocks: readonly LayoutBlock[],
  options: TemplatePrintOptions,
  config: Readonly<PrintLayoutConfig> = PRINT_LAYOUT_CONFIG,
): PrintLayoutResult {
  const pages: PageDraft[] = [];
  const firstPageByTemplate = new Map<number, number>();
  const firstPageByChapter = new Map<string, number>();
  const firstPageBySection = new Map<string, number>();
  let currentPage: PageDraft | undefined;
  let columnCursor: ColumnCursor | undefined;
  let runningChapter = "";
  let runningSection = "";
  let columnTemplateCount = 0;

  const runningTitle = (): string => [runningChapter, runningSection].filter(Boolean).join(" / ");

  const newPage = (reason?: string): PageDraft => {
    if (reason && currentPage) currentPage.breakReasons.push(reason);
    const page: PageDraft = { runningTitle: runningTitle(), bands: [], breakReasons: [] };
    pages.push(page);
    currentPage = page;
    columnCursor = undefined;
    return page;
  };

  const pageUsedUnits = (page: PageDraft): number => page.bands.reduce((sum, band) => {
    return sum + (band.kind === "full"
      ? band.usedUnits
      : Math.max(band.columns[0].usedUnits, band.columns[1].usedUnits));
  }, 0);

  const pageHasContent = (page: PageDraft | undefined): boolean => Boolean(page?.bands.some((band) => (
    band.kind === "full"
      ? true
      : band.columns.some((column) => column.blocks.length > 0)
  )));

  const ensurePage = (): PageDraft => currentPage ?? newPage();

  const ensureColumnCursor = (): ColumnCursor => {
    const page = ensurePage();
    if (columnCursor) return columnCursor;
    const capacityUnits = Math.max(0, config.pageColumnUnits - pageUsedUnits(page));
    const band: Extract<HandbookContentBand, { kind: "columns" }> = {
      kind: "columns",
      columns: [
        { blocks: [], usedUnits: 0, capacityUnits },
        { blocks: [], usedUnits: 0, capacityUnits },
      ],
    };
    page.bands.push(band);
    columnCursor = { band, columnIndex: 0 };
    return columnCursor;
  };

  const currentColumn = (): HandbookColumn => {
    const cursor = ensureColumnCursor();
    return cursor.band.columns[cursor.columnIndex];
  };

  const columnRemainingUnits = (): number => {
    const column = currentColumn();
    return column.capacityUnits - column.usedUnits;
  };

  const nextColumn = (reason: string): void => {
    const cursor = ensureColumnCursor();
    ensurePage().breakReasons.push(reason);
    if (cursor.columnIndex === 0) {
      cursor.columnIndex = 1;
      return;
    }
    newPage(reason);
  };

  const advanceUntilColumnFits = (requiredUnits: number, reason: string): void => {
    // A column band created below a full-width block can have very little height.
    // Moving through both columns is intentional: it preserves left-to-right order
    // and starts the block on the next page without placing an overflowing fragment.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const column = currentColumn();
      const pageAlreadyUsed = pageUsedUnits(ensurePage()) > config.epsilon;
      if (columnRemainingUnits() + config.epsilon >= requiredUnits) return;
      if (column.blocks.length === 0 && !pageAlreadyUsed) return;
      nextColumn(reason);
    }
  };

  const addColumnBlock = (block: HandbookPlacedBlock): void => {
    const column = currentColumn();
    column.blocks.push(block);
    column.usedUnits = roundUnits(column.usedUnits + block.estimatedUnits);
  };

  const addFullBlock = (block: HandbookPlacedBlock): void => {
    const page = ensurePage();
    columnCursor = undefined;
    page.bands.push({ kind: "full", block, usedUnits: block.estimatedUnits });
  };

  const fullRemainingUnits = (): number => config.pageColumnUnits - pageUsedUnits(ensurePage());

  const markBlockPage = (block: LayoutBlock): void => {
    const pageNumber = pages.length;
    if (block.kind === "chapter" && !firstPageByChapter.has(block.chapterId)) {
      firstPageByChapter.set(block.chapterId, pageNumber);
    }
    if (block.kind === "section" && !firstPageBySection.has(block.sectionId)) {
      firstPageBySection.set(block.sectionId, pageNumber);
    }
  };

  const placeHeading = (block: ChapterLayoutBlock | SectionLayoutBlock): void => {
    if (block.kind === "chapter") {
      runningChapter = block.label;
      runningSection = "";
    } else {
      runningSection = block.label;
    }
    const requiredUnits = block.estimatedHeight + block.minimumNextUnits;
    if (block.fullWidth) {
      const page = ensurePage();
      if (pageHasContent(page) && fullRemainingUnits() + config.epsilon < requiredUnits) {
        newPage(`${block.kind}-keep-with-next`);
      }
      const placed: HandbookPlacedBlock = {
        kind: block.kind,
        blockId: block.blockId,
        label: block.label,
        estimatedUnits: block.estimatedHeight,
      };
      addFullBlock(placed);
      markBlockPage(block);
      ensurePage().runningTitle = runningTitle();
      return;
    }

    const column = currentColumn();
    const remaining = columnRemainingUnits();
    if (
      block.kind === "chapter"
      && column.blocks.length > 0
      && remaining / Math.max(1, column.capacityUnits) < config.chapterBreakRemainingRatio
    ) {
      nextColumn("chapter-threshold");
    }
    advanceUntilColumnFits(requiredUnits, `${block.kind}-keep-with-next`);
    addColumnBlock({
      kind: block.kind,
      blockId: block.blockId,
      label: block.label,
      estimatedUnits: block.estimatedHeight,
    });
    markBlockPage(block);
    ensurePage().runningTitle = runningTitle();
  };

  const markTemplatePage = (templateId: number): void => {
    if (!firstPageByTemplate.has(templateId)) firstPageByTemplate.set(templateId, pages.length);
  };

  const placeColumnCode = (block: CodeLayoutBlock): void => {
    columnTemplateCount += 1;
    let lineIndex = 0;
    while (lineIndex < block.template.lineCount) {
      const continuation = lineIndex > 0;
      const remaining = columnRemainingUnits();
      const wholeUnits = templateSliceUnits(
        block.template,
        lineIndex,
        block.template.lineCount,
        false,
        options,
        continuation,
        config,
      );
      if (lineIndex === 0 && block.keepTogether && wholeUnits > remaining + config.epsilon) {
        nextColumn("keep-together");
        continue;
      }
      const fixedUnits = templateFixedUnits(block.template, options, continuation, config);
      const availableCodeUnits = columnRemainingUnits() - fixedUnits;
      if (
        availableCodeUnits < config.minSplitCodeUnits
        && (currentColumn().blocks.length > 0 || pageHasContent(currentPage))
      ) {
        nextColumn("minimum-split-space");
        continue;
      }
      let lineEnd = takeLinesForUnits(
        block.template.visualLineLengths,
        lineIndex,
        Math.max(1, availableCodeUnits),
        false,
        options.showLineNumbers,
        config,
      );
      if (lineEnd < block.template.lineCount) {
        lineEnd = chooseLogicalSplit(block.template.sourceLines, lineIndex, lineEnd, config);
      }
      const estimatedUnits = templateSliceUnits(
        block.template,
        lineIndex,
        lineEnd,
        false,
        options,
        continuation,
        config,
      );
      const slice: TemplatePrintSlice = {
        template: block.template,
        lines: block.template.highlightedLines.slice(lineIndex, lineEnd),
        startLine: lineIndex,
        continuation,
        compact: true,
        fullWidth: false,
        estimatedUnits,
      };
      addColumnBlock({ kind: "code", blockId: block.blockId, slice, estimatedUnits });
      markTemplatePage(block.template.detail.id);
      lineIndex = lineEnd;
      if (lineIndex < block.template.lineCount) nextColumn("long-code-continuation");
    }
  };

  const placeFullCode = (block: CodeLayoutBlock): void => {
    let lineIndex = 0;
    while (lineIndex < block.template.lineCount) {
      const continuation = lineIndex > 0;
      const remaining = fullRemainingUnits();
      const wholeUnits = templateSliceUnits(
        block.template,
        lineIndex,
        block.template.lineCount,
        true,
        options,
        continuation,
        config,
      );
      if (block.keepTogether && wholeUnits > remaining + config.epsilon && pageHasContent(currentPage)) {
        newPage("full-width-keep-together");
        continue;
      }
      const fixedUnits = templateFixedUnits(block.template, options, continuation, config);
      const availableCodeUnits = fullRemainingUnits() - fixedUnits;
      if (availableCodeUnits < config.minSplitCodeUnits && pageHasContent(currentPage)) {
        newPage("full-width-minimum-space");
        continue;
      }
      let lineEnd = takeLinesForUnits(
        block.template.visualLineLengths,
        lineIndex,
        Math.max(1, availableCodeUnits),
        true,
        options.showLineNumbers,
        config,
      );
      if (lineEnd < block.template.lineCount) {
        lineEnd = chooseLogicalSplit(block.template.sourceLines, lineIndex, lineEnd, config);
      }
      const estimatedUnits = templateSliceUnits(
        block.template,
        lineIndex,
        lineEnd,
        true,
        options,
        continuation,
        config,
      );
      const slice: TemplatePrintSlice = {
        template: block.template,
        lines: block.template.highlightedLines.slice(lineIndex, lineEnd),
        startLine: lineIndex,
        continuation,
        compact: false,
        fullWidth: true,
        estimatedUnits,
      };
      addFullBlock({ kind: "code", blockId: block.blockId, slice, estimatedUnits });
      markTemplatePage(block.template.detail.id);
      lineIndex = lineEnd;
      if (lineIndex < block.template.lineCount) newPage("full-width-continuation");
    }
  };

  for (const block of blocks) {
    if (block.kind === "chapter" || block.kind === "section") {
      placeHeading(block);
    } else if (block.fullWidth) {
      placeFullCode(block);
    } else {
      placeColumnCode(block);
    }
  }

  const finalizedPages = pages
    .map((page): LayoutContentPage => {
      const bands = page.bands.filter((band) => band.kind === "full"
        || band.columns.some((column) => column.blocks.length > 0));
      const fullUnits = bands.reduce((sum, band) => sum + (band.kind === "full" ? band.usedUnits : 0), 0);
      const columnUnits: [number, number] = [0, 0];
      bands.forEach((band) => {
        if (band.kind !== "columns") return;
        columnUnits[0] += band.columns[0].usedUnits;
        columnUnits[1] += band.columns[1].usedUnits;
      });
      const usedUnits = roundUnits(fullUnits + Math.max(columnUnits[0], columnUnits[1]));
      return {
        runningTitle: page.runningTitle,
        bands,
        metrics: {
          usedUnits,
          availableUnits: config.pageColumnUnits,
          utilization: roundRatio(usedUnits / config.pageColumnUnits),
          columnUtilization: [
            roundRatio((fullUnits + columnUnits[0]) / config.pageColumnUnits),
            roundRatio((fullUnits + columnUnits[1]) / config.pageColumnUnits),
          ],
          breakReasons: [...new Set(page.breakReasons)],
        },
      };
    })
    .filter((page) => page.bands.length > 0);

  return {
    pages: finalizedPages,
    firstPageByTemplate,
    firstPageByChapter,
    firstPageBySection,
    columnTemplateCount,
  };
}

export function printLayoutCssVariables(
  config: Readonly<PrintLayoutConfig> = PRINT_LAYOUT_CONFIG,
): string {
  const spreadWidthMm = config.pageWidthMm * 2;
  return [
    `--print-page-width: ${config.pageWidthMm}mm`,
    `--print-page-height: ${config.pageHeightMm}mm`,
    `--print-spread-width: ${spreadWidthMm}mm`,
    `--print-margin-top: ${config.marginTopMm}mm`,
    `--print-margin-bottom: ${config.marginBottomMm}mm`,
    `--print-margin-left: ${config.marginLeftMm}mm`,
    `--print-margin-right: ${config.marginRightMm}mm`,
    `--print-column-gap: ${config.columnGapMm}mm`,
    `--print-code-font-size: ${config.codeFontSizePt}pt`,
    `--print-code-line-height: ${config.codeLineHeight}`,
    `--print-section-gap: ${config.sectionGapMm}mm`,
    `--print-chapter-gap: ${config.chapterGapMm}mm`,
  ].join("; ");
}

function isFullWidthTemplate(
  template: PrintableTemplate,
  layout: TemplatePrintLayout,
  config: Readonly<PrintLayoutConfig>,
): boolean {
  if (layout === "single") return true;
  const threshold = layout === "compact"
    ? config.compactFullWidthThreshold
    : config.autoFullWidthThreshold;
  return template.maxLineLength > threshold;
}

function minimumCodePlacementUnits(
  block: CodeLayoutBlock,
  options: TemplatePrintOptions,
  config: Readonly<PrintLayoutConfig>,
): number {
  if (block.keepTogether) return block.estimatedHeight;
  return templateFixedUnits(block.template, options, false, config) + config.minSplitCodeUnits;
}

function templateCardUnits(
  template: PrintableTemplate,
  fullWidth: boolean,
  options: TemplatePrintOptions,
  continuation: boolean,
  config: Readonly<PrintLayoutConfig>,
): number {
  return templateSliceUnits(
    template,
    0,
    template.lineCount,
    fullWidth,
    options,
    continuation,
    config,
  );
}

function templateSliceUnits(
  template: PrintableTemplate,
  startLine: number,
  endLine: number,
  fullWidth: boolean,
  options: TemplatePrintOptions,
  continuation: boolean,
  config: Readonly<PrintLayoutConfig>,
): number {
  return roundUnits(
    templateFixedUnits(template, options, continuation, config)
      + codeLineUnits(
        template.visualLineLengths.slice(startLine, endLine),
        fullWidth,
        options.showLineNumbers,
        config,
      ),
  );
}

function templateFixedUnits(
  template: PrintableTemplate,
  options: TemplatePrintOptions,
  continuation: boolean,
  config: Readonly<PrintLayoutConfig>,
): number {
  if (continuation) {
    return config.continuationHeaderUnits + config.codePaddingUnits + config.blockGapUnits;
  }
  let units = config.initialHeaderUnits + config.codePaddingUnits + config.blockGapUnits;
  if (options.showDescription && template.detail.description) {
    units += Math.min(1.8, Math.max(
      config.descriptionLineUnits,
      Math.ceil(template.detail.description.length / 74) * config.descriptionLineUnits,
    ));
  }
  return units;
}

function codeLineUnits(
  lengths: readonly number[],
  fullWidth: boolean,
  showLineNumbers: boolean,
  config: Readonly<PrintLayoutConfig>,
): number {
  const capacity = fullWidth
    ? (showLineNumbers ? config.fullLineCapacityWithNumbers : config.fullLineCapacity)
    : (showLineNumbers ? config.columnLineCapacityWithNumbers : config.columnLineCapacity);
  return lengths.reduce(
    (units, length) => units + Math.max(1, Math.ceil(length / capacity)),
    0,
  );
}

function takeLinesForUnits(
  lengths: readonly number[],
  start: number,
  availableUnits: number,
  fullWidth: boolean,
  showLineNumbers: boolean,
  config: Readonly<PrintLayoutConfig>,
): number {
  let end = start;
  let used = 0;
  while (end < lengths.length) {
    const lineUnits = codeLineUnits([lengths[end]], fullWidth, showLineNumbers, config);
    if (end > start && used + lineUnits > availableUnits + config.epsilon) break;
    used += lineUnits;
    end += 1;
    if (used >= availableUnits - config.epsilon) break;
  }
  return Math.max(start + 1, end);
}

function chooseLogicalSplit(
  lines: readonly string[],
  start: number,
  hardEnd: number,
  config: Readonly<PrintLayoutConfig>,
): number {
  if (hardEnd >= lines.length) return lines.length;
  const span = hardEnd - start;
  if (span <= config.minSplitLines) return hardEnd;
  const minimum = Math.max(start + config.minSplitLines, start + Math.floor(span * 0.68));
  const candidates: Array<{ end: number; priority: number; distance: number }> = [];
  for (let end = hardEnd; end >= minimum; end -= 1) {
    const previous = lines[end - 1]?.trim() ?? "";
    const next = lines[end]?.trim() ?? "";
    let priority = 0;
    if (isFunctionStart(next)) priority = 4;
    else if (!previous || !next) priority = 3;
    else if (/^}\s*;?$/.test(previous) || previous.endsWith("};")) priority = 2;
    else if (previous.endsWith("}")) priority = 1;
    if (priority > 0) candidates.push({ end, priority, distance: hardEnd - end });
  }
  candidates.sort((left, right) => right.priority - left.priority || left.distance - right.distance);
  return candidates[0]?.end ?? hardEnd;
}

function isFunctionStart(line: string): boolean {
  if (!line.includes("(") || !line.endsWith("{")) return false;
  return !/^(if|for|while|switch|catch)\b/.test(line);
}

function roundUnits(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}
