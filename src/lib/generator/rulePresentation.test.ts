import { describe, expect, it } from "vitest";
import { presentRule } from "./rulePresentation";
import { arrayField, constant, createTemplate, integerField, line, variable } from "./visualRules";
import type { VisualNode } from "../types/generator";

describe("input format presentation", () => {
  it("keeps integer order and dependent bounds visible", () => {
    const node = line([integerField("l", constant(1), variable("n")), integerField("r", variable("l"), variable("n", -1))]);
    const result = presentRule(node);
    expect(result.signature).toBe("l   r");
    expect(result.details).toEqual(["l：1～n", "r：l～n - 1"]);
  });

  it("distinguishes array size, range and strategy without changing the rule", () => {
    const field = { ...arrayField("a", variable("n", 1)), strategy: "descending" as const };
    const node = line([field]);
    const before = JSON.stringify(node);
    const result = presentRule(node);
    expect(result.signature).toBe("a[1] … a[n + 1]");
    expect(result.details).toEqual(["n + 1 个整数", "每项 1～1000", "降序"]);
    expect(JSON.stringify(node)).toBe(before);
    expect(presentRule(line([arrayField("a", constant(1))])).signature).toBe("a[1]");
  });

  it("labels mixed rows and preserves the constraints of every field", () => {
    const result = presentRule(line([
      integerField("n"),
      { type: "string", id: "s", name: "s", length: variable("n"), alphabet: "binary" },
      { type: "permutation", id: "p", name: "p", length: variable("n") },
    ]));
    expect(result.kind).toBe("混合行");
    expect(result.signature).toBe("n   s   p[1] … p[n]");
    expect(result.details).toContain("s：长度 n");
    expect(result.details).toContain("仅 0、1");
    expect(result.details).toContain("p：1～n，不重复");
  });

  it("retains tree weights, graph kinds, index bases and matrix dimensions", () => {
    const tree: VisualNode = { type: "tree", id: "t", nodes: variable("n"), indexBase: 0, shape: "chain", weight: { minimum: constant(-5), maximum: constant(5) } };
    expect(presentRule(tree)).toMatchObject({ kind: "带权树", details: ["编号从 0 开始", "链", "边权 -5～5"] });
    const graph: VisualNode = { type: "graph", id: "g", nodes: variable("n"), edges: variable("m"), kind: "dag", indexBase: 1 };
    expect(presentRule(graph)).toMatchObject({ signature: "n 个点 · m 条边", details: ["有向无环图", "编号从 1 开始"] });
    const matrix: VisualNode = { type: "matrix", id: "mat", name: "mat", rows: variable("n"), columns: variable("m"), minimum: constant(-10), maximum: constant(10) };
    expect(presentRule(matrix)).toMatchObject({ signature: "mat · n 行 × m 列", details: ["每项 -10～10"] });
  });

  it("presents repeat counts separately from their child rows", () => {
    const repeat = createTemplate("nqQueries")[2];
    expect(presentRule(repeat)).toEqual({ kind: "循环", signature: "重复 q 次", details: [] });
    expect(repeat.type === "repeat" && presentRule(repeat.children[0]).signature).toBe("l   r");
    expect(presentRule(line([])).signature).toBe("尚未添加数据");
  });
});
