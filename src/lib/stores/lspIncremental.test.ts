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

function diagnosticEvent(
  path: string,
  message: string,
  version?: number,
  severity = 1,
): Extract<LspEvent, { type: "diagnostics" }> {
  return {
    type: "diagnostics",
    path,
    version,
    diagnostics: [{
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity,
      message,
      source: "clangd",
      code: message,
    }],
  };
}

function publish(store: LspStore, event: LspEvent): void {
  (store as unknown as { handleEvent(event: LspEvent): void }).handleEvent(event);
}

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

    publish(store, diagnosticEvent(path, "late"));

    expect(store.diagnosticsFor(path)).toEqual([]);
    expect(editor.setLspDiagnostics).not.toHaveBeenCalled();
    store.dispose();
  });

  it("ignores diagnostics published for an older document version", () => {
    const editor = {
      setLspClient: vi.fn(),
      setLspDiagnostics: vi.fn(),
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    const path = "D:\\Code\\main.cpp";
    store.didOpen(path, "");
    store.didChange(path, [firstChange]);

    publish(store, diagnosticEvent(path, "stale", 1));

    expect(store.diagnosticsFor(path)).toEqual([]);
    expect(editor.setLspDiagnostics).not.toHaveBeenCalled();
    store.dispose();
  });

  it("accepts an empty current-version publication and clears editor diagnostics", () => {
    const editor = {
      setLspClient: vi.fn(),
      setLspDiagnostics: vi.fn(),
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    const path = "D:\\Code\\main.cpp";
    store.didOpen(path, "");
    publish(store, diagnosticEvent(path, "error", 1));
    editor.setLspDiagnostics.mockClear();

    publish(store, { type: "diagnostics", path, version: 1, diagnostics: [] });

    expect(store.diagnosticsFor(path)).toEqual([]);
    expect(editor.setLspDiagnostics).toHaveBeenCalledWith(path, []);
    store.dispose();
  });

  it("removes stale errors after a successful compile but keeps warnings", () => {
    const editor = {
      setLspClient: vi.fn(),
      setLspDiagnostics: vi.fn(),
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    const path = "D:\\Code\\main.cpp";
    store.didOpen(path, "");
    const error = diagnosticEvent(path, "error", 1);
    const warning = diagnosticEvent(path, "warning", 1, 2);
    publish(store, {
      type: "diagnostics",
      path,
      version: 1,
      diagnostics: [...error.diagnostics, ...warning.diagnostics],
    });

    store.acceptSuccessfulCompile(path);

    expect(store.errorCount).toBe(0);
    expect(store.warningCount).toBe(1);
    expect(editor.setLspDiagnostics).toHaveBeenLastCalledWith(
      path,
      [expect.objectContaining({ message: "warning", severity: 2 })],
    );
    store.dispose();
  });
});
