import type { LineEnding } from "../editor/lineEndings";

export interface EditorRecoverySelection {
  anchor: number;
  head: number;
}

export interface EditorRecoveryTab {
  id: string;
  title: string;
  path?: string;
  dirty: boolean;
  deleted: boolean;
  externalModified: boolean;
  diskRevision?: string;
  externalRevision?: string;
  eol: LineEnding;
  content?: string;
  selection: EditorRecoverySelection;
  scrollTop: number;
}

export interface EditorRecoverySnapshot {
  version: 1;
  workspacePath?: string;
  activeTabId?: string;
  tabs: EditorRecoveryTab[];
}
