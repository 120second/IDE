export type ActivityId =
  | "explorer"
  | "testcases"
  | "templates"
  | "debug"
  | "judge";

export type BottomPanelId = "problems" | "output" | "debugConsole";
export type ProblemReaderDock = "left" | "right";

export type SettingsPage =
  | "account"
  | "theme"
  | "interface"
  | "background"
  | "editor"
  | "shortcuts"
  | "toolchain"
  | "performance";

export class ShellStore {
  activeActivity = $state<ActivityId>("explorer");
  sidebarVisible = $state(true);
  bottomPanelVisible = $state(true);
  activeBottomPanel = $state<BottomPanelId>("output");
  problemReaderVisible = $state(false);
  sketchBoardVisible = $state(false);
  problemReaderDock = $state<ProblemReaderDock>("right");
  zenMode = $state(false);
  generatorOpen = $state(false);
  themeStudioOpen = $state(false);
  themeStudioDirty = $state(false);
  settingsWindowOpen = $state(false);
  settingsPage = $state<SettingsPage>("theme");
  sidebarWidth = $state(264);
  bottomPanelHeight = $state(190);
  problemReaderWidth = $state(460);

  selectActivity(activity: ActivityId): void {
    if (this.themeStudioOpen) {
      if (!this.confirmThemeStudioExit()) return;
      this.themeStudioOpen = false;
      this.themeStudioDirty = false;
    }
    if (activity === "judge") {
      this.activeActivity = activity;
      this.sidebarVisible = true;
      return;
    }
    if (this.activeActivity === activity && this.sidebarVisible) {
      this.sidebarVisible = false;
      return;
    }
    this.activeActivity = activity;
    this.sidebarVisible = true;
  }

  openGenerator(): void {
    this.activeActivity = "testcases";
    this.sidebarVisible = true;
    this.generatorOpen = true;
  }

  openThemeStudio(): void {
    this.settingsPage = "theme";
    this.settingsWindowOpen = true;
    this.themeStudioOpen = true;
    this.themeStudioDirty = false;
  }

  openSettings(page: SettingsPage = "theme"): boolean {
    if (this.themeStudioOpen && !this.confirmThemeStudioExit()) return false;
    this.themeStudioOpen = false;
    this.themeStudioDirty = false;
    this.settingsPage = page;
    this.settingsWindowOpen = true;
    return true;
  }

  closeSettingsWindow(): void {
    this.settingsWindowOpen = false;
  }

  closeThemeStudio(): void {
    this.themeStudioOpen = false;
    this.themeStudioDirty = false;
  }

  setThemeStudioDirty(dirty: boolean): void {
    this.themeStudioDirty = dirty;
  }

  toggleSidebar(): void {
    if (!this.zenMode) this.sidebarVisible = !this.sidebarVisible;
  }

  toggleBottomPanel(): void {
    if (!this.zenMode) this.bottomPanelVisible = !this.bottomPanelVisible;
  }

  showBottomPanel(panel: BottomPanelId): void {
    this.activeBottomPanel = panel;
    this.bottomPanelVisible = true;
  }

  toggleZenMode(): void {
    if (!this.zenMode && this.themeStudioOpen && !this.confirmThemeStudioExit()) return;
    if (!this.zenMode && this.themeStudioOpen) this.themeStudioDirty = false;
    this.zenMode = !this.zenMode;
  }

  toggleProblemReader(): void {
    if (!this.zenMode) this.problemReaderVisible = !this.problemReaderVisible;
  }

  toggleSketchBoard(): void {
    if (!this.zenMode) this.sketchBoardVisible = !this.sketchBoardVisible;
  }

  toggleProblemReaderDock(): void {
    this.problemReaderDock = this.problemReaderDock === "right" ? "left" : "right";
  }

  private confirmThemeStudioExit(): boolean {
    return !this.themeStudioDirty
      || typeof window === "undefined"
      || window.confirm("主题 JSON 还有未应用的修改，确定要放弃吗？");
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = Math.min(380, Math.max(210, width));
  }

  setBottomPanelHeight(height: number): void {
    this.bottomPanelHeight = Math.min(420, Math.max(120, height));
  }

  setProblemReaderWidth(width: number): void {
    this.problemReaderWidth = Math.min(760, Math.max(300, width));
  }
}
