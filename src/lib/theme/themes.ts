import type {
  AppSettings,
  ColorThemeId,
  CustomThemeDefinition,
  CustomThemeVariant,
  EditorSyntaxOverrides,
  EditorSyntaxToken,
  ResolvedTheme,
  ThemeColorOverrides,
  ThemeColorToken,
} from "../types/settings";

export type ThemeTokenField<T extends string> = {
  key: T;
  label: string;
  description: string;
  contrastAgainst?: ThemeColorToken;
};

export type ThemeTokenGroup<T extends string> = {
  id: string;
  label: string;
  fields: ReadonlyArray<ThemeTokenField<T>>;
};

export const THEME_COLOR_GROUPS: ReadonlyArray<ThemeTokenGroup<ThemeColorToken>> = [
  {
    id: "surfaces",
    label: "工作台表面",
    fields: [
      { key: "background", label: "窗口底色", description: "工作台最底层背景" },
      { key: "editorBackground", label: "编辑区", description: "代码编辑器和欢迎页背景" },
      { key: "sidebarBackground", label: "侧栏", description: "资源管理器、设置和测试点侧栏" },
      { key: "panelBackground", label: "底部面板", description: "输出、问题和调试面板" },
      { key: "activityBackground", label: "活动栏", description: "最左侧功能导航" },
      { key: "backgroundElevated", label: "抬升表面", description: "工具栏与较高层级区域" },
      { key: "surface", label: "普通表面", description: "卡片和分组容器" },
      { key: "surfaceRaised", label: "强调表面", description: "选中项和悬浮区域" },
      { key: "surfaceSunken", label: "下沉表面", description: "输入区和内嵌区域" },
      { key: "inputBackground", label: "输入框", description: "文本框、选择框背景" },
      { key: "tabBackground", label: "标签栏", description: "未激活标签背景" },
      { key: "tabActiveBackground", label: "活动标签", description: "当前文件标签背景" },
    ],
  },
  {
    id: "content",
    label: "文字与边界",
    fields: [
      { key: "textPrimary", label: "主要文字", description: "标题和主要内容", contrastAgainst: "editorBackground" },
      { key: "textSecondary", label: "次要文字", description: "说明和普通标签", contrastAgainst: "editorBackground" },
      { key: "textMuted", label: "弱化文字", description: "提示、占位和非活动内容", contrastAgainst: "editorBackground" },
      { key: "border", label: "普通边界", description: "面板和控件分隔线" },
      { key: "borderSubtle", label: "弱边界", description: "列表与内容内部细分隔" },
      { key: "borderStrong", label: "强调边界", description: "焦点附近和重要区域边界" },
    ],
  },
  {
    id: "interaction",
    label: "交互与状态",
    fields: [
      { key: "accent", label: "强调色", description: "主要按钮、选中和活动标记" },
      { key: "accentStrong", label: "强调文字", description: "强调色上的高辨识内容", contrastAgainst: "background" },
      { key: "accentContrast", label: "强调色反差文字", description: "主要按钮内的文字", contrastAgainst: "accent" },
      { key: "accentSoft", label: "弱强调背景", description: "选中卡片和柔和状态层" },
      { key: "hoverBackground", label: "悬浮背景", description: "鼠标经过控件时的状态层" },
      { key: "activeBackground", label: "活动背景", description: "当前项和按下状态" },
      { key: "focusRing", label: "焦点环", description: "键盘焦点的外圈提示" },
      { key: "success", label: "成功", description: "通过、已保存和可用状态", contrastAgainst: "background" },
      { key: "warning", label: "警告", description: "需要注意但可继续的状态", contrastAgainst: "background" },
      { key: "danger", label: "错误", description: "失败、删除和阻断状态", contrastAgainst: "background" },
    ],
  },
];

export const SYNTAX_COLOR_GROUPS: ReadonlyArray<ThemeTokenGroup<EditorSyntaxToken>> = [
  {
    id: "editor",
    label: "编辑器基础",
    fields: [
      { key: "text", label: "代码正文", description: "默认代码文字" },
      { key: "muted", label: "行号", description: "行号和弱化编辑器内容" },
      { key: "cursor", label: "光标", description: "输入光标颜色" },
      { key: "selection", label: "选区", description: "已选择代码的背景" },
      { key: "activeLine", label: "当前行", description: "光标所在行背景" },
    ],
  },
  {
    id: "syntax",
    label: "C++ 语法",
    fields: [
      { key: "keyword", label: "关键字", description: "if、for、return 和预处理指令" },
      { key: "type", label: "类型", description: "类型名、类和命名空间" },
      { key: "function", label: "函数", description: "函数名和定义" },
      { key: "string", label: "字符串", description: "字符串和字符字面量" },
      { key: "number", label: "数字", description: "数字、布尔和空值" },
      { key: "comment", label: "注释", description: "行注释和块注释" },
      { key: "variable", label: "变量", description: "变量和属性名称" },
    ],
  },
];

export const THEME_CSS_VARIABLES: Record<ThemeColorToken, string> = {
  background: "--background",
  backgroundElevated: "--background-elevated",
  activityBackground: "--activity-background",
  sidebarBackground: "--sidebar-background",
  panelBackground: "--panel-background",
  editorBackground: "--editor-background",
  tabBackground: "--tab-background",
  tabActiveBackground: "--tab-active-background",
  inputBackground: "--input-background",
  surface: "--surface",
  surfaceRaised: "--surface-raised",
  surfaceSunken: "--surface-sunken",
  hoverBackground: "--hover-background",
  activeBackground: "--active-background",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textMuted: "--text-muted",
  accent: "--accent",
  accentStrong: "--accent-strong",
  accentSoft: "--accent-soft",
  accentContrast: "--accent-contrast",
  border: "--border",
  borderSubtle: "--border-subtle",
  borderStrong: "--border-strong",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
  focusRing: "--focus-ring",
};

const UI_THEME_COLORS: Record<ColorThemeId, Record<ResolvedTheme, Required<ThemeColorOverrides>>> = {
  signal: {
    dark: {
      background: "#0a0e13", backgroundElevated: "#111720", activityBackground: "#090d12",
      sidebarBackground: "#0f151d", panelBackground: "#0d131b", editorBackground: "#0c1118",
      tabBackground: "#0d131b", tabActiveBackground: "#121a24", inputBackground: "#090f16",
      surface: "#121923", surfaceRaised: "#17202b", surfaceSunken: "#080d13",
      hoverBackground: "#79a0d314", activeBackground: "#4c8de826", textPrimary: "#e5ebf4",
      textSecondary: "#a4afbf", textMuted: "#7d8c9f", accent: "#4c8de8",
      accentStrong: "#70a8f2", accentSoft: "#4c8de824", accentContrast: "#06101d",
      border: "#202a36", borderSubtle: "#18212c", borderStrong: "#344150",
      success: "#49c58a", warning: "#dda84f", danger: "#ec6874", focusRing: "#70a8f261",
    },
    light: {
      background: "#e9edf2", backgroundElevated: "#f8fafc", activityBackground: "#e4e9ef",
      sidebarBackground: "#f1f4f7", panelBackground: "#f5f7fa", editorBackground: "#fcfdff",
      tabBackground: "#e9edf2", tabActiveBackground: "#fcfdff", inputBackground: "#ffffff",
      surface: "#f7f9fb", surfaceRaised: "#ffffff", surfaceSunken: "#e9edf2",
      hoverBackground: "#294c7412", activeBackground: "#2d6fca21", textPrimary: "#1e2732",
      textSecondary: "#526174", textMuted: "#5d6c80", accent: "#2f72cf",
      accentStrong: "#1f63bd", accentSoft: "#2f72cf1f", accentContrast: "#ffffff",
      border: "#ccd4de", borderSubtle: "#dce2e9", borderStrong: "#aeb9c6",
      success: "#1f8b58", warning: "#9b6511", danger: "#c94250", focusRing: "#2f72cf42",
    },
  },
  graphite: {
    dark: {
      background: "#0e1014", backgroundElevated: "#151820", activityBackground: "#0b0d11",
      sidebarBackground: "#12151b", panelBackground: "#11141a", editorBackground: "#101217",
      tabBackground: "#11141a", tabActiveBackground: "#171a22", inputBackground: "#0c0e13",
      surface: "#171a22", surfaceRaised: "#1d212b", surfaceSunken: "#0a0c10",
      hoverBackground: "#a0acd614", activeBackground: "#8b9ff024", textPrimary: "#e4e6ec",
      textSecondary: "#adb2bf", textMuted: "#858c9b", accent: "#8b9ff0",
      accentStrong: "#adbbff", accentSoft: "#8b9ff024", accentContrast: "#0c1020",
      border: "#292d37", borderSubtle: "#20232c", borderStrong: "#3d4350",
      success: "#49c58a", warning: "#dda84f", danger: "#ec6874", focusRing: "#adbbff57",
    },
    light: {
      background: "#eceef2", backgroundElevated: "#f8f8fa", activityBackground: "#e6e8ed",
      sidebarBackground: "#f1f2f5", panelBackground: "#f6f6f8", editorBackground: "#fcfcfd",
      tabBackground: "#e9ebef", tabActiveBackground: "#fcfcfd", inputBackground: "#ffffff",
      surface: "#f5f5f7", surfaceRaised: "#ffffff", surfaceSunken: "#e8eaee",
      hoverBackground: "#484c6812", activeBackground: "#5b65b81f", textPrimary: "#282a31",
      textSecondary: "#555a67", textMuted: "#606775", accent: "#5b65b8",
      accentStrong: "#4c56a8", accentSoft: "#5b65b81f", accentContrast: "#ffffff",
      border: "#cfd2da", borderSubtle: "#dee0e6", borderStrong: "#afb4c0",
      success: "#1f8b58", warning: "#9b6511", danger: "#c94250", focusRing: "#5b65b840",
    },
  },
  forest: {
    dark: {
      background: "#08100e", backgroundElevated: "#101a17", activityBackground: "#070d0c",
      sidebarBackground: "#0d1714", panelBackground: "#0c1613", editorBackground: "#09120f",
      tabBackground: "#0c1613", tabActiveBackground: "#12201b", inputBackground: "#070e0c",
      surface: "#12201b", surfaceRaised: "#182923", surfaceSunken: "#060c0a",
      hoverBackground: "#71b7a214", activeBackground: "#4fc1a324", textPrimary: "#dcebe6",
      textSecondary: "#a4b9b1", textMuted: "#799087", accent: "#4fc1a3",
      accentStrong: "#70d6bb", accentSoft: "#4fc1a324", accentContrast: "#04130f",
      border: "#1e302a", borderSubtle: "#172620", borderStrong: "#355047",
      success: "#49c58a", warning: "#dda84f", danger: "#ec6874", focusRing: "#70d6bb52",
    },
    light: {
      background: "#eaf1ee", backgroundElevated: "#f7faf8", activityBackground: "#e2ebe7",
      sidebarBackground: "#eff5f2", panelBackground: "#f4f8f6", editorBackground: "#fbfdfc",
      tabBackground: "#e8efec", tabActiveBackground: "#fbfdfc", inputBackground: "#ffffff",
      surface: "#f4f8f6", surfaceRaised: "#ffffff", surfaceSunken: "#e4ede9",
      hoverBackground: "#205b4b12", activeBackground: "#247d691f", textPrimary: "#20302b",
      textSecondary: "#4b625a", textMuted: "#566e65", accent: "#247d69",
      accentStrong: "#196c59", accentSoft: "#247d691f", accentContrast: "#ffffff",
      border: "#c8d7d1", borderSubtle: "#d8e3df", borderStrong: "#a8beb6",
      success: "#1f8b58", warning: "#9b6511", danger: "#c94250", focusRing: "#247d6940",
    },
  },
};

const EDITOR_THEME_COLORS: Record<ColorThemeId, Record<ResolvedTheme, Required<EditorSyntaxOverrides>>> = {
  signal: {
    dark: { text: "#d9dde7", muted: "#727b8c", activeLine: "#679beb14", selection: "#4e85d14d", cursor: "#82b7ff", keyword: "#c78bdf", type: "#68c8c0", string: "#d7a86e", number: "#75b7e8", comment: "#7d8d7a", function: "#82aef2", variable: "#d9dde7" },
    light: { text: "#20242c", muted: "#6d7583", activeLine: "#3b82f613", selection: "#3774cd38", cursor: "#2563eb", keyword: "#8b3fc7", type: "#096f78", string: "#9b4b12", number: "#2266a8", comment: "#687866", function: "#2459a5", variable: "#20242c" },
  },
  graphite: {
    dark: { text: "#e4e5ea", muted: "#7f8592", activeLine: "#8b9ff012", selection: "#8b9ff042", cursor: "#a5b4fc", keyword: "#c4a7e7", type: "#8bd5ca", string: "#e7b978", number: "#91d7e3", comment: "#858ca0", function: "#9aaef4", variable: "#e4e5ea" },
    light: { text: "#282a31", muted: "#686c78", activeLine: "#5b65b812", selection: "#5b65b833", cursor: "#5b65b8", keyword: "#7357a6", type: "#247f82", string: "#916120", number: "#3e69a5", comment: "#6f786d", function: "#4d5ea8", variable: "#282a31" },
  },
  forest: {
    dark: { text: "#dcebe6", muted: "#789087", activeLine: "#4fc1a312", selection: "#4fc1a33d", cursor: "#70d6bb", keyword: "#c99be5", type: "#63c7ad", string: "#e0ad65", number: "#79b9e8", comment: "#7f9588", function: "#83b6dd", variable: "#dcebe6" },
    light: { text: "#20302b", muted: "#61766e", activeLine: "#247d6913", selection: "#247d6933", cursor: "#247d69", keyword: "#76509b", type: "#1f7868", string: "#8d5b20", number: "#306b9a", comment: "#667a65", function: "#356f91", variable: "#20302b" },
  },
};

export const EMPTY_THEME_VARIANT = (): CustomThemeVariant => ({ colors: {}, syntax: {} });

export function getActiveCustomTheme(settings: Pick<AppSettings, "activeCustomTheme" | "customThemes">): CustomThemeDefinition | undefined {
  return settings.customThemes.find((theme) => theme.id === settings.activeCustomTheme);
}

export function getEffectiveBaseTheme(settings: Pick<AppSettings, "activeCustomTheme" | "colorTheme" | "customThemes">): ColorThemeId {
  return getActiveCustomTheme(settings)?.inherits ?? settings.colorTheme;
}

export function resolveThemeColors(settings: Pick<AppSettings, "activeCustomTheme" | "colorTheme" | "customThemes">, variant: ResolvedTheme): Required<ThemeColorOverrides> {
  const custom = getActiveCustomTheme(settings);
  const base = custom?.inherits ?? settings.colorTheme;
  return { ...UI_THEME_COLORS[base][variant], ...(custom?.variants[variant].colors ?? {}) };
}

export function resolveEditorThemeColors(settings: Pick<AppSettings, "activeCustomTheme" | "colorTheme" | "customThemes">, variant: ResolvedTheme): Required<EditorSyntaxOverrides> {
  const custom = getActiveCustomTheme(settings);
  const base = custom?.inherits ?? settings.colorTheme;
  return { ...EDITOR_THEME_COLORS[base][variant], ...(custom?.variants[variant].syntax ?? {}) };
}

export function createCustomTheme(base: ColorThemeId, name: string, existingIds: Iterable<string>): CustomThemeDefinition {
  const ids = new Set(existingIds);
  const stem = `${base}-custom`;
  let suffix = 1;
  let id = stem;
  while (ids.has(id)) id = `${stem}-${++suffix}`;
  return {
    id,
    name: name.trim().slice(0, 48) || "自定义主题",
    inherits: base,
    variants: { dark: EMPTY_THEME_VARIANT(), light: EMPTY_THEME_VARIANT() },
  };
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) && [4, 5, 7, 9].includes(value.length);
}

export function opaqueColor(value: string): string {
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7);
  if (/^#[0-9a-f]{4}$/i.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  return value;
}

export function contrastRatio(foreground: string, background: string): number | undefined {
  const foregroundRgb = compositeColor(foreground, background);
  const backgroundRgb = compositeColor(background, "#ffffff");
  if (!foregroundRgb || !backgroundRgb) return undefined;
  const foregroundLuminance = relativeLuminance(foregroundRgb);
  const backgroundLuminance = relativeLuminance(backgroundRgb);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function compositeColor(value: string, background: string): [number, number, number] | undefined {
  const foreground = parseHexColor(value);
  const backdrop = parseHexColor(background);
  if (!foreground || !backdrop) return undefined;
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + backdrop[0] * (1 - alpha),
    foreground[1] * alpha + backdrop[1] * (1 - alpha),
    foreground[2] * alpha + backdrop[2] * (1 - alpha),
  ];
}

function parseHexColor(value: string): [number, number, number, number] | undefined {
  if (!isThemeColor(value)) return undefined;
  let hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((character) => character.repeat(2)).join("");
  if (hex.length === 6) hex += "ff";
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    Number.parseInt(hex.slice(6, 8), 16) / 255,
  ];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const [r, g, b] = [red, green, blue]
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
