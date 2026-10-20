// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView, showTooltip } from "@codemirror/view";
import { DEFAULT_SETTINGS } from "../stores/settings.svelte";
import type { LspSignatureHelp } from "../types/lsp";
import { EditorWorkspace } from "./workspace.svelte";

const signature: LspSignatureHelp = { label: "add(int a, int b)", activeParameter: 1, documentation: "" };

describe("asynchronous parameter help in the editor", () => {
  let editor: EditorWorkspace;
  let view: EditorView;
  let resolveSignature: (value: LspSignatureHelp | undefined) => void;
  let signatureHelp: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    editor = new EditorWorkspace(DEFAULT_SETTINGS);
    editor.createTab();
    editor.insertSnippet("add(1, 2)");
    editor.tabs = editor.tabs.map((tab) => ({ ...tab, path: "D:\\Code\\main.cpp" }));
    signatureHelp = vi.fn(() => new Promise<LspSignatureHelp | undefined>((resolve) => { resolveSignature = resolve; }));
    editor.setLspClient({ ready: true, signatureHelp, didChange: vi.fn(), didClose: vi.fn() } as never);
    const host = document.createElement("div");
    document.body.appendChild(host);
    editor.attach(host);
    view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    view.focus();
  });
  afterEach(() => {
    editor.dispose();
    document.body.replaceChildren();
  });

  const popups = () => view.state.facet(showTooltip).filter(Boolean);

  it("allows diagnostics to update while the signature request is pending", async () => {
    const pending = editor.requestSignatureHelp();
    editor.setLspDiagnostics("D:\\Code\\main.cpp", []);
    resolveSignature(signature);
    await pending;
    expect(popups()).toHaveLength(1);
  });

  it("does not reopen the popup after an edit or an Escape dismissal", async () => {
    const edited = editor.requestSignatureHelp();
    view.dispatch({ changes: { from: 6, to: 7, insert: "3" } });
    resolveSignature(signature);
    await edited;
    expect(popups()).toHaveLength(0);
    const dismissed = editor.requestSignatureHelp();
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    resolveSignature(signature);
    await dismissed;
    expect(popups()).toHaveLength(0);
  });

  it("does not let an older empty response hide newer parameter help", async () => {
    const first = editor.requestSignatureHelp();
    const resolveFirst = resolveSignature;
    const second = editor.requestSignatureHelp();
    resolveSignature(signature);
    await second;
    expect(popups()).toHaveLength(1);
    resolveFirst(undefined);
    await first;
    expect(popups()).toHaveLength(1);
  });

  it("closes and invalidates pending help when focus leaves the editor", async () => {
    const pending = editor.requestSignatureHelp();
    view.contentDOM.blur();
    resolveSignature(signature);
    await pending;
    expect(popups()).toHaveLength(0);
    view.focus();
    const visible = editor.requestSignatureHelp();
    resolveSignature(signature);
    await visible;
    expect(popups()).toHaveLength(1);
    view.contentDOM.blur();
    expect(popups()).toHaveLength(0);
  });

  it("does not save a visible popup when switching away and back to a tab", async () => {
    const firstTab = editor.activeId;
    const pending = editor.requestSignatureHelp();
    resolveSignature(signature);
    await pending;
    expect(popups()).toHaveLength(1);
    editor.createTab();
    editor.switchTab(firstTab);
    expect(popups()).toHaveLength(0);
  });
});
