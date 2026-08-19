export type ShortcutId =
  | "quickArchive"
  | "quickTemplate"
  | "toggleSidebar"
  | "togglePanel"
  | "save"
  | "runCurrent"
  | "runAll";

interface Shortcut {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export const SHORTCUTS: Record<ShortcutId, Shortcut> = {
  quickArchive: { key: "a", ctrl: true, shift: true },
  quickTemplate: { key: "t", ctrl: true, alt: true },
  toggleSidebar: { key: "b", ctrl: true },
  togglePanel: { key: "j", ctrl: true },
  save: { key: "s", ctrl: true },
  runCurrent: { key: "F5" },
  runAll: { key: "F6" },
};

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  const shortcut = SHORTCUTS[id];
  return event.key.toLowerCase() === shortcut.key.toLowerCase()
    && event.ctrlKey === Boolean(shortcut.ctrl)
    && event.altKey === Boolean(shortcut.alt)
    && event.shiftKey === Boolean(shortcut.shift)
    && !event.metaKey;
}
