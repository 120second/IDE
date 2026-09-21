import { insertNewlineAndIndent } from "@codemirror/commands";
import type { KeyBinding } from "@codemirror/view";

export function templateReferencePrimaryKeymap(insertDraft: () => boolean): KeyBinding[] {
  return [
    { key: "Shift-Enter", run: insertDraft },
    { key: "Enter", run: insertNewlineAndIndent },
  ];
}
