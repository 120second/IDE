import { createTemplate, expressionLabel, testCaseWrapper, type GeneratorTemplateId } from "./visualRules";
import type { VisualNode } from "../types/generator";

export const FORMAT_PRESETS: { id: GeneratorTemplateId; title: string; example: string }[] = [
  { id: "nArray", title: "数组", example: "n → a₁ … aₙ" },
  { id: "nqQueries", title: "区间查询", example: "n q → 数组 → l r" },
  { id: "tree", title: "树", example: "n → n−1 条边" },
  { id: "graph", title: "图", example: "n m → m 条边" },
  { id: "matrix", title: "矩阵", example: "n m → n × m 个数" },
  { id: "string", title: "字符串", example: "n → 长度为 n 的串" },
  { id: "permutation", title: "排列", example: "n → 1 … n 不重复" },
  { id: "nm", title: "整数行", example: "n m · 可增减字段" },
];

function structure(nodes: VisualNode[]): string {
  return nodes.map((node) => {
    if (node.type === "line") return `line:${node.fields.map((field) => `${field.type}:${field.name}`).join(",")}`;
    if (node.type === "repeat") return `repeat:${expressionLabel(node.count)}{${structure(node.children)}}`;
    return `${node.type}${node.type === "tree" ? Boolean(node.weight) : ""}`;
  }).join(";");
}

export function detectPreset(nodes: VisualNode[]): GeneratorTemplateId | undefined {
  const body = testCaseWrapper(nodes)?.children ?? nodes;
  const target = structure(body);
  return FORMAT_PRESETS.find((preset) => structure(createTemplate(preset.id)) === target)?.id;
}

export function formatOutline(nodes: VisualNode[], depth = 0): string[] {
  return nodes.flatMap((node): string[] => {
    const indent = "  ".repeat(depth);
    if (node.type === "line") return [indent + node.fields.map((field) => {
      if (field.type === "integer" || field.type === "string") return field.name || "?";
      return `${field.name}[1] … ${field.name}[${expressionLabel(field.length)}]`;
    }).join(" ")];
    if (node.type === "repeat") return [indent + `重复 ${expressionLabel(node.count)} 次 {`, ...formatOutline(node.children, depth + 1), indent + "}"];
    if (node.type === "tree") return [indent + `u v${node.weight ? " w" : ""}  · ${expressionLabel(node.nodes)}−1 行`];
    if (node.type === "graph") return [indent + `u v  · ${expressionLabel(node.edges)} 行`];
    return [indent + `${node.name}[1][1] … ${node.name}[1][${expressionLabel(node.columns)}]`, indent + `… 共 ${expressionLabel(node.rows)} 行`];
  });
}
