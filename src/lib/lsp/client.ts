import type {
  LspCompletionItem,
  LspDiagnostic,
  LspLocation,
  LspPosition,
  LspSignatureHelp,
  LspTextChange,
} from "../types/lsp";

export interface LspCompletionContext {
  triggerKind: 1 | 2 | 3;
  triggerCharacter?: string;
}

export interface LspClient {
  readonly ready: boolean;
  didOpen(path: string, text: string): void;
  didChange(path: string, changes: readonly LspTextChange[]): void;
  didSave(path: string): void;
  didClose(path: string): void;
  completion(
    path: string,
    position: LspPosition,
    context: LspCompletionContext,
    signal: AbortSignal,
  ): Promise<LspCompletionItem[]>;
  hover(path: string, position: LspPosition): Promise<string>;
  definition(path: string, position: LspPosition): Promise<LspLocation[]>;
  signatureHelp(path: string, position: LspPosition): Promise<LspSignatureHelp | undefined>;
  references(path: string, position: LspPosition): Promise<LspLocation[]>;
  revealReferences(locations: LspLocation[]): void;
  diagnosticsFor(path: string): readonly LspDiagnostic[];
}

