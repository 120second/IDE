import type { ResolvedTheme, ThemeColorOverrides } from "../types/settings";

// Neutral panels and blue controls from the user's classic desktop IDE reference.
// The editor's independently selected syntax palette and background stay separate.
export function classicInterfaceColors(variant: ResolvedTheme): ThemeColorOverrides {
  return variant === "dark" ? {
    background: "#25262b", backgroundElevated: "#2d2e33", activityBackground: "#2e2f34",
    sidebarBackground: "#303137", panelBackground: "#292a2f", tabBackground: "#292a30",
    tabActiveBackground: "#34353c", inputBackground: "#414246", surface: "#303136",
    surfaceRaised: "#424347", surfaceSunken: "#28292d", hoverBackground: "#3c3d45",
    activeBackground: "#3b3d49", textPrimary: "#e4e4e8", textSecondary: "#c0c1c8",
    textMuted: "#9698a1", accent: "#007acc", accentStrong: "#1595e9", accentContrast: "#ffffff",
    accentSoft: "#193d55", border: "#44454c", borderStrong: "#55565e", borderSubtle: "#383940",
    focusRing: "#329cde",
  } : {
    background: "#f3f3f3", backgroundElevated: "#ffffff", activityBackground: "#e8e8eb",
    sidebarBackground: "#eeeeef", panelBackground: "#f6f6f6", tabBackground: "#e7e7eb",
    tabActiveBackground: "#ffffff", inputBackground: "#ffffff", surface: "#f1f1f3",
    surfaceRaised: "#ffffff", surfaceSunken: "#e5e5e9", hoverBackground: "#dedfe5",
    activeBackground: "#d7e9f7", textPrimary: "#292a30", textSecondary: "#50515b",
    textMuted: "#666872", accent: "#0074bd", accentStrong: "#005e9e", accentContrast: "#ffffff",
    accentSoft: "#daeaf7", border: "#ceced5", borderStrong: "#a4a6b0", borderSubtle: "#dddde2",
    focusRing: "#0074bd",
  };
}

export function sublimeInterfaceColors(variant: ResolvedTheme): ThemeColorOverrides {
  return variant === "dark" ? {
    background: "#242622", backgroundElevated: "#30322d", activityBackground: "#20221f",
    sidebarBackground: "#20221f", panelBackground: "#242622", editorBackground: "#242622",
    tabBackground: "#232520", tabActiveBackground: "#34362f", inputBackground: "#30332e",
    surface: "#454841", surfaceRaised: "#62655f", surfaceSunken: "#20221f",
    hoverBackground: "#555950", activeBackground: "#44493b", textPrimary: "#e5e5db",
    textSecondary: "#c9ccc0", textMuted: "#a4a79a", accent: "#a6ad91", accentStrong: "#c7cfac",
    accentContrast: "#22251e", accentSoft: "#3d4333", border: "#363a32", borderStrong: "#5f6558",
    borderSubtle: "#30342d", focusRing: "#bdc5a5",
  } : {
    background: "#eef1f5", backgroundElevated: "#f7f8fa", activityBackground: "#e4e8ed",
    sidebarBackground: "#e7ebf0", panelBackground: "#edf0f4", editorBackground: "#f7f8fa",
    tabBackground: "#e3e8ed", tabActiveBackground: "#f7f8fa", inputBackground: "#ffffff",
    surface: "#eef1f5", surfaceRaised: "#ffffff", surfaceSunken: "#e4e9ef",
    hoverBackground: "#dae2eb", activeBackground: "#d6e1eb", textPrimary: "#303c49",
    textSecondary: "#526171", textMuted: "#627284", accent: "#377c9b", accentStrong: "#246581",
    accentContrast: "#ffffff", accentSoft: "#d6e7ef", border: "#d0d7e0", borderStrong: "#9aaabb",
    borderSubtle: "#dce2e9", focusRing: "#377c9b",
  };
}
