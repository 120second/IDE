import type { UxStore } from "../stores/ux.svelte";
import type { EditorWorkspace } from "./workspace.svelte";

/**
 * Runs the shared dirty-editor close flow used by tabs, shortcuts and workspace actions.
 * Returns false when the user cancels or any requested save fails.
 */
export async function requestCloseTabs(
  workspace: EditorWorkspace,
  ux: UxStore,
  ids: readonly string[],
): Promise<boolean> {
  const tabs = ids.flatMap((id) => {
    const tab = workspace.tabs.find((candidate) => candidate.id === id);
    return tab ? [tab] : [];
  });
  if (tabs.length === 0) return true;

  const dirty = tabs.filter((tab) => tab.dirty);
  if (dirty.length > 0) {
    const names = dirty.slice(0, 5).map((tab) => `“${tab.title}”`).join("、");
    const remainder = dirty.length > 5 ? ` 等 ${dirty.length} 个文件` : "";
    const choice = await ux.choose({
      title: dirty.length === 1 ? "关闭未保存的文件" : `关闭 ${dirty.length} 个未保存的文件`,
      message: `${names}${remainder}包含未保存的更改。`,
      confirmLabel: "保存并关闭",
      secondaryLabel: "不保存",
      secondaryDanger: true,
    });
    if (choice === "cancel") return false;
    if (choice === "confirm") {
      for (const tab of dirty) {
        if (await workspace.saveTab(tab.id)) continue;
        ux.error(workspace.notice || `无法保存 ${tab.title}，已停止关闭。`);
        return false;
      }
    }
  }

  for (const id of ids) workspace.closeTab(id);
  return true;
}
