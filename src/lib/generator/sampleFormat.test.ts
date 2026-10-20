import { describe, expect, it } from "vitest";
import { recognizeSample, SAMPLE_EXAMPLES, sampleRanges, updateSampleRange } from "./sampleFormat";
import { constant, defaultVisualProfile, validateVisualProfile } from "./visualRules";
import { expressionText } from "./valueExpression";
import type { VisualNode } from "../types/generator";
import fixture from "./fixtures/sample-tree-queries.json";

describe("input sample recognition", () => {
  it.each(SAMPLE_EXAMPLES)("recognizes the $label example as valid rules", ({ input }) => {
    const choices = recognizeSample(input);
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) expect(validateVisualProfile({ ...defaultVisualProfile(), nodes: choice.nodes })).toEqual([]);
  });

  it("recognizes the user's node weights, tree and queries in their actual input order", () => {
    const choice = recognizeSample(SAMPLE_EXAMPLES[1].input)[0];
    expect(choice.id).toBe("treeArrayQueries");
    const withoutIds = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) => key === "id" ? undefined : item));
    expect(withoutIds(choice.nodes)).toEqual(withoutIds(fixture.nodes));
    expect(choice.nodes.map((node) => node.type)).toEqual(["line", "line", "tree", "repeat"]);
    const ranges = sampleRanges(choice.nodes);
    expect(ranges.map((row) => row.label)).toEqual(["n", "q", "a 的元素", "u", "v"]);
    expect(expressionText(ranges[3].maximum)).toBe("n");
    const edited = updateSampleRange(choice.nodes, ranges[0].id, "maximum", constant(100));
    expect(sampleRanges(edited)[0].maximum).toEqual(constant(100));
    expect(edited[2]).toMatchObject({ type: "tree", nodes: { type: "variable", name: "n" } });
    expect(edited[3]).toMatchObject({ count: { type: "variable", name: "q" } });
    expect(sampleRanges(choice.nodes)[0].maximum).toEqual(constant(4));
  });

  it("exposes array/permutation and general/ordered query interpretations", () => {
    expect(recognizeSample("3\n1 2 3").map((item) => item.id)).toContain("permutation");
    const choices = recognizeSample(SAMPLE_EXAMPLES[2].input);
    expect(choices.map((item) => item.id)).toEqual(expect.arrayContaining(["arrayQueries", "intervalQueries"]));
    const ordered = choices.find((item) => item.id === "intervalQueries")!;
    const r = sampleRanges(ordered.nodes).find((row) => row.label === "r")!;
    expect(expressionText(r.minimum)).toBe("l");
    expect(r.variables).toContain("l");
  });

  it("keeps large integers exact and supports negative and fixed-value ranges", () => {
    const choice = recognizeSample("3\n-9007199254740993 0 9007199254740993").find((item) => item.id === "array")!;
    const range = sampleRanges(choice.nodes)[1];
    expect(expressionText(range.minimum)).toBe("-9007199254740993");
    expect(expressionText(range.maximum)).toBe("9007199254740993");
    expect(sampleRanges(recognizeSample("7")[0].nodes)[0].minimum).toEqual(constant(7));
  });

  it("merges ranges across multiple test cases and preserves a T wrapper", () => {
    const choice = recognizeSample(SAMPLE_EXAMPLES[3].input).find((item) => item.id === "multi-array")!;
    expect(choice.nodes[1]).toMatchObject({ type: "repeat", count: { name: "T" } });
    const ranges = sampleRanges(choice.nodes);
    expect(ranges[1]).toMatchObject({ label: "n", minimum: constant(3), maximum: constant(4) });
    expect(ranges[2]).toMatchObject({ label: "a 的元素", minimum: constant(1), maximum: constant(4) });
  });

  it("recognizes weighted trees and zero-based node numbering", () => {
    const choice = recognizeSample("3\n0 1 -5\n1 2 8").find((item) => item.id === "tree")!;
    expect(choice.nodes[1]).toMatchObject({ type: "tree", indexBase: 0, weight: { minimum: constant(-5), maximum: constant(8) } });
    const updated = updateSampleRange(choice.nodes, choice.nodes[1].id, "maximum", constant(99));
    expect(updated[1]).toMatchObject({ weight: { maximum: constant(99) } });
  });

  it("recognizes string lengths, graph edges and matrix dimensions", () => {
    expect(recognizeSample("4\n0010").find((item) => item.id === "string")!.nodes[1]).toMatchObject({ fields: [{ type: "string", alphabet: "binary", length: { name: "n" } }] });
    expect(recognizeSample("4 3\n1 2\n2 3\n3 4").map((item) => item.id)).toContain("graph");
    expect(recognizeSample("2 3\n1 2 3\n4 5 6").find((item) => item.id === "matrix")!.nodes[1]).toMatchObject({ type: "matrix", rows: { name: "n" }, columns: { name: "m" } });
  });

  it("does not call a cyclic or disconnected edge list a tree", () => {
    expect(() => recognizeSample("4\n1 2\n2 3\n3 1")).toThrow();
    expect(() => recognizeSample("4\n1 2\n1 2\n3 4")).toThrow();
  });

  it.each(["", "输入\n3\n1 2 3", "3\n1 2", "3\n1 2 3\noutput 6", "2\n9223372036854775808 0", "a".repeat(65537)])("rejects incomplete or unsupported input without pretending to understand it", (text) => {
    expect(() => recognizeSample(text)).toThrow();
  });

  it("keeps invalid range drafts visible to validation instead of replacing them silently", () => {
    const nodes = recognizeSample("3\n1 2 4").find((item) => item.id === "array")!.nodes;
    const range = sampleRanges(nodes)[0];
    const reversed: VisualNode[] = updateSampleRange(nodes, range.id, "minimum", constant(10));
    expect(validateVisualProfile({ ...defaultVisualProfile(), nodes: reversed }).some((item) => item.message.includes("下界"))).toBe(true);
  });
});
