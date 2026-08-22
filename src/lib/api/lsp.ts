import { invoke } from "@tauri-apps/api/core";
import type { LspPosition, LspStartResult, LspTextChange } from "../types/lsp";

export function startClangd(
  clangdPath: string,
  compilerPath: string,
  compilerStandard: string,
  compilerArgs: readonly string[],
): Promise<LspStartResult> {
  return invoke<LspStartResult>("start_clangd", {
    clangdPath,
    compilerPath,
    compilerStandard,
    compilerArgs,
  });
}

export function stopClangd(): Promise<void> {
  return invoke<void>("stop_clangd");
}

export function lspDidOpen(path: string, text: string, version: number): Promise<void> {
  return invoke<void>("lsp_did_open", { path, text, version });
}

export function lspDidChange(
  path: string,
  version: number,
  changes: readonly LspTextChange[],
): Promise<void> {
  return invoke<void>("lsp_did_change", { path, version, changes });
}

export function lspDidSave(path: string): Promise<void> {
  return invoke<void>("lsp_did_save", { path });
}

export function lspDidClose(path: string): Promise<void> {
  return invoke<void>("lsp_did_close", { path });
}

export function lspCompletion(
  path: string,
  position: LspPosition,
  context: { triggerKind: number; triggerCharacter?: string },
  requestId: number,
): Promise<unknown> {
  return invoke<unknown>("lsp_completion", { path, position, context, requestId });
}

export function lspHover(
  path: string,
  position: LspPosition,
  requestId: number,
): Promise<unknown> {
  return invoke<unknown>("lsp_hover", { path, position, requestId });
}

export function lspDefinition(
  path: string,
  position: LspPosition,
  requestId: number,
): Promise<unknown> {
  return invoke<unknown>("lsp_definition", { path, position, requestId });
}

export function lspSignatureHelp(
  path: string,
  position: LspPosition,
  requestId: number,
): Promise<unknown> {
  return invoke<unknown>("lsp_signature_help", { path, position, requestId });
}

export function lspReferences(
  path: string,
  position: LspPosition,
  requestId: number,
): Promise<unknown> {
  return invoke<unknown>("lsp_references", { path, position, requestId });
}

export function cancelLspRequest(requestId: number): Promise<boolean> {
  return invoke<boolean>("cancel_lsp_request", { requestId });
}
