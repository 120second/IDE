import type {
  GeneratorStrategy,
  TreeShape,
  ValueExpression,
  VisualDiagnostic,
  VisualField,
  VisualGeneratorProfile,
  VisualNode,
} from "../types/generator";

export type GeneratorTemplateId =
  | "n"
  | "nArray"
  | "nm"
  | "nmEdges"
  | "nqQueries"
  | "multiTest"
  | "tree"
  | "weightedTree"
  | "graph"
  | "permutation"
  | "string";

export const GENERATOR_TEMPLATES: Array<{ id: GeneratorTemplateId; label: string }> = [
  { id: "n", label: "n" },
  { id: "nArray", label: "n + 数组" },
  { id: "nm", label: "n m" },
  { id: "nmEdges", label: "n m + m 条边" },
  { id: "nqQueries", label: "n q + 数组 + q 次查询" },
  { id: "multiTest", label: "T 组测试" },
  { id: "tree", label: "树" },
  { id: "weightedTree", label: "带权树" },
  { id: "graph", label: "图" },
  { id: "permutation", label: "排列" },
  { id: "string", label: "字符串" },
];

let idSequence = 0;

export function newRuleId(prefix: string): string {
  idSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`;
}

export function constant(value: string | number): ValueExpression {
  return { type: "constant", value: String(value) };
}

export function variable(name: string, offset = 0): ValueExpression {
  return { type: "variable", name, offset };
}

export function integerField(name = "n", minimum: ValueExpression = constant(1), maximum: ValueExpression = constant(100)): VisualField {
  return { type: "integer", id: newRuleId("field"), name, minimum, maximum };
}

export function arrayField(name = "a", length: ValueExpression = variable("n")): VisualField {
  return {
    type: "array",
    id: newRuleId("field"),
    name,
    length,
    minimum: constant(1),
    maximum: constant(1000),
  };
}

export function line(fields: VisualField[] = [integerField()]): VisualNode {
  return { type: "line", id: newRuleId("line"), fields };
}

export function defaultVisualProfile(): VisualGeneratorProfile {
  return {
    version: 1,
    nodes: createTemplate("nqQueries"),
    strategy: "mixed",
    treeShape: "mixed",
    seed: "16574989564519419765",
  };
}

export function createTemplate(template: GeneratorTemplateId): VisualNode[] {
  switch (template) {
    case "n":
      return [line([integerField("n")])];
    case "nArray":
      return [line([integerField("n")]), line([arrayField("a", variable("n"))])];
    case "nm":
      return [line([integerField("n"), integerField("m")])];
    case "nmEdges":
      return [
        line([
          integerField("n", constant(3), constant(100)),
          integerField("m", constant(1), variable("n")),
        ]),
        graphNode(variable("n"), variable("m")),
      ];
    case "nqQueries":
      return [
        line([integerField("n"), integerField("q")]),
        line([arrayField("a", variable("n"))]),
        {
          type: "repeat",
          id: newRuleId("repeat"),
          count: variable("q"),
          children: [
            line([
              integerField("l", constant(1), variable("n")),
              integerField("r", variable("l"), variable("n")),
            ]),
          ],
        },
      ];
    case "multiTest":
      return [
        line([integerField("T", constant(1), constant(10))]),
        {
          type: "repeat",
          id: newRuleId("repeat"),
          count: variable("T"),
          children: [
            line([integerField("n")]),
            line([arrayField("a", variable("n"))]),
          ],
        },
      ];
    case "tree":
      return [line([integerField("n")]), treeNode(variable("n"))];
    case "weightedTree":
      return [
        line([integerField("n")]),
        { ...treeNode(variable("n")), weight: { minimum: constant(1), maximum: constant(1_000_000_000) } },
      ];
    case "graph":
      return [
        line([
          integerField("n", constant(3), constant(100)),
          integerField("m", constant(1), variable("n")),
        ]),
        graphNode(variable("n"), variable("m")),
      ];
    case "permutation":
      return [
        line([integerField("n")]),
        line([{ type: "permutation", id: newRuleId("field"), name: "p", length: variable("n") }]),
      ];
    case "string":
      return [
        line([integerField("n")]),
        line([{ type: "string", id: newRuleId("field"), name: "s", length: variable("n"), alphabet: "lowercase" }]),
      ];
  }
}

export function treeNode(nodes: ValueExpression): Extract<VisualNode, { type: "tree" }> {
  return { type: "tree", id: newRuleId("tree"), nodes, indexBase: 1 };
}

export function graphNode(nodes: ValueExpression, edges: ValueExpression): Extract<VisualNode, { type: "graph" }> {
  return {
    type: "graph",
    id: newRuleId("graph"),
    nodes,
    edges,
    indexBase: 1,
    kind: "simpleUndirected",
  };
}

export function cloneNode(node: VisualNode): VisualNode {
  const copy = structuredClone(node);
  renewIds(copy);
  return copy;
}

function renewIds(node: VisualNode): void {
  node.id = newRuleId(node.type);
  if (node.type === "line") {
    for (const field of node.fields) field.id = newRuleId("field");
  } else if (node.type === "repeat") {
    for (const child of node.children) renewIds(child);
  }
}

export function containsTree(nodes: VisualNode[]): boolean {
  return nodes.some((node) => node.type === "tree" || (node.type === "repeat" && containsTree(node.children)));
}

export function scopeBefore(nodes: VisualNode[], index: number, parentScope: string[] = []): string[] {
  const scope = [...parentScope];
  for (const node of nodes.slice(0, index)) addNodeDefinitions(node, scope);
  return unique(scope);
}

export function scopeAfterLineField(
  fields: VisualField[],
  index: number,
  parentScope: string[],
): string[] {
  const scope = [...parentScope];
  for (const field of fields.slice(0, index)) {
    if (field.type === "integer" && validName(field.name)) scope.push(field.name);
  }
  return unique(scope);
}

function addNodeDefinitions(node: VisualNode, scope: string[]): void {
  if (node.type !== "line") return;
  for (const field of node.fields) {
    if (field.type === "integer" && validName(field.name)) scope.push(field.name);
  }
}

export function validateVisualProfile(profile: VisualGeneratorProfile): VisualDiagnostic[] {
  const diagnostics: VisualDiagnostic[] = [];
  if (!validSeed(profile.seed)) {
    diagnostics.push({ nodeId: "profile", message: "种子必须是 uint64 十进制整数。" });
  }
  if (!profile.nodes.length) {
    diagnostics.push({ nodeId: "profile", message: "请至少添加一条输入规则。" });
  }
  validateNodes(profile.nodes, [], 0, diagnostics);
  return diagnostics;
}

function validateNodes(
  nodes: VisualNode[],
  parentScope: string[],
  depth: number,
  diagnostics: VisualDiagnostic[],
): void {
  const scope = [...parentScope];
  for (const node of nodes) {
    if (node.type === "line") {
      if (!node.fields.length) diagnostics.push({ nodeId: node.id, message: "一行中至少需要一个字段。" });
      if (node.fields.length > 1 && node.fields.some((field) => field.type === "array")) {
        diagnostics.push({ nodeId: node.id, message: "数组当前必须单独占一行。" });
      }
      for (const field of node.fields) validateField(node.id, field, scope, diagnostics);
      continue;
    }
    if (node.type === "repeat") {
      validateExpression(node.id, undefined, "重复次数", node.count, scope, diagnostics);
      validateNonnegative(node.id, undefined, "重复次数", node.count, diagnostics);
      if (!node.children.length) diagnostics.push({ nodeId: node.id, message: "重复块中至少需要一条规则。" });
      if (depth >= 4) diagnostics.push({ nodeId: node.id, message: "重复块最多嵌套 4 层。" });
      else validateNodes(node.children, [...scope], depth + 1, diagnostics);
      continue;
    }
    if (node.type === "tree") {
      validateExpression(node.id, undefined, "节点数", node.nodes, scope, diagnostics);
      validatePositive(node.id, "节点数", node.nodes, diagnostics);
      if (node.weight) {
        validateExpression(node.id, undefined, "权值下界", node.weight.minimum, scope, diagnostics);
        validateExpression(node.id, undefined, "权值上界", node.weight.maximum, scope, diagnostics);
      }
      continue;
    }
    if (node.type === "graph") {
      validateExpression(node.id, undefined, "节点数", node.nodes, scope, diagnostics);
      validateExpression(node.id, undefined, "边数", node.edges, scope, diagnostics);
      validateNonnegative(node.id, undefined, "节点数", node.nodes, diagnostics);
      validateNonnegative(node.id, undefined, "边数", node.edges, diagnostics);
      continue;
    }
    validateName(node.id, undefined, node.name, diagnostics);
    validateExpression(node.id, undefined, "矩阵行数", node.rows, scope, diagnostics);
    validateExpression(node.id, undefined, "矩阵列数", node.columns, scope, diagnostics);
    validateExpression(node.id, undefined, "元素下界", node.minimum, scope, diagnostics);
    validateExpression(node.id, undefined, "元素上界", node.maximum, scope, diagnostics);
  }
}

function validateField(
  nodeId: string,
  field: VisualField,
  scope: string[],
  diagnostics: VisualDiagnostic[],
): void {
  validateName(nodeId, field.id, field.name, diagnostics);
  if (field.type === "integer") {
    validateExpression(nodeId, field.id, "下界", field.minimum, scope, diagnostics);
    validateExpression(nodeId, field.id, "上界", field.maximum, scope, diagnostics);
    if (scope.includes(field.name)) {
      diagnostics.push({ nodeId, fieldId: field.id, message: `整数变量“${field.name}”已经定义。` });
    } else if (validName(field.name)) {
      scope.push(field.name);
    }
    return;
  }
  validateExpression(nodeId, field.id, "长度", field.length, scope, diagnostics);
  validateNonnegative(nodeId, field.id, "长度", field.length, diagnostics);
  if (field.type === "array") {
    validateExpression(nodeId, field.id, "元素下界", field.minimum, scope, diagnostics);
    validateExpression(nodeId, field.id, "元素上界", field.maximum, scope, diagnostics);
  }
}

function validateExpression(
  nodeId: string,
  fieldId: string | undefined,
  label: string,
  expression: ValueExpression,
  scope: string[],
  diagnostics: VisualDiagnostic[],
): void {
  if (expression.type === "constant") {
    if (!validInt64(expression.value)) diagnostics.push({ nodeId, fieldId, message: `${label}必须是 int64 整数。` });
  } else {
    if (!scope.includes(expression.name)) {
      diagnostics.push({ nodeId, fieldId, message: `${label}引用的变量“${expression.name}”在当前作用域中不存在。` });
    }
    if (!Number.isSafeInteger(expression.offset)) {
      diagnostics.push({ nodeId, fieldId, message: `${label}的偏移量必须是安全整数。` });
    }
  }
}

function validateName(nodeId: string, fieldId: string | undefined, name: string, diagnostics: VisualDiagnostic[]): void {
  if (!validName(name)) diagnostics.push({ nodeId, fieldId, message: "名称只能包含字母、数字和下划线，且不能以数字开头。" });
}

function validateNonnegative(
  nodeId: string,
  fieldId: string | undefined,
  label: string,
  expression: ValueExpression,
  diagnostics: VisualDiagnostic[],
): void {
  if (expression.type === "constant" && validInt64(expression.value) && BigInt(expression.value) < 0n) {
    diagnostics.push({ nodeId, fieldId, message: `${label}不能为负数。` });
  }
}

function validatePositive(nodeId: string, label: string, expression: ValueExpression, diagnostics: VisualDiagnostic[]): void {
  if (expression.type === "constant" && validInt64(expression.value) && BigInt(expression.value) <= 0n) {
    diagnostics.push({ nodeId, message: `${label}必须大于 0。` });
  }
}

export function expressionLabel(expression: ValueExpression): string {
  if (expression.type === "constant") return expression.value || "?";
  if (!expression.offset) return expression.name || "?";
  return `${expression.name || "?"} ${expression.offset > 0 ? "+" : "-"} ${Math.abs(expression.offset)}`;
}

export function fieldLabel(field: VisualField): string {
  if (field.type === "integer") return `${field.name || "?"}  ${expressionLabel(field.minimum)}~${expressionLabel(field.maximum)}`;
  if (field.type === "array") return `${field.name || "?"}[${expressionLabel(field.length)}]  ${expressionLabel(field.minimum)}~${expressionLabel(field.maximum)}`;
  if (field.type === "string") return `${field.name || "?"}[${expressionLabel(field.length)}]  ${field.alphabet === "binary" ? "二进制串" : "小写串"}`;
  return `${field.name || "?"}  排列(${expressionLabel(field.length)})`;
}

export function nodeDiagnostics(diagnostics: VisualDiagnostic[], nodeId: string): VisualDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.nodeId === nodeId);
}

export function fieldDiagnostics(diagnostics: VisualDiagnostic[], fieldId: string): VisualDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.fieldId === fieldId);
}

export const STRATEGIES: Array<{ value: GeneratorStrategy; label: string }> = [
  { value: "random", label: "随机" },
  { value: "minimum", label: "最小值" },
  { value: "maximum", label: "最大值" },
  { value: "small", label: "偏小" },
  { value: "large", label: "偏大" },
  { value: "allSame", label: "全部相同" },
  { value: "highDuplicate", label: "高重复" },
  { value: "ascending", label: "升序" },
  { value: "descending", label: "降序" },
  { value: "extreme", label: "极值交替" },
  { value: "mixed", label: "混合" },
];

export const TREE_SHAPES: Array<{ value: TreeShape; label: string }> = [
  { value: "random", label: "随机树" },
  { value: "chain", label: "链" },
  { value: "star", label: "菊花" },
  { value: "balanced", label: "平衡树" },
  { value: "broom", label: "扫帚" },
  { value: "mixed", label: "混合" },
];

function validName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function validInt64(value: string): boolean {
  if (!/^-?\d+$/.test(value.trim())) return false;
  const parsed = BigInt(value.trim());
  return parsed >= -(1n << 63n) && parsed <= (1n << 63n) - 1n;
}

function validSeed(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const parsed = BigInt(value.trim());
  return parsed >= 0n && parsed <= (1n << 64n) - 1n;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
