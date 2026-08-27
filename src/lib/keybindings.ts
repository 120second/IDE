export type ShortcutId =
  | "quickArchive"
  | "quickTemplate"
  | "toggleSidebar"
  | "togglePanel"
  | "save"
  | "newFile"
  | "quickOpen"
  | "commandPalette"
  | "closeEditor"
  | "nextEditor"
  | "previousEditor"
  | "runCurrent"
  | "runAll"
  | "stress"
  | "debug";

export type KeybindingMap = Record<ShortcutId, string>;

interface Shortcut {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

const NAMED_KEYS = [
  "Space",
  "Enter",
  "Escape",
  "Tab",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;

export const DEFAULT_KEYBINDINGS: KeybindingMap = {
  save: "Ctrl+S",
  newFile: "Ctrl+N",
  quickOpen: "Ctrl+P",
  commandPalette: "Ctrl+Shift+P",
  closeEditor: "Ctrl+W",
  nextEditor: "Ctrl+Tab",
  previousEditor: "Ctrl+Shift+Tab",
  toggleSidebar: "Ctrl+B",
  quickTemplate: "Ctrl+Alt+T",
  quickArchive: "Ctrl+Shift+A",
  runCurrent: "F5",
  runAll: "F6",
  stress: "F7",
  debug: "F8",
  togglePanel: "Ctrl+J",
};

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  save: "保存",
  newFile: "新建 C++ 文件",
  quickOpen: "快速打开文件",
  commandPalette: "显示命令面板",
  closeEditor: "关闭当前编辑器",
  nextEditor: "下一个编辑器",
  previousEditor: "上一个编辑器",
  toggleSidebar: "切换侧栏",
  quickTemplate: "搜索模板",
  quickArchive: "快速归档",
  runCurrent: "运行当前文件",
  runAll: "运行全部测试点",
  stress: "开始对拍",
  debug: "开始调试",
  togglePanel: "切换底部面板",
};

export const SHORTCUT_IDS = Object.keys(DEFAULT_KEYBINDINGS) as ShortcutId[];

export function normalizeKeybindings(value: unknown): KeybindingMap {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(SHORTCUT_IDS.map((id) => {
    const parsed = parseShortcut(String(input[id] ?? ""));
    return [id, parsed ? formatShortcut(parsed) : DEFAULT_KEYBINDINGS[id]];
  })) as KeybindingMap;
}

export function shortcutFromEvent(event: KeyboardEvent): string | undefined {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key) || event.metaKey) return undefined;
  const shortcut: Shortcut = {
    key: normalizeKey(event.key),
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
  if (!isShortcutKey(shortcut.key)) return undefined;
  if (!isFunctionKey(shortcut.key) && shortcut.key.length === 1 && !shortcut.ctrl && !shortcut.alt) {
    return undefined;
  }
  return formatShortcut(shortcut);
}

export function matchesShortcut(
  event: KeyboardEvent,
  id: ShortcutId,
  keybindings: KeybindingMap = DEFAULT_KEYBINDINGS,
): boolean {
  const shortcut = parseShortcut(keybindings[id]) ?? parseShortcut(DEFAULT_KEYBINDINGS[id]);
  if (!shortcut) return false;
  return normalizeKey(event.key).toLowerCase() === shortcut.key.toLowerCase()
    && event.ctrlKey === shortcut.ctrl
    && event.altKey === shortcut.alt
    && event.shiftKey === shortcut.shift
    && !event.metaKey;
}

export function shortcutConflicts(keybindings: KeybindingMap): Map<ShortcutId, ShortcutId[]> {
  const groups = new Map<string, ShortcutId[]>();
  for (const id of SHORTCUT_IDS) {
    const value = keybindings[id].toLowerCase();
    groups.set(value, [...(groups.get(value) ?? []), id]);
  }
  const result = new Map<ShortcutId, ShortcutId[]>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) result.set(id, ids.filter((candidate) => candidate !== id));
  }
  return result;
}

function parseShortcut(value: string): Shortcut | undefined {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const key = normalizeKey(parts.at(-1) ?? "");
  if (!key || ["Control", "Alt", "Shift", "Meta"].includes(key)) return undefined;
  if (!isShortcutKey(key)) return undefined;
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  if ([...modifiers].some((part) => !["ctrl", "control", "alt", "shift"].includes(part))) {
    return undefined;
  }
  const shortcut = {
    key,
    ctrl: modifiers.has("ctrl") || modifiers.has("control"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift"),
  };
  if (!isFunctionKey(key) && key.length === 1 && !shortcut.ctrl && !shortcut.alt) return undefined;
  return shortcut;
}

function formatShortcut(shortcut: Shortcut): string {
  return [
    shortcut.ctrl ? "Ctrl" : "",
    shortcut.alt ? "Alt" : "",
    shortcut.shift ? "Shift" : "",
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ].filter(Boolean).join("+");
}

function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  const namedKey = NAMED_KEYS.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  if (namedKey) return namedKey;
  return key.length === 1 ? key.toUpperCase() : key;
}

function isFunctionKey(key: string): boolean {
  return /^F(?:[1-9]|1\d|2[0-4])$/i.test(key);
}

function isShortcutKey(key: string): boolean {
  return key.length === 1 || isFunctionKey(key) || NAMED_KEYS.includes(key as typeof NAMED_KEYS[number]);
}
