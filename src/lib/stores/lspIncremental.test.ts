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
      setLspDiagnostics: vi.fn(),
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    store.didOpen("D:\\Code\\main.cpp", "");
    store.didChange("D:\\Code\\main.cpp", [firstChange]);

    await vi.advanceTimersByTimeAsync(60);
    store.didChange("D:\\Code\\main.cpp", [secondChange]);
    await vi.advanceTimersByTimeAsync(60);

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

  it("ignores diagnostics published for an older document version", async () => {
    const editor = {
      setLspClient: vi.fn(),
      setLspDiagnostics: vi.fn(),
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    const path = "D:\\Code\\main.cpp";
    store.didOpen(path, "");
    store.didChange(path, [firstChange]);
    await Promise.resolve();
    editor.setLspDiagnostics.mockClear();

    publish(store, diagnosticEvent(path, "stale", 1));

    expect(store.diagnosticsFor(path)).toEqual([]);
    expect(editor.setLspDiagnostics).not.toHaveBeenCalled();
    store.dispose();
  });

  it("clears edited diagnostics immediately and rejects old publications while checking", async () => {
    const editor = {
      setLspClient: vi.fn(),
      setLspDiagnostics: vi.fn(),
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    const path = "D:\\Code\\main.cpp";
    store.didOpen(path, "");
    publish(store, diagnosticEvent(path, "old error", 1));
    editor.setLspDiagnostics.mockClear();

    store.didChange(path, [firstChange]);
    await Promise.resolve();

    expect(store.errorCount).toBe(0);
    expect(store.isChecked(path)).toBe(false);
    expect(editor.setLspDiagnostics).toHaveBeenLastCalledWith(path, []);
    publish(store, { type: "diagnostics", path, version: 1, diagnostics: [] });
    expect(store.errorCount).toBe(0);
    publish(store, { type: "diagnostics", path, version: 2, diagnostics: [] });
    expect(store.errorCount).toBe(0);
    expect(editor.setLspDiagnostics).toHaveBeenLastCalledWith(path, []);
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

  it("does not erase clangd errors after an unrelated successful compile", () => {
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

    store.acceptCompileResult(path, { success: true, stdout: "", stderr: "", durationMs: 0, outputTruncated: false });

    expect(store.errorCount).toBe(1);
    expect(store.warningCount).toBe(1);
    store.dispose();
  });

  it("waits for an in-flight timer batch before sending a language request", async () => {
    const editor = { setLspClient: vi.fn(), setLspDiagnostics: vi.fn() };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    const path = "D:\\Code\\main.cpp";
    store.didOpen(path, "");
    let finishChange!: () => void;
    api.lspDidChange.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finishChange = () => resolve(undefined); }));
    api.lspHover.mockResolvedValueOnce({ contents: "current" });
    store.didChange(path, [firstChange]);
    await vi.advanceTimersByTimeAsync(120);
    api.lspHover.mockClear();
    const hovering = store.hover(path, { line: 0, character: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.lspHover).not.toHaveBeenCalled();
    finishChange();
    expect(await hovering).toBe("current");
    expect(api.lspHover).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("discards a response if the user edits the document while waiting", async () => {
    const editor = { setLspClient: vi.fn(), setLspDiagnostics: vi.fn() };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    const path = "D:\\Code\\main.cpp";
    store.didOpen(path, "");
    let finishHover!: (value: unknown) => void;
    api.lspHover.mockImplementationOnce(() => new Promise((resolve) => { finishHover = resolve; }));
    const hovering = store.hover(path, { line: 0, character: 0 });
    await vi.advanceTimersByTimeAsync(0);
    store.didChange(path, [firstChange]);
    finishHover({ contents: "outdated" });
    expect(await hovering).toBe("");
    store.dispose();
  });

  it("does not clear errors in unsaved edits after an older snapshot compiles", () => {
    const path = "D:\\Code\\main.cpp";
    const editor = { tabs: [{ path, dirty: true }], setLspClient: vi.fn(), setLspDiagnostics: vi.fn() };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    store.didOpen(path, "");
    publish(store, diagnosticEvent(path, "undeclared variable", 1));
    store.acceptCompileResult(path, { success: true, stdout: "", stderr: "", durationMs: 0, outputTruncated: false });
    expect(store.errorCount).toBe(1);
    store.dispose();
  });

  it("does not allow document notifications before the backend start command completes", () => {
    const editor = { setLspClient: vi.fn(), setLspDiagnostics: vi.fn() };
    const store = new LspStore(editor as never, {} as never);
    store.state = "starting";
    publish(store, { type: "state", state: "ready", message: "initialized" });
    store.didOpen("D:\\Code\\main.cpp", "void dfs2() { add_subtree(1, 1); }");
    expect(store.ready).toBe(false);
    expect(api.lspDidOpen).not.toHaveBeenCalled();
    store.dispose();
  });

  it("opens the latest unsaved text if an edited restored file was missed at startup", async () => {
    const path = "D:\\Code\\CF570D Tree Requests.cpp";
    const text = "void dfs2() { add_subtree(1, 1); }";
    const editor = {
      setLspClient: vi.fn(), setLspDiagnostics: vi.fn(),
      openLspDocuments: () => [{ path, text }],
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    store.didChange(path, [firstChange]);
    await vi.advanceTimersByTimeAsync(120);
    expect(api.lspDidOpen).toHaveBeenCalledWith(path, text, 1);
    expect(api.lspDidChange).not.toHaveBeenCalled();
    publish(store, diagnosticEvent(path, "undeclared add_subtree", 1));
    expect(store.errorCount).toBe(1);
    store.dispose();
  });

  it("exposes failed document synchronization instead of reporting a ready connection", async () => {
    const editor = { setLspClient: vi.fn(), setLspDiagnostics: vi.fn() };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    api.lspDidOpen.mockRejectedValueOnce(new Error("LSP document is outside the active workspace"));
    store.didOpen("D:\\Code\\main.cpp", "");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.ready).toBe(false);
    expect(store.state).toBe("unavailable");
    expect(store.message).toContain("outside the active workspace");
    store.dispose();
  });

  it("registers every restored document before awaiting IPC, without reopening an already live file", async () => {
    const first = "D:\\Code\\first.cpp";
    const second = "D:\\Code\\second.cpp";
    const editor = {
      setLspClient: vi.fn(), setLspDiagnostics: vi.fn(),
      openLspDocuments: () => [{ path: first, text: "" }, { path: second, text: "" }],
    };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    let finishFirst!: () => void;
    api.lspDidOpen.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finishFirst = () => resolve(undefined); }));
    const syncing = (store as unknown as { syncOpenDocuments(): Promise<void> }).syncOpenDocuments();
    await vi.advanceTimersByTimeAsync(0);
    store.didChange(second, [firstChange]);
    await vi.advanceTimersByTimeAsync(120);
    expect(api.lspDidChange).toHaveBeenCalledWith(second, 2, [firstChange]);
    finishFirst();
    await syncing;
    await (store as unknown as { syncOpenDocuments(): Promise<void> }).syncOpenDocuments();
    expect(api.lspDidOpen).toHaveBeenCalledTimes(2);
    publish(store, diagnosticEvent(second, "undeclared add_subtree", 2));
    expect(store.errorCount).toBe(1);
    store.dispose();
  });

  it("checks open translation units again after unsaved header changes and header close", async () => {
    const main = "D:\\Code\\main.cpp", header = "D:\\Code\\types.hpp";
    const editor = { tabs: [{ path: main }, { path: header }], setLspClient: vi.fn(), setLspDiagnostics: vi.fn(), openLspDocuments: () => [{ path: main, text: "int main(){}" }, { path: header, text: "struct Item{};" }] };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    store.didOpen(main, "int main(){}");
    store.didOpen(header, "struct Item{};");
    await vi.advanceTimersByTimeAsync(240);
    publish(store, { type: "diagnostics", path: main, version: 2, diagnostics: [] });
    expect(store.isChecked(main)).toBe(true);
    store.didChange(header, [firstChange]);
    publish(store, diagnosticEvent(main, "outdated dependency result", 2));
    expect(store.errorCount).toBe(0);
    expect(store.isChecked(main)).toBe(false);
    await vi.advanceTimersByTimeAsync(240);
    expect(api.lspDidOpen).toHaveBeenCalledWith(main, "int main(){}", 3);
    publish(store, diagnosticEvent(main, "header changed", 3));
    expect(store.errorCount).toBe(1);
    store.didClose(header);
    await vi.advanceTimersByTimeAsync(240);
    publish(store, { type: "diagnostics", path: main, version: 4, diagnostics: [] });
    expect(store.isChecked(main)).toBe(true);
    expect(store.errorCount).toBe(0);
    store.dispose();
  });

  it("ignores a failed notification from before a configuration change", async () => {
    const editor = { setLspClient: vi.fn(), setLspDiagnostics: vi.fn(), clearLspDiagnostics: vi.fn() };
    const store = new LspStore(editor as never, {} as never);
    store.state = "ready";
    let reject!: (error: Error) => void;
    api.lspDidOpen.mockImplementationOnce(() => new Promise((_resolve, rejectResult) => { reject = rejectResult; }));
    store.didOpen("D:\\Code\\main.cpp", "");
    await vi.advanceTimersByTimeAsync(0);
    store.configure("D:\\Code", "", "g++", "c++23", []);
    reject(new Error("old session has exited"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state).toBe("starting");
    expect(store.message).not.toContain("old session");
    store.dispose();
  });
});
