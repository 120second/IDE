import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  cancelLspRequest: vi.fn(async () => false),
  lspCompletion: vi.fn(),
  lspDefinition: vi.fn(),
  lspDidChange: vi.fn(async () => undefined),
  lspDidClose: vi.fn(async () => undefined),
  lspDidOpen: vi.fn(async () => undefined),
  lspDidSave: vi.fn(async () => undefined),
  lspHover: vi.fn(),
  lspReferences: vi.fn(),
  lspSignatureHelp: vi.fn(),
  startClangd: vi.fn(),
  stopClangd: vi.fn(async () => undefined),
}));

vi.mock("../api/lsp", () => api);

import type { LspEvent, LspTextChange } from "../types/lsp";
import { LspStore } from "./lsp.svelte";

const firstChange: LspTextChange = {
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  },
  text: "a",
};

const secondChange: LspTextChange = {
  range: {
    start: { line: 0, character: 1 },
    end: { line: 0, character: 1 },
  },
  text: "b",
};

describe("LSP incremental batching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.lspDidChange.mockClear();
    api.lspDidOpen.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes on the original batch deadline during continuous typing", async () => {
    const editor = {
      setLspClient: vi.fn(),
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    store.didOpen("D:\\Code\\main.cpp", "");
    store.didChange("D:\\Code\\main.cpp", [firstChange]);

    await vi.advanceTimersByTimeAsync(16);
    store.didChange("D:\\Code\\main.cpp", [secondChange]);
    await vi.advanceTimersByTimeAsync(16);

    expect(api.lspDidChange).toHaveBeenCalledTimes(1);
    expect(api.lspDidChange).toHaveBeenCalledWith(
      "D:\\Code\\main.cpp",
      3,
      [firstChange, secondChange],
    );
    store.dispose();
    expect(editor.setLspClient).toHaveBeenLastCalledWith(undefined);
  });

  it("drops late diagnostics after a document leaves language-service mode", () => {
    const editor = {
      setLspClient: vi.fn(),
      setLspDiagnostics: vi.fn(),
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    const path = "D:\\Code\\large.cpp";
    store.didOpen(path, "");
    store.didClose(path);
    editor.setLspDiagnostics.mockClear();

    const event: LspEvent = {
      type: "diagnostics",
      path,
      diagnostics: [{
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        message: "late",
        source: "clangd",
        code: "late",
      }],
    };
    (store as unknown as { handleEvent(event: LspEvent): void }).handleEvent(event);

    expect(store.diagnosticsFor(path)).toEqual([]);
    expect(editor.setLspDiagnostics).not.toHaveBeenCalled();
    store.dispose();
  });
});
