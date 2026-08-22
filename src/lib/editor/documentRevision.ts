import { invertedEffects } from "@codemirror/commands";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";

let nextRevision = 1;

const restoreDocumentRevision = StateEffect.define<number>();

const documentRevisionField = StateField.define<number>({
  create: () => nextRevision++,
  update(revision, transaction) {
    let restored: number | undefined;
    for (const effect of transaction.effects) {
      if (effect.is(restoreDocumentRevision)) restored = effect.value;
    }
    if (restored !== undefined) return restored;
    return transaction.docChanged ? nextRevision++ : revision;
  },
});

export const documentRevisionExtension: Extension = [
  documentRevisionField,
  invertedEffects.of((transaction) =>
    transaction.docChanged
      ? [restoreDocumentRevision.of(transaction.startState.field(documentRevisionField))]
      : []
  ),
];

export function documentRevision(state: EditorState): number {
  return state.field(documentRevisionField);
}
