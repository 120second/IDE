import { describe, expect, it } from "vitest";

import { detectLineEnding, editorDocument, editorText, lineEndingText } from "./lineEndings";

describe("line ending preservation", () => {
  it.each([
    ["a\nb\n", "lf"],
    ["a\r\nb\r\n", "crlf"],
    ["a\rb\r", "cr"],
    ["no line break", "lf"],
  ] as const)("detects the document line ending", (content, expected) => {
    expect(detectLineEnding(content)).toBe(expected);
  });

  it("uses the dominant ending and the first ending as a tie breaker", () => {
    expect(detectLineEnding("a\r\nb\nc\r\nd")).toBe("crlf");
    expect(detectLineEnding("a\r\nb\nc")).toBe("crlf");
    expect(detectLineEnding("a\nb\r\nc")).toBe("lf");
  });

  it("normalizes mixed input to the selected document ending", () => {
    const text = editorText("a\r\nb\nc\rd");
    expect(text.sliceString(0, text.length, lineEndingText("crlf"))).toBe("a\r\nb\r\nc\r\nd");
  });

  it("builds editor text while preserving mixed-EOL detection", () => {
    const document = editorDocument("a\r\nb\nc\r\nd");
    expect(document.eol).toBe("crlf");
    expect(document.text.toString()).toBe("a\nb\nc\nd");
  });
});
