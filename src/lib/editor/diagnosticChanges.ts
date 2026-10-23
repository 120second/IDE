import type { LspDiagnostic, LspPosition, LspTextChange } from "../types/lsp";

const compare = (a: LspPosition, b: LspPosition) => a.line - b.line || a.character - b.character;

// Changes arrive in LSP application order. A touched diagnostic no longer
// describes the edited token; other diagnostics must follow their text.
export function mapDiagnosticChanges(diagnostics: readonly LspDiagnostic[], changes: readonly LspTextChange[]): LspDiagnostic[] {
  let mapped = [...diagnostics];
  for (const change of changes) {
    const { start, end } = change.range;
    const lines = change.text.split(/\r\n|\r|\n/);
    const insertedEnd = { line: start.line + lines.length - 1,
      character: lines.length === 1 ? start.character + lines[0].length : lines.at(-1)!.length };
    const shift = (position: LspPosition): LspPosition => compare(position, end) < 0 ? position : {
      line: position.line + insertedEnd.line - end.line,
      character: position.line === end.line ? insertedEnd.character + position.character - end.character : position.character,
    };
    mapped = mapped.flatMap((diagnostic) => {
      if (compare(start, diagnostic.range.end) <= 0 && compare(end, diagnostic.range.start) >= 0) return [];
      return [{ ...diagnostic, range: { start: shift(diagnostic.range.start), end: shift(diagnostic.range.end) } }];
    });
  }
  return mapped;
}
