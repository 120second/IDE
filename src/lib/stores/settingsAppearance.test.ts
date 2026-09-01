import { describe, expect, it, vi } from "vitest";
import { resolveThemePreference } from "../types/settings";
import type { AppSettings, CustomThemeDefinition } from "../types/settings";
import {
  contrastRatio,
  createCustomTheme,
  resolveEditorThemeColors,
  resolveThemeColors,
} from "../theme/themes";
import {
  COLOR_THEMES,
  DEFAULT_SETTINGS,
  EDITOR_FONT_PRESETS,
  EDITOR_LINE_HEIGHTS,
  UI_DENSITIES,
  applyDocumentAppearance,
} from "./settings.svelte";

describe("appearance settings", () => {
  it("offers paired color themes alongside local background controls", () => {
    expect(COLOR_THEMES.map((theme) => theme.id)).toEqual(["signal", "graphite", "forest"]);
    expect(new Set(COLOR_THEMES.map((theme) => theme.label)).size).toBe(COLOR_THEMES.length);
    expect(DEFAULT_SETTINGS.backgroundImage).toBe("");
    expect(DEFAULT_SETTINGS.backgroundFit).toBe("cover");
    expect(DEFAULT_SETTINGS.sidebarOpacity).toBeGreaterThanOrEqual(0.2);
    expect(DEFAULT_SETTINGS.editorOpacity).toBeGreaterThanOrEqual(0.2);
  });

  it("applies surface opacity even when no background image is selected", () => {
    const setProperty = vi.fn();
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        classList: { toggle: vi.fn() },
        style: { setProperty, removeProperty: vi.fn() },
      },
    });

    try {
      applyDocumentAppearance({
        ...DEFAULT_SETTINGS,
        theme: "dark",
        backgroundImage: "",
        sidebarOpacity: 0.42,
        editorOpacity: 0.5,
      });
      expect(setProperty).toHaveBeenCalledWith("--sidebar-opacity-percent", "42%");
      expect(setProperty).toHaveBeenCalledWith("--editor-opacity-percent", "50%");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves system, dark, and light modes deterministically", () => {
    expect(resolveThemePreference("system", true)).toBe("light");
    expect(resolveThemePreference("system", false)).toBe("dark");
    expect(resolveThemePreference("dark", true)).toBe("dark");
    expect(resolveThemePreference("light", false)).toBe("light");
  });

  it("keeps density and editor typography choices bounded", () => {
    expect(UI_DENSITIES.map((density) => density.id)).toEqual(["compact", "standard", "comfortable"]);
    expect(EDITOR_FONT_PRESETS.some((font) => font.value === DEFAULT_SETTINGS.fontFamily)).toBe(true);
    expect(EDITOR_LINE_HEIGHTS.some((option) => option.value === DEFAULT_SETTINGS.lineHeight)).toBe(true);
  });

  it("creates inherited custom themes without copying the full palette", () => {
    const theme = createCustomTheme("forest", "我的主题", ["forest-custom"]);
    expect(theme.id).toBe("forest-custom-2");
    expect(theme.inherits).toBe("forest");
    expect(theme.variants.dark.colors).toEqual({});
    expect(theme.variants.light.syntax).toEqual({});
  });

  it("merges only the active custom theme overrides", () => {
    const custom: CustomThemeDefinition = {
      id: "contest",
      name: "Contest",
      inherits: "graphite",
      variants: {
        dark: { colors: { accent: "#ff3366" }, syntax: { keyword: "#ffcc00" } },
        light: { colors: {}, syntax: {} },
      },
    };
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      colorTheme: "signal",
      activeCustomTheme: custom.id,
      customThemes: [custom],
    };
    expect(resolveThemeColors(settings, "dark").accent).toBe("#ff3366");
    expect(resolveThemeColors(settings, "dark").background).toBe("#0e1014");
    expect(resolveEditorThemeColors(settings, "dark").keyword).toBe("#ffcc00");
  });

  it("calculates readable contrast for theme editor warnings", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 3);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });
});
