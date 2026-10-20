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
