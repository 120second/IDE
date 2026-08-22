import { describe, expect, it } from "vitest";
import { APPEARANCE_PRESETS, acrylicColor, backgroundImageCssValue } from "./settings.svelte";

describe("appearance settings", () => {
  it("offers progressively more transparent appearance presets", () => {
    expect(APPEARANCE_PRESETS.balanced.backgroundEffect).toBe("acrylic");
    expect(APPEARANCE_PRESETS.glass.backgroundEffect).toBe("transparent");
    expect(APPEARANCE_PRESETS.glass.backgroundOpacity).toBeGreaterThan(
      APPEARANCE_PRESETS.balanced.backgroundOpacity,
    );
    expect(APPEARANCE_PRESETS.glass.windowOpacity).toBeLessThan(
      APPEARANCE_PRESETS.balanced.windowOpacity,
    );
    expect(APPEARANCE_PRESETS.glass.sidebarOpacity).toBeLessThan(
      APPEARANCE_PRESETS.balanced.sidebarOpacity,
    );
    expect(APPEARANCE_PRESETS.glass.editorOpacity).toBeLessThan(
      APPEARANCE_PRESETS.balanced.editorOpacity,
    );
  });

  it("maps the window tint opacity into an acrylic color", () => {
    expect(acrylicColor({ theme: "dark", windowOpacity: 0.5 })).toEqual([16, 18, 23, 95]);
    expect(acrylicColor({ theme: "light", windowOpacity: 0 })).toEqual([238, 242, 247, 1]);
  });

  it("escapes background URLs before inserting them into CSS", () => {
    expect(backgroundImageCssValue("https://example.com/a\"b.png"))
      .toBe('url("https://example.com/a\\"b.png")');
    expect(backgroundImageCssValue("  ")).toBe("none");
  });
});
