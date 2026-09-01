import { describe, expect, it } from "vitest";
import { ShellStore } from "./shell.svelte";

describe("settings navigation", () => {
  it("opens and closes settings without changing the active workspace", () => {
    const shell = new ShellStore();
    shell.activeActivity = "templates";
    shell.sidebarVisible = false;
    shell.bottomPanelVisible = true;
    shell.activeBottomPanel = "tests";

    expect(shell.openSettings()).toBe(true);
    expect(shell.settingsWindowOpen).toBe(true);
    expect(shell.activeActivity).toBe("templates");
    expect(shell.sidebarVisible).toBe(false);
    expect(shell.bottomPanelVisible).toBe(true);
    expect(shell.activeBottomPanel).toBe("tests");
    expect(shell.settingsPage).toBe("theme");

    shell.openSettings("background");
    expect(shell.settingsPage).toBe("background");
    expect(shell.activeActivity).toBe("templates");

    shell.openSettings("interface");
    expect(shell.settingsPage).toBe("interface");

    shell.closeSettingsWindow();
    expect(shell.settingsWindowOpen).toBe(false);
    expect(shell.activeActivity).toBe("templates");
    expect(shell.sidebarVisible).toBe(false);
    expect(shell.bottomPanelVisible).toBe(true);
    expect(shell.activeBottomPanel).toBe("tests");
  });

  it("returns from the theme studio to the theme board", () => {
    const shell = new ShellStore();
    shell.activeActivity = "explorer";

    shell.openThemeStudio();
    expect(shell.themeStudioOpen).toBe(true);
    expect(shell.settingsWindowOpen).toBe(true);
    expect(shell.activeActivity).toBe("explorer");
    expect(shell.settingsPage).toBe("theme");

    shell.closeThemeStudio();
    expect(shell.themeStudioOpen).toBe(false);
    expect(shell.settingsWindowOpen).toBe(true);
    expect(shell.activeActivity).toBe("explorer");
    expect(shell.settingsPage).toBe("theme");
  });
});
