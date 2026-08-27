export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";
export type ColorThemeId = "signal" | "graphite" | "forest";
export type UiDensity = "compact" | "standard" | "comfortable";

export interface ThemeColorOverrides {
  background?: string;
  backgroundElevated?: string;
  activityBackground?: string;
  sidebarBackground?: string;
  panelBackground?: string;
  editorBackground?: string;
  tabBackground?: string;
  tabActiveBackground?: string;
  inputBackground?: string;
  surface?: string;
  surfaceRaised?: string;
  surfaceSunken?: string;
  hoverBackground?: string;
  activeBackground?: string;
  textPrimary?: string;
  textSecondary?: string;
  textMuted?: string;
  accent?: string;
  accentStrong?: string;
  accentSoft?: string;
  accentContrast?: string;
  border?: string;
  borderSubtle?: string;
  borderStrong?: string;
  success?: string;
  warning?: string;
  danger?: string;
  focusRing?: string;
}

export type ThemeColorToken = keyof ThemeColorOverrides;

export interface EditorSyntaxOverrides {
  text?: string;
  muted?: string;
  activeLine?: string;
  selection?: string;
  cursor?: string;
  keyword?: string;
  type?: string;
  string?: string;
  number?: string;
  comment?: string;
  function?: string;
  variable?: string;
}

export type EditorSyntaxToken = keyof EditorSyntaxOverrides;

export interface CustomThemeVariant {
  colors: ThemeColorOverrides;
  syntax: EditorSyntaxOverrides;
}

export interface CustomThemeDefinition {
  id: string;
  name: string;
  inherits: ColorThemeId;
  variants: {
    dark: CustomThemeVariant;
    light: CustomThemeVariant;
  };
}

export interface AppSettings {
  theme: ThemePreference;
  colorTheme: ColorThemeId;
  activeCustomTheme: string;
  customThemes: CustomThemeDefinition[];
  uiDensity: UiDensity;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  performanceMode: boolean;
  compilerPath: string;
  gdbPath: string;
  clangdPath: string;
  compilerStandard: string;
  releaseArgs: string[];
  debugArgs: string[];
  runTimeoutMs: number;
  maxOutputBytes: number;
  keybindings: import("../keybindings").KeybindingMap;
}

export type SettingsSaveState = "idle" | "loading" | "saving" | "saved" | "error";

export function resolveThemePreference(
  preference: ThemePreference,
  prefersLight = typeof window !== "undefined"
    && window.matchMedia("(prefers-color-scheme: light)").matches,
): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return prefersLight ? "light" : "dark";
}
