import { describe, expect, it, vi } from "vitest";
import { resolveThemePreference } from "../types/settings";
import { editorAppearanceKey } from "../editor/appearance";
import type { AppSettings, CustomThemeDefinition } from "../types/settings";
import {
  contrastRatio,
  createCustomTheme,
  resolveEditorThemeColors,
  resolveEditorBackground,
  resolveThemeColors,
} from "../theme/themes";
import {
  COLOR_THEMES,
  DEFAULT_SETTINGS,
  EDITOR_FONT_PRESETS,
  EDITOR_LINE_HEIGHTS,
  UI_DENSITIES,
  applyDocumentAppearance,
  SettingsStore,
} from "./settings.svelte";

describe("appearance settings", () => {
  it("keeps an independent editor palette while switching the interface theme", () => {
    const settings = { ...DEFAULT_SETTINGS, editorTheme: "graphite", theme: "dark" as const };
    const expected = resolveEditorThemeColors(settings, "dark");
    expect(resolveEditorThemeColors({ ...settings, colorTheme: "forest" }, "dark")).toEqual(expected);
    expect(resolveEditorBackground(settings, "dark")).toBe(resolveThemeColors({ ...settings, colorTheme: "graphite" }, "dark").editorBackground);
    const custom = createCustomTheme("forest", "独立代码", []);
    custom.variants.dark.syntax.keyword = "#abcdef";
    expect(resolveEditorThemeColors({ ...settings, customThemes: [custom], editorTheme: `custom:${custom.id}` }, "dark").keyword).toBe("#abcdef");
    expect(resolveEditorThemeColors({ ...settings, editorTheme: "inherit", colorTheme: "forest" }, "light"))
      .toEqual(resolveEditorThemeColors({ ...DEFAULT_SETTINGS, colorTheme: "forest" }, "light"));
  });

  it("does not reconfigure the editor for background and opacity changes", () => {
    const settings = { ...DEFAULT_SETTINGS, theme: "dark" as const };
    expect(editorAppearanceKey({ ...settings, panelOpacity: 0.3, editorOpacity: 0.4, backgroundScale: 2 })).toBe(editorAppearanceKey(settings));
    expect(editorAppearanceKey({ ...settings, editorTheme: "graphite" })).not.toBe(editorAppearanceKey(settings));
    expect(editorAppearanceKey({ ...settings, fontSize: 20 })).not.toBe(editorAppearanceKey(settings));
  });

  it("normalizes new controls and resets appearance without touching toolchain settings", () => {
    vi.useFakeTimers();
    try {
      const store = new SettingsStore();
      store.update({ backgroundPositionX: -12, backgroundPositionY: 120, backgroundScale: 9, popupOpacity: 0, panelOpacity: 0.3, editorTheme: "missing", compilerPath: "custom-g++" });
      expect(store.value).toMatchObject({ backgroundPositionX: 0, backgroundPositionY: 100, backgroundScale: 3, popupOpacity: 0.6, panelOpacity: 0.3, editorTheme: "inherit" });
      store.resetAppearance();
      expect(store.value).toMatchObject({ backgroundPositionX: 50, backgroundPositionY: 50, backgroundScale: 1, popupOpacity: 1, panelOpacity: 1, editorTheme: "inherit", compilerPath: "custom-g++" });
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });

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

  it("replaces the full palette when switching away from a custom theme", () => {
    const colors = new Map<string, string>();
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        classList: { toggle: vi.fn() },
        style: { setProperty: (name: string, value: string) => colors.set(name, value) },
      },
    });
    try {
      const custom = createCustomTheme("forest", "自定义", []);
      custom.variants.dark.colors = { accent: "#ff3366", background: "#123456" };
      applyDocumentAppearance({ ...DEFAULT_SETTINGS, theme: "dark", activeCustomTheme: custom.id, customThemes: [custom] });
      expect(colors.get("--accent")).toBe("#ff3366");
      expect(colors.get("--background")).toBe("#123456");

      const settings = { ...DEFAULT_SETTINGS, theme: "light" as const };
      applyDocumentAppearance(settings);
      const expected = resolveThemeColors(settings, "light");
      expect(colors.get("--accent")).toBe(expected.accent);
      expect(colors.get("--background")).toBe(expected.background);
      expect(colors.get("--sidebar-background")).toBe(expected.sidebarBackground);
    } finally {
      vi.unstubAllGlobals();
    }
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
