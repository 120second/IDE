import { describe, expect, it } from "vitest";
import { BoundedOutputBuffer } from "./outputBuffer";

describe("BoundedOutputBuffer", () => {
  it("batches many chunks into one bounded update", () => {
    const buffer = new BoundedOutputBuffer(100, "[truncated]\n");
    for (let index = 0; index < 10_000; index += 1) buffer.enqueue("line\n");
    expect(buffer.approximateLength("")).toBe(50_000);
    const output = buffer.flush("");
    expect(output.startsWith("[truncated]\n")).toBe(true);
    expect(output.length).toBe(112);
    expect(buffer.approximateLength(output)).toBe(output.length);
  });

  it("preserves order across flushes", () => {
    const buffer = new BoundedOutputBuffer(1024, "");
    buffer.enqueue("a");
    buffer.enqueue("b");
    const first = buffer.flush("");
    buffer.enqueue("c");
    expect(buffer.flush(first)).toBe("abc");
  });
});

