import { describe, expect, it } from "vitest";
import {
  parseCompletionResponse,
  parseHoverResponse,
  parseLocationResponse,
  parseSignatureResponse,
} from "./protocol";

describe("LSP protocol normalization", () => {
  it("normalizes completion lists and text edits", () => {
    const items = parseCompletionResponse({
      isIncomplete: false,
      items: [{
        label: "push_back",
        kind: 2,
        detail: "void push_back(const T&)",
        documentation: { kind: "markdown", value: "Adds an element." },
        textEdit: {
          range: {
            start: { line: 3, character: 7 },
            end: { line: 3, character: 9 },
          },
          newText: "push_back",
        },
      }],
    });

    expect(items).toHaveLength(1);
    expect(items[0].insertText).toBe("push_back");
    expect(items[0].textEdit?.range.start).toEqual({ line: 3, character: 7 });
  });

  it("normalizes hover, signature help, and location links", () => {
    expect(parseHoverResponse({ contents: { kind: "markdown", value: "`int n`" } }))
      .toBe("`int n`");
    expect(parseSignatureResponse({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [{ label: "max(int a, int b)", documentation: "Returns the larger value." }],
    })).toEqual({
      label: "max(int a, int b)",
      documentation: "Returns the larger value.",
      activeParameter: 1,
    });
    const location = parseLocationResponse({
      targetUri: "file:///tmp/main.cpp",
      targetSelectionRange: {
        start: { line: 5, character: 2 },
        end: { line: 5, character: 6 },
      },
    })[0];
    expect({ ...location, path: location.path.replaceAll("\\", "/") })
      .toMatchObject({ path: "/tmp/main.cpp", range: { start: { line: 5, character: 2 } } });
  });
});
