export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspTextChange {
  range: LspRange;
  text: string;
}

export interface LspDiagnostic {
  fileLevel?: boolean;
  path: string;
  range: LspRange;
  severity: number;
  message: string;
  source: string;
  code: string;
}

export interface LspLocation {
  path: string;
  range: LspRange;
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspCompletionItem {
  label: string;
  detail: string;
  documentation: string;
  kind: number;
  insertText: string;
  sortText: string;
  filterText: string;
  textEdit?: LspTextEdit;
}

export interface LspSignatureHelp {
  label: string;
  documentation: string;
  activeParameter: number;
}

export interface LspStartResult {
  sessionId?: string;
  executable: string;
  serverName: string;
  serverVersion: string;
}

export type LspConnectionState =
  | "idle"
  | "starting"
  | "ready"
  | "unavailable"
  | "crashed";

export type LspEvent =
  | { type: "state"; state: LspConnectionState; message: string; sessionId?: string }
  | {
      type: "diagnostics";
      sessionId?: string;
      path: string;
      version?: number;
      diagnostics: Omit<LspDiagnostic, "path">[];
    };
