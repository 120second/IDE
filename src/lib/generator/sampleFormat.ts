import type { ValueExpression, VisualField, VisualNode, VisualRange } from "../types/generator";
import { arrayField, constant, graphNode, integerField, line, newRuleId, scopeAfterLineField, scopeBefore, treeNode, variable } from "./visualRules";
import { expressionText } from "./valueExpression";

export interface SampleFormat {
  id: string;
  label: string;
  description: string;
  nodes: VisualNode[];
  warning?: string;
}

type Rows = string[][];
type Match = { nodes: VisualNode[]; end: number };
type Pattern = { id: string; label: string; description: string; warning?: string; match: (rows: Rows, start: number) => Match | undefined };

const numeric = (row: string[] | undefined) => Boolean(row?.length && row.every((value) => /^[+-]?\d+$/.test(value)));
const size = (value: string | undefined): number => value && /^\+?\d+$/.test(value) && BigInt(value) <= 1_000_000n ? Number(value) : -1;
const fixed = (name: string, value: number) => integerField(name, constant(value), constant(value));

function observed(values: string[]): VisualRange {
  const numbers = values.map(BigInt);
  let min = numbers[0], max = numbers[0];
  for (const value of numbers) { if (value < min) min = value; if (value > max) max = value; }
  return { minimum: constant(min.toString()), maximum: constant(max.toString()) };
}

function array(values: string[]): VisualNode {
  return line([{ ...arrayField("a", variable("n")), ...observed(values) }]);
}

function repeated(count: string, fields: VisualField[]): VisualNode {
  return { type: "repeat", id: newRuleId("repeat"), count: variable(count), children: [line(fields)] };
}

function dataRows(rows: Rows, start: number, count: number): Rows | undefined {
  if (count < 1 || start + count > rows.length) return;
  const data = rows.slice(start, start + count);
  if (!data.every(numeric) || data[0].length > 6 || !data.every((row) => row.length === data[0].length)) return;
  return data;
}

function pairFields(rows: Rows, n: number, ordered = false, indexBase?: 0 | 1): VisualField[] {
  const base = indexBase ?? (rows.some((row) => row.some((value) => BigInt(value) === 0n)) ? 0 : 1);
  const endpoints = rows[0]?.length === 2 && rows.every((row) => row.every((value) => BigInt(value) >= BigInt(base) && BigInt(value) < BigInt(n + base)));
  return rows[0].map((_, column) => {
    const name = endpoints ? (ordered ? ["l", "r"][column] : ["u", "v"][column]) : `x${column + 1}`;
    return endpoints ? integerField(name, ordered && column === 1 ? variable("l") : constant(base), variable("n", base - 1))
      : { ...integerField(name), ...observed(rows.map((row) => row[column])) };
  });
}

/** Verify the sample really describes a simple tree; do not guess from row count alone. */
function tree(rows: Rows, start: number, n: number): Extract<VisualNode, { type: "tree" }> | undefined {
  if (n < 1 || start + n - 1 > rows.length) return;
  const edges = rows.slice(start, start + n - 1);
  if (!edges.every((row) => numeric(row) && (row.length === 2 || row.length === 3))
    || edges.some((row) => row.length !== edges[0]?.length)) return;
  const base = edges.some((row) => size(row[0]) === 0 || size(row[1]) === 0) ? 0 : 1;
  const parent = Array.from({ length: n }, (_, index) => index);
  const root = (value: number): number => { while (value !== parent[value]) { parent[value] = parent[parent[value]]; value = parent[value]; } return value; };
  for (const edge of edges) {
    const u = size(edge[0]) - base, v = size(edge[1]) - base;
    if (u < 0 || v < 0 || u >= n || v >= n || root(u) === root(v)) return;
    parent[root(u)] = root(v);
  }
  return { ...treeNode(variable("n")), indexBase: base,
    ...(edges[0]?.length === 3 ? { weight: observed(edges.map((edge) => edge[2])) } : {}) };
}

function treePattern(withArray: boolean, withQueries: boolean): Pattern {
  return {
    id: `tree${withArray ? "Array" : ""}${withQueries ? "Queries" : ""}`,
    label: `${withArray ? "点权 + " : ""}树${withQueries ? " + 询问" : ""}`,
    description: `n${withQueries ? " q" : ""}${withArray ? " → n 个点权" : ""} → n−1 条边${withQueries ? " → q 行询问" : ""}`,
    warning: withQueries ? "询问各列的含义无法仅凭样例确定，请检查下面的取值范围。" : undefined,
    match(rows, start) {
      const header = rows[start];
      if (!numeric(header) || header.length !== (withQueries ? 2 : 1)) return;
      const n = size(header[0]), q = withQueries ? size(header[1]) : 0;
      if (n < 1 || withQueries && q < 1) return;
      let cursor = start + 1;
      const nodes: VisualNode[] = [line([fixed("n", n), ...(withQueries ? [fixed("q", q)] : [])])];
      if (withArray) {
        if (!numeric(rows[cursor]) || rows[cursor].length !== n) return;
        nodes.push(array(rows[cursor++]));
      }
      const edges = tree(rows, cursor, n);
      if (!edges) return;
      nodes.push(edges);
      cursor += n - 1;
      if (withQueries) {
        const queries = dataRows(rows, cursor, q);
        if (!queries) return;
        nodes.push(repeated("q", pairFields(queries, n, false, edges.indexBase)));
        cursor += q;
      }
      return { nodes, end: cursor };
    },
  };
}

const patterns: Pattern[] = [
  treePattern(true, true), treePattern(false, true),
  { id: "arrayQueries", label: "数组 + 询问", description: "n q → n 个数 → q 行询问", warning: "询问范围按样例推测；若是区间查询，可切换到“数组 + 区间查询”。",
    match(rows, start) {
      const head = rows[start];
      if (!numeric(head) || head.length !== 2) return;
      const n = size(head[0]), q = size(head[1]);
      if (n < 1 || !numeric(rows[start + 1]) || rows[start + 1].length !== n) return;
      const data = dataRows(rows, start + 2, q);
      if (!data) return;
      return { nodes: [line([fixed("n", n), fixed("q", q)]), array(rows[start + 1]), repeated("q", pairFields(data, n))], end: start + 2 + q };
    } },
  { id: "intervalQueries", label: "数组 + 区间查询", description: "n q → 数组 → q 行 l r，保证 1 ≤ l ≤ r ≤ n", warning: "此解释额外保证 l ≤ r；请确认题目需要有序区间。",
    match(rows, start) {
      const head = rows[start];
      if (!numeric(head) || head.length !== 2) return;
      const n = size(head[0]), q = size(head[1]);
      const data = dataRows(rows, start + 2, q);
      if (n < 1 || !numeric(rows[start + 1]) || rows[start + 1].length !== n || !data
        || !data.every((row) => row.length === 2 && BigInt(row[0]) >= 1n && BigInt(row[0]) <= BigInt(row[1]) && BigInt(row[1]) <= BigInt(n))) return;
      return { nodes: [line([fixed("n", n), fixed("q", q)]), array(rows[start + 1]), repeated("q", pairFields(data, n, true))], end: start + 2 + q };
    } },
  treePattern(true, false), treePattern(false, false),
  { id: "array", label: "一维数组", description: "n → 一行 n 个整数",
    match(rows, start) {
      const head = rows[start], values = rows[start + 1];
      if (head?.length !== 1 || size(head[0]) < 1 || !numeric(values) || values.length !== size(head[0])) return;
      return { nodes: [line([fixed("n", size(head[0]))]), array(values)], end: start + 2 };
    } },
  { id: "permutation", label: "排列", description: "n → 1 到 n 的随机排列，不重复", warning: "样例也可能是普通数组；此解释会额外保证每个数恰好出现一次。",
    match(rows, start) {
      const head = rows[start], values = rows[start + 1];
      const n = head?.length === 1 ? size(head[0]) : -1;
      if (n < 1 || !numeric(values) || values.length !== n || new Set(values.map((value) => BigInt(value).toString())).size !== n
        || !values.every((value) => BigInt(value) >= 1n && BigInt(value) <= BigInt(n))) return;
      return { nodes: [line([fixed("n", n)]), line([{ type: "permutation", id: newRuleId("field"), name: "p", length: variable("n") }])], end: start + 2 };
    } },
  { id: "string", label: "字符串", description: "n → 长度为 n 的字符串", warning: "仅凭 0/1 样例不能确定字符集；默认二进制串，其他小写字母样例使用 a～z。",
    match(rows, start) {
      const head = rows[start], value = rows[start + 1];
      const n = head?.length === 1 ? size(head[0]) : -1;
      if (n < 1 || value?.length !== 1 || value[0].length !== n || !/^(?:[a-z]+|[01]+)$/.test(value[0])) return;
      return { nodes: [line([fixed("n", n)]), line([{ type: "string", id: newRuleId("field"), name: "s", length: variable("n"), alphabet: /^[01]+$/.test(value[0]) ? "binary" : "lowercase" }])], end: start + 2 };
    } },
  { id: "graph", label: "简单无向图", description: "n m → m 行 u v，不含自环和重边", warning: "样例不能确定图的方向与连通性；需要有向图或指定连通性时请使用高级编辑。",
    match(rows, start) {
      const head = rows[start];
      if (!numeric(head) || head.length !== 2) return;
      const n = size(head[0]), m = size(head[1]);
      if (n < 1 || m < 1) return;
      const data = dataRows(rows, start + 1, m);
      if (!data || data.some((row) => row.length !== 2)) return;
      const base = data.some((row) => row.some((value) => BigInt(value) === 0n)) ? 0 : 1;
      const seen = new Set<string>();
      for (const row of data) {
        const u = size(row[0]), v = size(row[1]);
        if (u < base || v < base || u >= n + base || v >= n + base || u === v) return;
        const key = `${Math.min(u, v)},${Math.max(u, v)}`;
        if (seen.has(key)) return;
        seen.add(key);
      }
      return { nodes: [line([fixed("n", n), fixed("m", m)]), { ...graphNode(variable("n"), variable("m")), indexBase: base }], end: start + 1 + m };
    } },
  { id: "matrix", label: "矩阵", description: "n m → n 行，每行 m 个整数",
    match(rows, start) {
      const head = rows[start];
      if (!numeric(head) || head.length !== 2) return;
      const n = size(head[0]), m = size(head[1]);
      if (n < 1 || m < 1 || start + n >= rows.length) return;
      const data = rows.slice(start + 1, start + 1 + n);
      if (data.length !== n || !data.every((row) => numeric(row) && row.length === m)) return;
      return { nodes: [line([fixed("n", n), fixed("m", m)]), { type: "matrix", id: newRuleId("matrix"), name: "a", rows: variable("n"), columns: variable("m"), ...observed(data.flat()) }], end: start + 1 + n };
    } },
  { id: "rows", label: "n m + m 行数据", description: "n m → m 行相同列数的数据", warning: "仅关联行数；各列范围来自样例，不额外保证树、图、区间或操作类型等条件。",
    match(rows, start) {
      const head = rows[start];
      if (!numeric(head) || head.length !== 2) return;
      const n = size(head[0]), m = size(head[1]);
      const data = dataRows(rows, start + 1, m);
      if (n < 1 || !data) return;
      return { nodes: [line([fixed("n", n), fixed("m", m)]), repeated("m", pairFields(data, n))], end: start + 1 + m };
    } },
  { id: "integers", label: "一行整数", description: "一行固定列数的整数，各列范围可单独修改",
    match(rows, start) {
      const row = rows[start];
      if (!numeric(row) || row.length > 6) return;
      return { nodes: [line(row.map((value, index) => ({ ...integerField(row.length === 1 ? "x" : `x${index + 1}`), ...observed([value]) })))], end: start + 1 };
    } },
];

function shape(nodes: VisualNode[]): string {
  return nodes.map((node): string => {
    if (node.type === "repeat") return `repeat(${shape(node.children)})`;
    if (node.type === "line") return node.fields.map((field) => `${field.type}:${field.name}${field.type === "string" ? `:${field.alphabet}` : ""}`).join(",");
    if (node.type === "tree") return `tree:${node.indexBase}:${Boolean(node.weight)}`;
    if (node.type === "graph") return `graph:${node.indexBase}:${node.kind}`;
    return "matrix";
  }).join(";");
}

export function recognizeSample(text: string): SampleFormat[] {
  if (!text.trim()) throw new Error("请先粘贴题目的输入样例，只需输入部分。");
  if (text.length > 65_536) throw new Error("样例过长，请使用 64 KiB 以内的小样例识别格式。");
  const rows = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter((row) => row.trim()).map((row) => row.trim().split(/\s+/));
  if (rows.length > 2000 || rows.flat().length > 20_000) throw new Error("样例过大，请保留一份较小的完整输入。");
  for (const row of rows) for (const value of row) {
    if (/^[+-]?\d+$/.test(value)) {
      const integer = BigInt(value);
      if (integer < -(1n << 63n) || integer > (1n << 63n) - 1n) throw new Error("样例包含超出 int64 范围的整数。");
    } else if (!/^[a-z]+$/.test(value)) throw new Error("当前识别支持整数和小写字符串，请只粘贴输入数据，不含题面、输入标题或输出。");
  }
  const result: SampleFormat[] = [];
  for (const pattern of patterns) {
    const match = pattern.match(rows, 0);
    if (match?.end === rows.length) result.push({ ...pattern, nodes: match.nodes });
  }
  const tests = rows[0].length === 1 ? size(rows[0][0]) : -1;
  if (tests > 0 && tests <= 100 && rows.length > 2) {
    for (const pattern of patterns) {
      let cursor = 1;
      let first: VisualNode[] | undefined;
      const matches: VisualNode[][] = [];
      for (let index = 0; index < tests; index++) {
        const match = pattern.match(rows, cursor);
        if (!match) break;
        first ??= match.nodes;
        matches.push(match.nodes);
        cursor = match.end;
      }
      if (matches.length === tests && cursor === rows.length && first && matches.every((match) => shape(match) === shape(first!))) {
        // Merge observed ranges from every case without losing int64 precision.
        const merge = (target: VisualNode[], other: VisualNode[]): VisualNode[] => target.map((node, index) => {
          const peer = other[index];
          if (node.type === "line" && peer.type === "line") return { ...node, fields: node.fields.map((field, column) => {
            const otherField = peer.fields[column];
            if ((field.type === "integer" || field.type === "array") && (otherField.type === "integer" || otherField.type === "array")
              && field.minimum.type === "constant" && field.maximum.type === "constant" && otherField.minimum.type === "constant" && otherField.maximum.type === "constant") {
              return { ...field, ...observed([field.minimum.value, field.maximum.value, otherField.minimum.value, otherField.maximum.value]) };
            }
            return field;
          }) };
          if (node.type === "repeat" && peer.type === "repeat") return { ...node, children: merge(node.children, peer.children) };
          if (node.type === "matrix" && peer.type === "matrix") return { ...node, ...observed([node.minimum, node.maximum, peer.minimum, peer.maximum].map((value) => (value as { value: string }).value)) };
          if (node.type === "tree" && peer.type === "tree" && node.weight && peer.weight) return { ...node, weight: observed([node.weight.minimum, node.weight.maximum, peer.weight.minimum, peer.weight.maximum].map((value) => (value as { value: string }).value)) };
          return node;
        });
        let nodes = first;
        for (const match of matches.slice(1)) nodes = merge(nodes, match);
        result.push({ id: `multi-${pattern.id}`, label: `T 组 · ${pattern.label}`, description: `首行为 T，每组：${pattern.description}`, warning: pattern.warning,
          nodes: [line([fixed("T", tests)]), { type: "repeat", id: newRuleId("repeat"), count: variable("T"), children: nodes }] });
      }
    }
  }
  if (!result.length) throw new Error("暂时无法可靠识别这个样例。请使用完整输入，或切到高级编辑自定义格式；原来的格式已保留。");
  return result;
}

export interface SampleRange extends VisualRange {
  id: string;
  nodeId: string;
  label: string;
  detail: string;
  variables: string[];
}

export function sampleRanges(nodes: VisualNode[], parentScope: string[] = [], prefix = ""): SampleRange[] {
  return nodes.flatMap((node, index): SampleRange[] => {
    const variables = scopeBefore(nodes, index, parentScope);
    const detail = prefix || (index === 0 ? "首行" : "输入数据");
    if (node.type === "repeat") return sampleRanges(node.children, variables,
      node.count.type === "variable" && /^t$/i.test(node.count.name) ? "每组测试" : node.count.type === "variable" && node.count.name === "q" ? "每条询问" : "每次循环");
    if (node.type === "line") return node.fields.flatMap((field, column) => field.type === "integer" || field.type === "array" ? [{
      id: field.id, nodeId: node.id, label: field.type === "array" ? `${field.name} 的元素` : field.name,
      detail: `${detail} · ${field.type === "integer" ? "整数" : `数组长度 ${expressionText(field.length)}`}`, minimum: field.minimum, maximum: field.maximum,
      variables: scopeAfterLineField(node.fields, column, variables),
    }] : []);
    if (node.type === "matrix") return [{ ...node, nodeId: node.id, label: `${node.name} 的元素`, detail: `${detail} · 矩阵`, variables }];
    if (node.type === "tree" && node.weight) return [{ ...node.weight, id: node.id, nodeId: node.id, label: "边权 w", detail: `${detail} · 树`, variables }];
    return [];
  });
}

export function updateSampleRange(nodes: VisualNode[], id: string, bound: "minimum" | "maximum", value: ValueExpression): VisualNode[] {
  return nodes.map((node) => {
    if (node.type === "repeat") return { ...node, children: updateSampleRange(node.children, id, bound, value) };
    if (node.type === "line") return { ...node, fields: node.fields.map((field) => field.id === id && (field.type === "integer" || field.type === "array") ? { ...field, [bound]: value } : field) };
    if (node.id === id && node.type === "matrix") return { ...node, [bound]: value };
    if (node.id === id && node.type === "tree" && node.weight) return { ...node, weight: { ...node.weight, [bound]: value } };
    return node;
  });
}

export const SAMPLE_EXAMPLES = [
  { label: "数组", input: "5\n3 1 4 1 5" },
  { label: "树 + 点权 + 询问", input: "4 1\n1 2 3 4\n1 2\n2 3\n3 4\n1 1" },
  { label: "区间查询", input: "5 3\n1 4 2 5 3\n1 3\n2 5\n1 5" },
  { label: "多组测试", input: "2\n3\n1 2 3\n4\n4 2 1 3" },
];
