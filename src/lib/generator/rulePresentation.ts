import { expressionLabel, STRATEGIES, TREE_SHAPES } from "./visualRules";
import type { ValueExpression, VisualField, VisualNode } from "../types/generator";

const nameOf = (field: VisualField) => field.name.trim() || "未命名";
const range = (minimum: ValueExpression, maximum: ValueExpression) => `${expressionLabel(minimum)}～${expressionLabel(maximum)}`;

function fieldSignature(field: VisualField): string {
  const name = nameOf(field);
  if (field.type === "integer" || field.type === "string") return name;
  const length = expressionLabel(field.length);
  if (field.length.type === "constant" && field.length.value.trim() === "1") return `${name}[1]`;
  return `${name}[1] … ${name}[${length}]`;
}

function fieldDetail(field: VisualField, showName: boolean): string[] {
  const prefix = showName ? `${nameOf(field)}：` : "";
  if (field.type === "integer") return [`${nameOf(field)}：${range(field.minimum, field.maximum)}`];
  if (field.type === "array") return [
    `${prefix}${expressionLabel(field.length)} 个整数`,
    `每项 ${range(field.minimum, field.maximum)}`,
    ...(field.strategy ? [STRATEGIES.find((item) => item.value === field.strategy)?.label ?? field.strategy] : []),
  ];
  if (field.type === "string") return [`${prefix}长度 ${expressionLabel(field.length)}`, field.alphabet === "binary" ? "仅 0、1" : "小写字母 a～z"];
  return [`${prefix}1～${expressionLabel(field.length)}，不重复`];
}

export function presentRule(node: VisualNode): { kind: string; signature: string; details: string[] } {
  if (node.type === "line") {
    const first = node.fields[0];
    const kind = !first ? "输入行"
      : node.fields.every((field) => field.type === "integer") ? "整数行"
      : node.fields.length > 1 ? "混合行"
      : first.type === "array" ? "数组" : first.type === "string" ? "字符串" : "排列";
    return {
      kind,
      signature: node.fields.map(fieldSignature).join("   ") || "尚未添加数据",
      details: node.fields.flatMap((field) => fieldDetail(field, node.fields.length > 1)),
    };
  }
  if (node.type === "repeat") return { kind: "循环", signature: `重复 ${expressionLabel(node.count)} 次`, details: [] };
  if (node.type === "tree") return {
    kind: node.weight ? "带权树" : "树",
    signature: `${expressionLabel(node.nodes)} 个点`,
    details: [
      `编号从 ${node.indexBase} 开始`,
      node.shape ? TREE_SHAPES.find((item) => item.value === node.shape)?.label ?? node.shape : "默认树形",
      ...(node.weight ? [`边权 ${range(node.weight.minimum, node.weight.maximum)}`] : []),
    ],
  };
  if (node.type === "graph") return {
    kind: "图",
    signature: `${expressionLabel(node.nodes)} 个点 · ${expressionLabel(node.edges)} 条边`,
    details: [node.kind === "dag" ? "有向无环图" : node.kind === "connectedUndirected" ? "连通无向图" : "简单无向图", `编号从 ${node.indexBase} 开始`],
  };
  return {
    kind: "矩阵",
    signature: `${node.name.trim() || "未命名"} · ${expressionLabel(node.rows)} 行 × ${expressionLabel(node.columns)} 列`,
    details: [`每项 ${range(node.minimum, node.maximum)}`, ...(node.strategy ? [STRATEGIES.find((item) => item.value === node.strategy)?.label ?? node.strategy] : [])],
  };
}
