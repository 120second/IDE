import { afterEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("../api/settings", () => api);
import { DEFAULT_SETTINGS, SettingsStore, applyDocumentAppearance } from "./settings.svelte";
import { effectiveTestcaseStyle } from "../types/settings";
import { editorAppearanceKey } from "../editor/appearance";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("optional classic interface", () => {
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
    applyDocumentAppearance(original);
    expect(properties.get("--accent")).toBe(accent);
    expect(root.dataset.interfaceStyle).toBe("lightcp");
    expect(editorAppearanceKey(original)).not.toBe(editorAppearanceKey({ ...original, interfaceStyle: "classic" }));
  });
});
