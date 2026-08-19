import { describe, expect, it } from "vitest";
import {
  constant,
  createTemplate,
  defaultVisualProfile,
  integerField,
  line,
  scopeAfterLineField,
  scopeBefore,
  validateVisualProfile,
  variable,
} from "./visualRules";
import type { VisualGeneratorProfile, VisualNode } from "../types/generator";

function profile(nodes: VisualNode[]): VisualGeneratorProfile {
  return { ...defaultVisualProfile(), nodes, seed: "42" };
}

describe("visual generator rules", () => {
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
});
