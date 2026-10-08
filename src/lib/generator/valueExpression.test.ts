import { describe, expect, it } from "vitest";
import { evaluateExpression, expressionIssue, expressionText, normalizeSavedExpressions, parseValueExpression } from "./valueExpression";

describe("direct generator expressions", () => {
  it("repairs saved unsupported 3n drafts without discarding other rules", () => {
    const old = { nodes: [{ type: "line", id: "s-line", fields: [{ type: "string", id: "s", name: "s", alphabet: "lowercase", length: { type: "constant", value: "3n" } }] }] };
    const migrated = normalizeSavedExpressions(old);
    expect(migrated.nodes[0].fields[0].length).toEqual(parseValueExpression("3n"));
    expect(migrated.nodes[0].fields[0].name).toBe("s");
    expect(old.nodes[0].fields[0].length.value).toBe("3n");
    expect(normalizeSavedExpressions({ type: "constant", value: "invalid(" })).toEqual({ type: "constant", value: "invalid(" });
  });
  it("accepts contest-scale shorthand without rounding large integers", () => {
    for (const [input, expected] of [["1e9", "1000000000"], ["-1e18", "-1000000000000000000"], ["1.5e3", "1500"], ["10^9", "1000000000"], ["9223372036854775807", "9223372036854775807"], ["-9223372036854775808", "-9223372036854775808"]]) {
      expect(parseValueExpression(input)).toEqual({ type: "constant", value: expected });
    }
  });
  it("accepts earlier variables and signed offsets", () => {
    expect(parseValueExpression(" n - 1 ")).toEqual({ type: "variable", name: "n", offset: -1 });
    expect(parseValueExpression("T")).toEqual({ type: "variable", name: "T", offset: 0 });
    expect(expressionText({ type: "variable", name: "n", offset: 2 })).toBe("n+2");
  });
  it("rejects code, decimals and overflowing bounds", () => {
    for (const value of ["", "1e", "1e10000", "10^10000", "1.2", "1.5e0", "9223372036854775808", "-9223372036854775809", "process.exit()", "1;alert(1)"]) expect(parseValueExpression(value), value).toBeUndefined();
  });
  it("supports the reported 3n length and equivalent coefficient forms", () => {
    for (const input of ["3n", "3*n", "3 n", "n*3", "3×n"]) {
      const parsed = parseValueExpression(input)!;
      expect(parsed).toBeDefined();
      expect(expressionIssue(parsed, ["n"])).toBeUndefined();
      expect(evaluateExpression(parsed, () => 7n)).toBe(21n);
      expect(evaluateExpression(parseValueExpression(expressionText(parsed))!, () => 7n)).toBe(21n);
    }
  });
  it("uses normal precedence, parentheses and integer division", () => {
    for (const [input, result] of [["3n+1", 22n], ["n*m", 28n], ["2(n+1)", 16n], ["(n+1)/2", 4n], ["n+2*m", 15n], ["n%4", 3n], ["-n/2", -3n], ["1e9+5", 1000000005n], ["n+9007199254740992", 9007199254740999n]] as const) {
      expect(evaluateExpression(parseValueExpression(input)!, (name) => name === "n" ? 7n : 4n), input).toBe(result);
    }
  });
  it("checks every referenced variable, zero division, overflow and parser limits", () => {
    expect(expressionIssue(parseValueExpression("n*m")!, ["n"])).toContain("m");
    for (const input of ["n/0", "n%(2-2)", "9223372036854775807+1", "n**2", "n m", "(n+1", "3".repeat(513), "(".repeat(40) + "n" + ")".repeat(40)]) expect(parseValueExpression(input), input).toBeUndefined();
    expect(() => evaluateExpression(parseValueExpression("3n")!, () => 9223372036854775807n)).toThrow("int64");
    expect(() => evaluateExpression(parseValueExpression("n/m")!, (name) => name === "n" ? 1n : 0n)).toThrow("除数");
  });
});
