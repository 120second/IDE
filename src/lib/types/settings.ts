export type ThemePreference = "dark" | "light";
export type WindowBackgroundEffect = "transparent" | "acrylic";

export interface AppSettings {
  theme: ThemePreference;
  backgroundImage: string;
  backgroundOpacity: number;
  backgroundEffect: WindowBackgroundEffect;
  windowOpacity: number;
  sidebarOpacity: number;
  editorOpacity: number;
  blur: number;
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
