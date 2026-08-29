import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TemplateCategory, TemplateDetail } from "./types/templates";
import {
  buildTemplateHandbook,
  highlightedCodeLines,
  preparePrintableTemplate,
  PRINT_LAYOUT_CONFIG,
  type HandbookContentPage,
  type HandbookPlacedBlock,
  type PrintLayoutConfig,
  type TemplateHandbook,
} from "./templatePrint";

function template(
  code: string,
  name = "模板",
  id = 1,
  categoryId?: number,
): TemplateDetail {
  return {
    id,
    kind: "snippet",
    name,
    trigger: "tpl",
    aliases: [],
    description: "",
    language: "cpp",
    categoryId,
    favorite: false,
    sortOrder: id,
    useCount: 0,
    createdAt: "2026-08-28T00:00:00Z",
    updatedAt: "2026-08-28T00:00:00Z",
    code,
  };
}

function codeLines(count: number, prefix = "value"): string {
  return Array.from({ length: count }, (_, index) => `int ${prefix}_${index};`).join("\n");
}

const options = {
  showDescription: true,
  showMetadata: true,
  showLineNumbers: false,
};

function contentPages(handbook: TemplateHandbook): HandbookContentPage[] {
  return handbook.pages.filter((page): page is HandbookContentPage => page.kind === "content");
}

function pageBlocks(page: HandbookContentPage): HandbookPlacedBlock[] {
  return page.bands.flatMap((band) => band.kind === "full"
    ? [band.block]
    : [...band.columns[0].blocks, ...band.columns[1].blocks]);
}

function allBlocks(handbook: TemplateHandbook): HandbookPlacedBlock[] {
  return contentPages(handbook).flatMap(pageBlocks);
}

function codeBlocks(handbook: TemplateHandbook): Extract<HandbookPlacedBlock, { kind: "code" }>[] {
  return allBlocks(handbook).filter(
    (block): block is Extract<HandbookPlacedBlock, { kind: "code" }> => block.kind === "code",
  );
}

function config(overrides: Partial<PrintLayoutConfig>): Readonly<PrintLayoutConfig> {
  return { ...PRINT_LAYOUT_CONFIG, ...overrides };
}

function categories(): TemplateCategory[] {
  return [
    { id: 1, name: "图论", sortOrder: 0, createdAt: "", updatedAt: "" },
    { id: 2, name: "最短路", parentId: 1, sortOrder: 0, createdAt: "", updatedAt: "" },
    { id: 3, name: "数据结构", sortOrder: 1, createdAt: "", updatedAt: "" },
    { id: 4, name: "线段树", parentId: 3, sortOrder: 0, createdAt: "", updatedAt: "" },
  ];
}

describe("template print layout engine", () => {
  it("Case 1: keeps ten short code blocks whole and in source order", () => {
    const templates = Array.from({ length: 10 }, (_, index) => (
      template(codeLines(5, `short${index}`), `Short ${index + 1}`, index + 1)
    ));
    const handbook = buildTemplateHandbook(templates, [], "auto", options);
    const blocks = codeBlocks(handbook);

    expect(blocks.map((block) => block.slice.template.detail.name)).toEqual(
      templates.map((item) => item.name),
    );
    expect(blocks).toHaveLength(10);
    expect(blocks.every((block) => block.slice.startLine === 0 && !block.slice.continuation)).toBe(true);
  });

  it("Case 2: splits a 120-line template without losing lines and prefers logical boundaries", () => {
    const source = Array.from({ length: 6 }, (_, functionIndex) => [
      `void function_${functionIndex}() {`,
      ...Array.from({ length: 17 }, (_, lineIndex) => `  int v_${functionIndex}_${lineIndex};`),
      "}",
      "",
    ]).flat().join("\n");
    const handbook = buildTemplateHandbook([template(source, "Long")], [], "auto", options);
    const slices = codeBlocks(handbook).map((block) => block.slice);

    expect(slices.length).toBeGreaterThan(1);
    expect(slices.reduce((sum, slice) => sum + slice.lines.length, 0)).toBe(120);
    expect(slices.slice(1).every((slice) => slice.continuation)).toBe(true);
    expect(slices.slice(1).every((slice) => {
      const line = slice.template.sourceLines[slice.startLine]?.trim() ?? "";
      return !line || line.startsWith("void function_");
    })).toBe(true);
  });

  it("Case 3: preserves order for mixed long and short templates", () => {
    const lengths = [8, 55, 12, 95, 18, 34, 6];
    const templates = lengths.map((length, index) => (
      template(codeLines(length, `mixed${index}`), `Mixed ${index + 1}`, index + 1)
    ));
    const handbook = buildTemplateHandbook(templates, [], "auto", options);
    const firstSlices = codeBlocks(handbook).filter((block) => !block.slice.continuation);

    expect(firstSlices.map((block) => block.slice.template.detail.id)).toEqual(
      templates.map((item) => item.id),
    );
  });

  it("aggregates sections by chapter while preserving order inside each chapter", () => {
    const templates = [
      template(codeLines(4), "Graph A", 1, 2),
      template(codeLines(4), "Tree A", 2, 4),
      template(codeLines(4), "Graph B", 3, 1),
    ];
    const handbook = buildTemplateHandbook(templates, categories(), "auto", options);
    const names = codeBlocks(handbook)
      .filter((block) => !block.slice.continuation)
      .map((block) => block.slice.template.detail.name);

    expect(names).toEqual(["Graph A", "Graph B", "Tree A"]);
  });

  it("Case 4: never leaves a section heading alone at the bottom of a column", () => {
    const handbook = buildTemplateHandbook(
      [
        template(codeLines(17, "first"), "First", 1, 2),
        template(codeLines(5, "second"), "Second", 2, 4),
      ],
      categories(),
      "auto",
      options,
      config({ pageColumnUnits: 30 }),
    );
    for (const page of contentPages(handbook)) {
      for (const band of page.bands) {
        if (band.kind !== "columns") continue;
        for (const column of band.columns) {
          column.blocks.forEach((block, index) => {
            if (block.kind === "section") expect(column.blocks[index + 1]?.kind).toBe("code");
          });
        }
      }
    }
  });

  it("Case 5: moves a new chapter to the next column near the column tail", () => {
    const handbook = buildTemplateHandbook(
      [
        template(codeLines(17, "graph"), "Graph", 1, 2),
        template(codeLines(4, "tree"), "Tree", 2, 4),
      ],
      categories(),
      "auto",
      options,
      config({ pageColumnUnits: 30 }),
    );
    const firstPage = contentPages(handbook)[0];
    const columnsBand = firstPage.bands.find((band) => band.kind === "columns");

    expect(columnsBand?.kind).toBe("columns");
    if (columnsBand?.kind !== "columns") return;
    expect(columnsBand.columns[0].blocks.some((block) => block.kind === "chapter" && block.label === "数据结构")).toBe(false);
    expect(columnsBand.columns[1].blocks.some((block) => block.kind === "chapter" && block.label === "数据结构")).toBe(true);
  });

  it("Case 6: moves a short block that barely misses the remaining space without splitting it", () => {
    const handbook = buildTemplateHandbook(
      [template(codeLines(17), "A", 1), template(codeLines(10), "B", 2)],
      [],
      "auto",
      options,
      config({ pageColumnUnits: 32 }),
    );
    const firstPage = contentPages(handbook)[0];
    const band = firstPage.bands.find((item) => item.kind === "columns");

    expect(band?.kind).toBe("columns");
    if (band?.kind !== "columns") return;
    const rightB = band.columns[1].blocks.find((block) => (
      block.kind === "code" && block.slice.template.detail.name === "B"
    ));
    expect(rightB?.kind).toBe("code");
    if (rightB?.kind === "code") {
      expect(rightB.slice.startLine).toBe(0);
      expect(rightB.slice.continuation).toBe(false);
      expect(rightB.slice.lines).toHaveLength(10);
    }
  });

  it("Case 7: keeps a block just below the keep-together threshold intact", () => {
    const handbook = buildTemplateHandbook(
      [template(codeLines(25), "Almost Column", 1)],
      [],
      "auto",
      options,
      config({ pageColumnUnits: 40 }),
    );
    const slices = codeBlocks(handbook).map((block) => block.slice);

    expect(slices).toHaveLength(1);
    expect(slices[0].lines).toHaveLength(25);
  });

  it("Case 8: promotes normal-height code with a clearly overlong line to full width", () => {
    const source = ["int value;", `std::vector<int> ${"very_long_identifier_".repeat(6)};`, "return 0;"].join("\n");
    const handbook = buildTemplateHandbook([template(source, "Wide")], [], "auto", options);
    const block = codeBlocks(handbook)[0];

    expect(block.slice.fullWidth).toBe(true);
    expect(contentPages(handbook).some((page) => page.bands.some((band) => band.kind === "full"))).toBe(true);
  });

  it("Case 9: keeps consecutive full-width blocks ordered", () => {
    const wideLine = `int ${"wide_name_".repeat(10)};`;
    const templates = [1, 2, 3].map((id) => template(wideLine, `Wide ${id}`, id));
    const handbook = buildTemplateHandbook(templates, [], "auto", options);
    const blocks = codeBlocks(handbook);

    expect(blocks.map((block) => block.slice.template.detail.name)).toEqual(["Wide 1", "Wide 2", "Wide 3"]);
    expect(blocks.every((block) => block.slice.fullWidth)).toBe(true);
  });

  it("Case 10: resumes two-column flow after a full-width block without reordering", () => {
    const wideLine = `int ${"wide_name_".repeat(10)};`;
    const templates = [
      template(codeLines(5), "Before", 1),
      template(wideLine, "Wide", 2),
      template(codeLines(5), "After", 3),
    ];
    const handbook = buildTemplateHandbook(templates, [], "auto", options);
    const firstSlices = codeBlocks(handbook).filter((block) => !block.slice.continuation);
    const bandKinds = contentPages(handbook).flatMap((page) => page.bands.map((band) => band.kind));

    expect(firstSlices.map((block) => block.slice.template.detail.name)).toEqual(["Before", "Wide", "After"]);
    expect(bandKinds).toContain("full");
    expect(bandKinds.filter((kind) => kind === "columns").length).toBeGreaterThanOrEqual(2);
  });

  it("moves a long column block past a shallow remainder below a full-width block", () => {
    const wideSource = Array.from({ length: 7 }, (_, index) => (
      `int ${"wide_name_".repeat(9)}${index};`
    )).join("\n");
    const handbook = buildTemplateHandbook(
      [template(wideSource, "Wide", 1), template(codeLines(20), "Long after wide", 2)],
      [],
      "auto",
      options,
      config({ pageColumnUnits: 20 }),
    );
    const pages = contentPages(handbook);
    const longFirstSlicePage = pages.findIndex((page) => pageBlocks(page).some((block) => (
      block.kind === "code"
      && block.slice.template.detail.name === "Long after wide"
      && !block.slice.continuation
    )));

    expect(longFirstSlicePage).toBeGreaterThan(0);
    expect(pages.every((page) => page.metrics.usedUnits <= page.metrics.availableUnits)).toBe(true);
  });

  it("Case 11: produces stable page counts and TOC numbers for a 30-50 page handbook", () => {
    const templates = Array.from({ length: 120 }, (_, index) => (
      template(codeLines(25, `bulk${index}`), `Bulk ${index + 1}`, index + 1)
    ));
    const first = buildTemplateHandbook(templates, [], "auto", options);
    const second = buildTemplateHandbook(templates, [], "auto", options);

    expect(first.pages.length).toBeGreaterThanOrEqual(30);
    expect(first.pages.length).toBeLessThanOrEqual(50);
    expect(second.pages.length).toBe(first.pages.length);
    expect(second.tocEntries.map((entry) => entry.pageNumber)).toEqual(
      first.tocEntries.map((entry) => entry.pageNumber),
    );
    expect(first.pages.map((page) => page.number)).toEqual(
      Array.from({ length: first.pages.length }, (_, index) => index + 1),
    );
  });

  it("Case 12: provides an ink-saving grayscale print theme", () => {
    const css = readFileSync(new URL("../workbench.css", import.meta.url), "utf8");

    expect(css).toContain("body.template-print-active .print-code-block");
    expect(css).toContain("background: #fff !important");
    expect(css).toContain("print-color-adjust: economy");
  });

  it("records chapter and section page numbers from the final content layout", () => {
    const handbook = buildTemplateHandbook(
      [template(codeLines(8), "Dijkstra", 1, 2)],
      categories(),
      "auto",
      options,
    );
    const entry = handbook.tocEntries[0];

    expect(entry.chapterPageNumber).toBeGreaterThan(0);
    expect(entry.sectionPageNumber).toBeGreaterThanOrEqual(entry.chapterPageNumber);
    expect(entry.pageNumber).toBeGreaterThanOrEqual(entry.sectionPageNumber);
  });

  it("escapes source text while retaining syntax highlight spans", () => {
    const lines = highlightedCodeLines("if (a < b) return \"<ok>\";", "cpp");
    const html = lines.join("\n");

    expect(html).toContain("tok-keyword");
    expect(html).toContain("&lt;");
    expect(html).not.toContain("<ok>");
  });

  it("prepares deterministic source and visual-line measurements", () => {
    const printable = preparePrintableTemplate(template("int a;\n\tint 中文;"), "auto");

    expect(printable.sourceLines).toEqual(["int a;", "\tint 中文;"]);
    expect(printable.visualLineLengths).toHaveLength(2);
    expect(printable.maxLineLength).toBe(Math.max(...printable.visualLineLengths));
  });
});
