import { describe, expect, it } from "vitest";
import {
  constant,
  createTemplate,
  defaultVisualProfile,
  integerField,
  arrayField,
  line,
  repeatNode,
  scopeAfterLineField,
  scopeBefore,
  suggestIntegerName,
  validateVisualProfile,
  variable,
  wrapNodesInRepeat,
  toggleTestCases,
  testCaseWrapper,
} from "./visualRules";
import { detectPreset, FORMAT_PRESETS, formatOutline } from "./formatPresets";
import { parseValueExpression } from "./valueExpression";
import type { VisualGeneratorProfile, VisualNode } from "../types/generator";

function profile(nodes: VisualNode[]): VisualGeneratorProfile {
  return { ...defaultVisualProfile(), nodes, seed: "42" };
}

describe("visual generator rules", () => {
  it("accepts arithmetic in lengths, bounds and loops and preserves it on reload", () => {
    const nodes: VisualNode[] = [
      line([integerField("n"), integerField("m", constant(1), parseValueExpression("3n+1")!)]),
      line([{ type: "string", id: "s", name: "s", alphabet: "lowercase", length: parseValueExpression("3n")! }]),
      line([arrayField("a", parseValueExpression("n*m")!)]),
      { type: "repeat", id: "loop", count: parseValueExpression("(n+1)/2")!, children: [line([integerField("x")])] },
    ];
    const original = profile(nodes);
    expect(validateVisualProfile(original)).toEqual([]);
    expect(validateVisualProfile(JSON.parse(JSON.stringify(original)))).toEqual([]);
    const invalid = profile([line([integerField("n")]), line([arrayField("a", parseValueExpression("3*m")!)])]);
    expect(validateVisualProfile(invalid)[0].message).toContain("m");
  });
  it("serializes and deserializes a versioned rule tree", () => {
    const original = profile(createTemplate("nqQueries"));
    expect(JSON.parse(JSON.stringify(original))).toEqual(original);
    expect(original.version).toBe(1);
  });

  it("exposes earlier integer fields in the same line", () => {
    const fields = [integerField("n"), integerField("q", constant(1), variable("n"))];
    expect(scopeAfterLineField(fields, 0, [])).toEqual([]);
    expect(scopeAfterLineField(fields, 1, [])).toEqual(["n"]);
    expect(validateVisualProfile(profile([line(fields)]))).toEqual([]);
  });

  it("marks an array reference invalid immediately after n is deleted", () => {
    const nodes = createTemplate("nArray");
    expect(validateVisualProfile(profile(nodes))).toEqual([]);
    const diagnostics = validateVisualProfile(profile(nodes.slice(1)));
    expect(diagnostics.some((item) => item.message.includes("变量“n”") && item.message.includes("不存在"))).toBe(true);
  });

  it("keeps repeat variables inside the repeat scope", () => {
    const nodes = createTemplate("multiTest");
    expect(validateVisualProfile(profile(nodes))).toEqual([]);
    const repeat = nodes[1];
    expect(repeat.type).toBe("repeat");
    expect(scopeBefore(nodes, 2)).toEqual(["T"]);
    const outsideUse: VisualNode = {
      type: "tree",
      id: "outside-tree",
      nodes: variable("n"),
      indexBase: 1,
    };
    expect(validateVisualProfile(profile([...nodes, outsideUse])).some((item) => item.nodeId === "outside-tree")).toBe(true);
  });

  it("validates array, tree, and graph variable references from templates", () => {
    expect(validateVisualProfile(profile(createTemplate("nArray")))).toEqual([]);
    expect(validateVisualProfile(profile(createTemplate("tree")))).toEqual([]);
    expect(validateVisualProfile(profile(createTemplate("graph")))).toEqual([]);
  });

  it("builds all acceptance templates without handwritten DSL", () => {
    for (const template of ["nArray", "nqQueries", "multiTest", "tree", "graph"] as const) {
      const nodes = createTemplate(template);
      expect(nodes.length).toBeGreaterThan(1);
      expect(validateVisualProfile(profile(nodes))).toEqual([]);
    }
  });

  it("validates nested repeat blocks up to the supported depth", () => {
    const nested: VisualNode = {
      type: "repeat",
      id: "outer",
      count: constant(2),
      children: [{
        type: "repeat",
        id: "inner",
        count: constant(3),
        children: [line([integerField("x")])],
      }],
    };
    expect(validateVisualProfile(profile([nested]))).toEqual([]);
  });

  it("prefers conventional loop counters when creating a repeat block", () => {
    expect(repeatNode(["n", "m", "t"]).count).toEqual(variable("t"));
    expect(repeatNode(["T", "n", "m"]).count).toEqual(variable("T"));
    expect(repeatNode(["n", "m"]).count).toEqual(variable("m"));
    expect(repeatNode([]).count).toEqual(constant(1));
  });

  it("wraps existing trailing rules in a valid repeat block", () => {
    const t = line([integerField("t", constant(2), constant(2))]);
    const n = line([integerField("n")]);
    const values = line([{ ...integerField("m"), name: "m" }]);
    const wrapped = wrapNodesInRepeat([t, n, values], 1);

    expect(wrapped).toHaveLength(2);
    expect(wrapped[1]).toMatchObject({
      type: "repeat",
      count: variable("t"),
      children: [n, values],
    });
    expect(validateVisualProfile(profile(wrapped))).toEqual([]);
  });

  it("suggests conventional unique integer names in each scope", () => {
    expect(suggestIntegerName([])).toBe("n");
    expect(suggestIntegerName(["n"])).toBe("m");
    expect(suggestIntegerName(["t", "n", "m"])).toBe("q");
    expect(suggestIntegerName(["n", "m", "t", "q", "k", "x1"])).toBe("x2");
  });

  it("wraps any common format in T test cases while preserving its IDs and ranges", () => {
    for (const preset of FORMAT_PRESETS) {
      const original = createTemplate(preset.id);
      const wrapped = toggleTestCases(original);
      expect(testCaseWrapper(wrapped)?.children).toEqual(original);
      expect(validateVisualProfile(profile(wrapped))).toEqual([]);
      expect(toggleTestCases(wrapped)).toEqual(original);
      expect(detectPreset(wrapped)).toBe(preset.id);
    }
  });

  it("builds the matrix format and outlines actual dependent rows", () => {
    const nodes = createTemplate("matrix");
    expect(validateVisualProfile(profile(nodes))).toEqual([]);
    expect(formatOutline(nodes)).toEqual(["n m", "a[1][1] … a[1][m]", "… 共 n 行"]);
    expect(formatOutline(createTemplate("nqQueries"))).toContain("  l r");
  });

  it("marks reversed constant or same-variable bounds before generation", () => {
    const invalid = line([integerField("n", constant(10), constant(1))]);
    expect(validateVisualProfile(profile([invalid]))[0].message).toContain("下界不能大于上界");
    const dependent = line([integerField("n"), integerField("m", variable("n", 1), variable("n", -1))]);
    expect(validateVisualProfile(profile([dependent]))[0].fieldId).toBe(dependent.fields[1].id);
    const matrix = createTemplate("matrix");
    if (matrix[1].type === "matrix") matrix[1].rows = constant(-1);
    expect(validateVisualProfile(profile(matrix)).some((item) => item.message.includes("行数不能为负"))).toBe(true);
  });

  it("allows a length and its dependent array on the same output line", () => {
    expect(validateVisualProfile(profile([line([integerField("n"), arrayField("a", variable("n"))])]))).toEqual([]);
  });
});
