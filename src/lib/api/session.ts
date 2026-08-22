import { invoke } from "@tauri-apps/api/core";

import type { EditorRecoverySnapshot } from "../types/session";

export function loadEditorRecovery(): Promise<EditorRecoverySnapshot | null> {
  return invoke<EditorRecoverySnapshot | null>("load_editor_recovery");
}

export function saveEditorRecovery(snapshot: EditorRecoverySnapshot): Promise<void> {
  return invoke<void>("save_editor_recovery", { snapshot });
}
