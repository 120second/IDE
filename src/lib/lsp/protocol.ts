import type {
  LspCompletionItem,
  LspLocation,
  LspRange,
  LspSignatureHelp,
  LspTextEdit,
} from "../types/lsp";

const COMPLETION_LIMIT = 500;
const LOCATION_LIMIT = 2_000;

export function parseCompletionResponse(value: unknown): LspCompletionItem[] {
  const result = record(value);
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(result?.items)
      ? result.items
      : [];
  return rawItems.slice(0, COMPLETION_LIMIT).flatMap((raw) => {
    const item = record(raw);
    const label = text(item?.label);
    if (!item || !label) return [];
    const textEdit = parseTextEdit(item.textEdit);
    return [{
      label,
      detail: text(item.detail),
      documentation: markupText(item.documentation),
      kind: number(item.kind),
      insertText: textEdit?.newText || text(item.insertText) || label,
      sortText: text(item.sortText),
      filterText: text(item.filterText) || label,
      textEdit,
    }];
  });
}

export function parseHoverResponse(value: unknown): string {
  const hover = record(value);
  return markupText(hover?.contents).slice(0, 16_000);
}

export function parseLocationResponse(value: unknown): LspLocation[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.slice(0, LOCATION_LIMIT).flatMap((raw) => {
    const location = record(raw);
    if (!location) return [];
    const uri = text(location.uri) || text(location.targetUri);
    const range = parseRange(location.range ?? location.targetSelectionRange ?? location.targetRange);
    const path = fileUriToPath(uri);
    return path && range ? [{ path, range }] : [];
  });
}

export function parseSignatureResponse(value: unknown): LspSignatureHelp | undefined {
  const help = record(value);
  const signatures = Array.isArray(help?.signatures) ? help.signatures : [];
  if (!help || signatures.length === 0) return undefined;
  const activeSignature = Math.min(
    Math.max(0, number(help.activeSignature)),
    signatures.length - 1,
  );
  const signature = record(signatures[activeSignature]);
  if (!signature) return undefined;
  return {
    label: text(signature.label).slice(0, 4_000),
    documentation: markupText(signature.documentation).slice(0, 8_000),
    activeParameter: Math.max(0, number(help.activeParameter ?? signature.activeParameter)),
  };
}

export function fileUriToPath(uri: string): string {
  if (!uri) return "";
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return "";
    let path = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    if (parsed.host) path = `//${parsed.host}${path}`;
    return typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("win")
      ? path.replaceAll("/", "\\")
      : path;
  } catch {
    return "";
  }
}

function parseTextEdit(value: unknown): LspTextEdit | undefined {
  const edit = record(value);
  if (!edit) return undefined;
  const range = parseRange(edit.range ?? record(edit.insert)?.range ?? edit.insert);
  const newText = text(edit.newText);
  return range ? { range, newText } : undefined;
}

function parseRange(value: unknown): LspRange | undefined {
  const range = record(value);
  const start = record(range?.start);
  const end = record(range?.end);
  if (!range || !start || !end) return undefined;
  return {
    start: { line: Math.max(0, number(start.line)), character: Math.max(0, number(start.character)) },
    end: { line: Math.max(0, number(end.line)), character: Math.max(0, number(end.character)) },
  };
}

function markupText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(markupText).filter(Boolean).join("\n\n");
  const object = record(value);
  return text(object?.value) || text(object?.language);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  const label = record(value)?.label;
  return typeof label === "string" ? label : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}
