import { expect, it } from "vitest";
import { mapDiagnosticChanges } from "./diagnosticChanges";
import type { LspDiagnostic } from "../types/lsp";

const error: LspDiagnostic = { path: "main.cpp", source: "clangd", code: "undeclared", severity: 1, message: "missing",
  range: { start: { line: 2, character: 4 }, end: { line: 2, character: 11 } } };

it("invalidates edited tokens and moves untouched diagnostics using UTF-16 positions", () => {
  expect(mapDiagnosticChanges([error], [{ range: error.range, text: "defined" }])).toEqual([]);
  expect(mapDiagnosticChanges([error], [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "// 😀\n" }])[0].range).toEqual({ start: { line: 3, character: 4 }, end: { line: 3, character: 11 } });
  expect(mapDiagnosticChanges([error], [{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }, text: "😀" }])[0].range.start.character).toBe(6);
});

it("applies batched changes in order and preserves unrelated errors", () => {
  const second = { ...error, range: { start: { line: 4, character: 0 }, end: { line: 4, character: 5 } } };
  const result = mapDiagnosticChanges([error, second], [
    { range: error.range, text: "correct" },
    { range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, text: "" },
  ]);
  expect(result).toHaveLength(1);
  expect(result[0].range.start.line).toBe(3);
});
