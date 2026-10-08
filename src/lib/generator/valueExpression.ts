import type { ValueExpression } from "../types/generator";

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

/** Parse the small, explicit syntax supported by the visual generator. No eval. */
function parseSimpleExpression(text: string): ValueExpression | undefined {
  const value = text.trim().replace(/−/g, "-");
  const reference = value.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*([+-])\s*(\d+))?$/);
  if (reference) {
    const offset = reference[3] ? Number(reference[3]) * (reference[2] === "-" ? -1 : 1) : 0;
    if (!Number.isSafeInteger(offset)) return undefined;
    return { type: "variable", name: reference[1], offset };
  }
  let integer: bigint;
  try {
    if (/^[+-]?\d+$/.test(value)) integer = BigInt(value);
    else {
      const scientific = value.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
      const power = value.match(/^([+-]?)10\s*\^\s*(\d+)$/);
      if (scientific) {
        const exponent = Number(scientific[4]) - (scientific[3]?.length ?? 0);
        if (exponent < 0 || exponent > 19 || scientific[2].length + (scientific[3]?.length ?? 0) > 25) return undefined;
        integer = BigInt(scientific[2] + (scientific[3] ?? "")) * 10n ** BigInt(exponent);
        if (scientific[1] === "-") integer = -integer;
      } else if (power && Number(power[2]) <= 19) {
        integer = 10n ** BigInt(power[2]) * (power[1] === "-" ? -1n : 1n);
      } else return undefined;
    }
  } catch { return undefined; }
  return integer >= INT64_MIN && integer <= INT64_MAX ? { type: "constant", value: integer.toString() } : undefined;
}

/** Integer arithmetic with conventional precedence, bounded input, and no execution of code. */
export function parseValueExpression(text: string): ValueExpression | undefined {
  const source = text.trim().replace(/−/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/");
  if (!source || source.length > 512) return undefined;
  const simple = parseSimpleExpression(source);
  if (simple) return simple;
  const tokens: string[] = [];
  let remaining = source;
  while (remaining.trim()) {
    remaining = remaining.trimStart();
    const token = remaining.match(/^(?:10\s*\^\s*\d+|\d+(?:\.\d+)?[eE]\+?\d+|\d+|[A-Za-z_][A-Za-z0-9_]*|[()+*/%\-])/);
    if (!token || tokens.length >= 128) return undefined;
    if (/^[eE]$/.test(token[0]) && /^\d+$/.test(tokens.at(-1) ?? "")) return undefined;
    tokens.push(token[0]);
    remaining = remaining.slice(token[0].length);
  }
  let position = 0;
  type Operator = Extract<ValueExpression, { type: "arithmetic" }>["operator"];
  const operation = (operator: Operator, left: ValueExpression, right: ValueExpression): ValueExpression => ({ type: "arithmetic", operator, left, right });
  function atom(depth: number): ValueExpression {
    if (depth > 32) throw new Error("表达式过于复杂");
    const token = tokens[position++];
    if (token === "+" || token === "-") {
      const signed = parseSimpleExpression(token + (tokens[position] ?? ""));
      if (signed?.type === "constant") { position++; return signed; }
      const operand = atom(depth + 1);
      return token === "+" ? operand : operation("*", { type: "constant", value: "-1" }, operand);
    }
    if (token === "(") {
      const inner = sum(depth + 1);
      if (tokens[position++] !== ")") throw new Error("括号不完整");
      return inner;
    }
    const value = token ? parseSimpleExpression(token) : undefined;
    if (!value) throw new Error("无效表达式");
    return value;
  }
  function product(depth: number): ValueExpression {
    let left = atom(depth);
    while (position < tokens.length) {
      const token = tokens[position];
      const implicit = (/^\d/.test(tokens[position - 1]) && /^[A-Za-z_(]/.test(token)) || (tokens[position - 1] === ")" && token === "(");
      if (token !== "*" && token !== "/" && token !== "%" && !implicit) break;
      if (!implicit) position++;
      left = operation(implicit ? "*" : token as Operator, left, atom(depth + 1));
    }
    return left;
  }
  function sum(depth: number): ValueExpression {
    let left = product(depth);
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++] as Operator;
      left = operation(operator, left, product(depth + 1));
    }
    return left;
  }
  try {
    const result = sum(0);
    if (position !== tokens.length) return undefined;
    const evaluated = evaluateExpression(result);
    return evaluated === undefined ? result : { type: "constant", value: evaluated.toString() };
  } catch { return undefined; }
}

/** Missing values stay unknown for static validation. All known operations use exact int64. */
export function evaluateExpression(value: ValueExpression, lookup: (name: string) => bigint | undefined = () => undefined, depth = 0): bigint | undefined {
  if (depth > 32) throw new Error("表达式过于复杂，请简化");
  let result: bigint | undefined;
  if (value.type === "constant") {
    if (!/^[+-]?\d+$/.test(value.value.trim())) throw new Error("请填写整数、1e9 或算术表达式，如 3n、n*m、(n+1)/2");
    result = BigInt(value.value);
  } else if (value.type === "variable") {
    if (!Number.isSafeInteger(value.offset)) throw new Error("变量偏移量超出安全整数范围");
    const resolved = lookup(value.name);
    result = resolved === undefined ? undefined : resolved + BigInt(value.offset);
  } else {
    const left = evaluateExpression(value.left, lookup, depth + 1);
    const right = evaluateExpression(value.right, lookup, depth + 1);
    if ((value.operator === "/" || value.operator === "%") && right === 0n) throw new Error("除数不能为 0");
    if (left === undefined || right === undefined) return undefined;
    switch (value.operator) {
      case "+": result = left + right; break;
      case "-": result = left - right; break;
      case "*": result = left * right; break;
      case "/": result = left / right; break;
      case "%": result = left % right; break;
      default: throw new Error("不支持的算术运算");
    }
  }
  if (result !== undefined && (result < INT64_MIN || result > INT64_MAX)) throw new Error("计算结果超出了 int64 范围");
  return result;
}

export function constantExpressionValue(value: ValueExpression): bigint | undefined {
  try { return evaluateExpression(value); } catch { return undefined; }
}

export function expressionIssue(value: ValueExpression, scope: string[]): string | undefined {
  try {
    evaluateExpression(value, (name) => {
      if (!scope.includes(name)) throw new Error(`引用的变量“${name}”在当前作用域中不存在。`);
      return undefined;
    });
  } catch (error) { return error instanceof Error ? error.message : "表达式无效"; }
  return undefined;
}

export function expressionText(value: ValueExpression): string {
  if (value.type === "constant") return value.value;
  if (value.type === "variable") return `${value.name}${value.offset ? `${value.offset > 0 ? "+" : ""}${value.offset}` : ""}`;
  const operand = (child: ValueExpression) => child.type === "arithmetic" || child.type === "variable" && child.offset ? `(${expressionText(child)})` : expressionText(child);
  return `${operand(value.left)}${value.operator}${operand(value.right)}`;
}

/** Older versions saved unsupported drafts such as 3n as constant text. Repair those on load. */
export function normalizeSavedExpressions<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== "object") return item;
    const object = item as Record<string, unknown>;
    if (object.type === "constant" && typeof object.value === "string") return parseValueExpression(object.value) ?? object;
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value) as T;
}
