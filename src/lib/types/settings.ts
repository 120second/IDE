export type ThemePreference = "dark" | "light";

export interface AppSettings {
  theme: ThemePreference;
  backgroundImage: string;
  backgroundOpacity: number;
  sidebarOpacity: number;
  editorOpacity: number;
  blur: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  performanceMode: boolean;
  compilerPath: string;
  gdbPath: string;
  compilerStandard: string;
  releaseArgs: string[];
  debugArgs: string[];
  runTimeoutMs: number;
  maxOutputBytes: number;
}

export type SettingsSaveState = "idle" | "loading" | "saving" | "saved" | "error";
