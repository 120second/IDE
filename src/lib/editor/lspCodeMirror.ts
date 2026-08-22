import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { lintGutter, type Diagnostic } from "@codemirror/lint";
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  hoverTooltip,
  keymap,
  showTooltip,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import type { LspDiagnostic, LspPosition, LspTextChange } from "../types/lsp";

interface LspExtensionCallbacks {
  templateCompletion: (context: CompletionContext) => Promise<CompletionResult | null>;
  completion: (context: CompletionContext) => Promise<CompletionResult | null>;
  hover: (view: EditorView, position: number) => Promise<Tooltip | null>;
  definition: () => void;
  references: () => void;
  signatureHelp: () => void;
}

const setSignatureTooltipEffect = StateEffect.define<{ position: number; text: string } | null>();
const signatureTooltipField = StateField.define<readonly Tooltip[]>({
  create: () => [],
  update(tooltips, transaction) {
    let next = tooltips.map((tooltip) => ({
      ...tooltip,
      pos: transaction.changes.mapPos(tooltip.pos),
    }));
    for (const effect of transaction.effects) {
      if (!effect.is(setSignatureTooltipEffect)) continue;
      next = effect.value
        ? [createTextTooltip(effect.value.position, effect.value.text, "cm-lsp-signature")]
        : [];
    }
    return next;
  },
  provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
});

export function createLspExtensions(
  callbacks: LspExtensionCallbacks,
  interactive: boolean,
): Extension[] {
  return [
    signatureTooltipField,
    keymap.of([
      { key: "F12", run: () => (callbacks.definition(), true) },
      { key: "Shift-F12", run: () => (callbacks.references(), true) },
      { key: "Ctrl-Shift-Space", run: () => (callbacks.signatureHelp(), true) },
    ]),
    ...(interactive
      ? [
          autocompletion({
            override: [callbacks.templateCompletion, callbacks.completion],
            activateOnTypingDelay: 90,
            maxRenderedOptions: 100,
          }),
          hoverTooltip(callbacks.hover, { hoverTime: 400, hideOnChange: true }),
          lintGutter(),
        ]
      : []),
  ];
}

export function showSignatureTooltip(
  view: EditorView,
  value: { position: number; text: string } | null,
): void {
  view.dispatch({ effects: setSignatureTooltipEffect.of(value) });
}

export function incrementalChange(
  update: Pick<ViewUpdate, "changes" | "startState" | "state">,
): LspTextChange | undefined {
  let fromA = Number.POSITIVE_INFINITY;
  let toA = 0;
  let fromB = Number.POSITIVE_INFINITY;
  let toB = 0;
  update.changes.iterChanges((changeFromA, changeToA, changeFromB, changeToB) => {
    fromA = Math.min(fromA, changeFromA);
    toA = Math.max(toA, changeToA);
    fromB = Math.min(fromB, changeFromB);
    toB = Math.max(toB, changeToB);
  });
  if (!Number.isFinite(fromA) || !Number.isFinite(fromB)) return undefined;
  return {
    range: {
      start: positionAt(update.startState, fromA),
      end: positionAt(update.startState, toA),
    },
    text: update.state.doc.sliceString(fromB, toB),
  };
}

export function positionAt(state: EditorState, offset: number): LspPosition {
  const safeOffset = Math.min(state.doc.length, Math.max(0, offset));
  const line = state.doc.lineAt(safeOffset);
  return { line: line.number - 1, character: safeOffset - line.from };
}

export function offsetAt(state: EditorState, position: LspPosition): number {
  const lineNumber = Math.min(state.doc.lines, Math.max(1, position.line + 1));
  const line = state.doc.line(lineNumber);
  return Math.min(line.to, line.from + Math.max(0, position.character));
}

export function toCodeMirrorDiagnostic(
  state: EditorState,
  diagnostic: LspDiagnostic,
): Diagnostic {
  const from = offsetAt(state, diagnostic.range.start);
  const to = Math.max(from, offsetAt(state, diagnostic.range.end));
  return {
    from,
    to,
    severity: diagnostic.severity === 1
      ? "error"
      : diagnostic.severity === 2
        ? "warning"
        : diagnostic.severity === 4
          ? "hint"
          : "info",
    message: diagnostic.message,
    source: diagnostic.code
      ? `${diagnostic.source || "clangd"} · ${diagnostic.code}`
      : diagnostic.source || "clangd",
  };
}

export function completionType(kind: number): string {
  const types: Record<number, string> = {
    2: "method",
    3: "function",
    4: "function",
    5: "property",
    6: "variable",
    7: "class",
    8: "interface",
    9: "namespace",
    10: "property",
    13: "enum",
    14: "keyword",
    20: "constant",
    21: "constant",
    22: "enum",
    23: "type",
  };
  return types[kind] ?? "text";
}

export function createTextTooltip(
  position: number,
  text: string,
  className: string,
  end?: number,
): Tooltip {
  return {
    pos: position,
    end,
    above: true,
    arrow: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = className;
      dom.textContent = text;
      return { dom };
    },
  };
}
