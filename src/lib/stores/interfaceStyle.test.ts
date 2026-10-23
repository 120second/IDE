import { afterEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../api/settings", () => api);
import { DEFAULT_SETTINGS, SettingsStore, applyDocumentAppearance } from "./settings.svelte";
import { effectiveTestcaseStyle } from "../types/settings";
import { editorAppearanceKey } from "../editor/appearance";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("optional classic interface", () => {
  it("defaults old Sublime settings to a readable overall transparency independent of editor opacity", async () => {
    api.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, interfaceStyle: "sublime", sublimeTransparency: undefined, editorOpacity: 0.2 });
    const store = new SettingsStore(); await store.initialize();
    expect(store.value.sublimeTransparency).toBe(0.03);
    const properties = new Map<string,string>();
    vi.stubGlobal("document", { documentElement: { dataset: {}, classList: { toggle: vi.fn() }, style: { setProperty: (key:string,value:string) => properties.set(key,value) } } });
    applyDocumentAppearance(store.value);
    expect(properties.get("--window-opacity-percent")).toBe("97%");
    store.dispose();
  });
  it("persists overall transparency including the fully opaque and transparent endpoints", async () => {
    vi.useFakeTimers();
    api.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, interfaceStyle: "sublime" });
    api.saveSettings.mockImplementation(async settings=>settings);
    const store = new SettingsStore(); await store.initialize();
    store.update({ sublimeTransparency: 0 }); await vi.runAllTimersAsync();
    expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ sublimeTransparency: 0 }));
    store.update({ sublimeTransparency: 1 }); await vi.runAllTimersAsync();
    expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ sublimeTransparency: 1 }));
    const properties = new Map<string,string>();
    vi.stubGlobal("document", { documentElement: { dataset: {}, classList: { toggle: vi.fn() }, style: { setProperty: (key:string,value:string) => properties.set(key,value) } } });
    applyDocumentAppearance(store.value); expect(properties.get("--window-opacity-percent")).toBe("0%");
    applyDocumentAppearance({ ...store.value, sublimeTransparency: 0 }); expect(properties.get("--window-opacity-percent")).toBe("100%");
    applyDocumentAppearance({ ...store.value, interfaceStyle: "classic" }); expect(properties.get("--window-opacity-percent")).toBe("100%");
    store.dispose();
  });
  it("loads older settings into the original interface without changing the editor options", async () => {
    api.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, interfaceStyle: undefined, testcaseStyle: undefined, fontSize: 18, colorTheme: "forest" });
    const store = new SettingsStore(); await store.initialize();
    expect(store.value.interfaceStyle).toBe("lightcp");
    expect(store.value.testcaseStyle).toBe("follow");
    expect(store.value.fontSize).toBe(18);
    expect(store.value.colorTheme).toBe("forest");
  });
  it("persists style choices and restores the independent testcase style", async () => {
    vi.useFakeTimers();
    api.loadSettings.mockResolvedValue(DEFAULT_SETTINGS);
    api.saveSettings.mockImplementation(async (settings) => settings);
    const store = new SettingsStore(); await store.initialize();
    store.update({ interfaceStyle: "classic", testcaseStyle: "standard" });
    await vi.runAllTimersAsync();
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ interfaceStyle: "classic", testcaseStyle: "standard" }));
    expect(effectiveTestcaseStyle(store.value)).toBe("standard");
    store.dispose();
  });
  it("follows the interface until the user selects an explicit testcase style", () => {
    expect(effectiveTestcaseStyle({ interfaceStyle: "classic", testcaseStyle: "follow" })).toBe("compact");
    expect(effectiveTestcaseStyle({ interfaceStyle: "lightcp", testcaseStyle: "follow" })).toBe("standard");
    expect(effectiveTestcaseStyle({ interfaceStyle: "lightcp", testcaseStyle: "compact" })).toBe("compact");
    expect(effectiveTestcaseStyle({ interfaceStyle: "sublime", testcaseStyle: "follow" })).toBe("compact");
  });
  it("restores theme colors when switching back and refreshes the editor extension", () => {
    const properties = new Map<string, string>();
    const root = { dataset: {} as Record<string,string>, classList: { toggle: vi.fn() }, style: { setProperty: (key: string, value: string) => properties.set(key, value) } };
    vi.stubGlobal("document", { documentElement: root });
    const original = { ...DEFAULT_SETTINGS, theme: "dark" as const, colorTheme: "forest" as const };
    applyDocumentAppearance(original); const accent = properties.get("--accent");
    applyDocumentAppearance({ ...original, interfaceStyle: "classic" });
    expect(properties.get("--accent")).toBe("#007acc");
    expect(root.dataset.interfaceStyle).toBe("classic");
    applyDocumentAppearance({ ...original, interfaceStyle: "sublime" });
    expect(properties.get("--accent")).toBe("#a6ad91");
    expect(properties.get("--code-background")).toBe("#242622");
    expect(root.dataset.interfaceStyle).toBe("sublime");
    applyDocumentAppearance(original);
    expect(properties.get("--accent")).toBe(accent);
    expect(root.dataset.interfaceStyle).toBe("lightcp");
    expect(editorAppearanceKey(original)).not.toBe(editorAppearanceKey({ ...original, interfaceStyle: "classic" }));
    expect(editorAppearanceKey(original)).not.toBe(editorAppearanceKey({ ...original, interfaceStyle: "sublime" }));
  });

  it("restores and persists Sublime without changing an independent editor palette", async () => {
    vi.useFakeTimers();
    api.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, interfaceStyle: "sublime", editorTheme: "forest" });
    api.saveSettings.mockImplementation(async (settings) => settings);
    const store = new SettingsStore(); await store.initialize();
    expect(store.value.interfaceStyle).toBe("sublime");
    store.update({ interfaceStyle: "classic" });
    await vi.runAllTimersAsync();
    store.update({ interfaceStyle: "sublime" });
    await vi.runAllTimersAsync();
    expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ interfaceStyle: "sublime", editorTheme: "forest" }));
    store.dispose();
  });
});
