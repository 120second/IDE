export type ActivityId =
  | "explorer"
  | "testcases"
  | "templates"
  | "debug"
  | "judge"
  | "settings";

export type BottomPanelId = "problems" | "output" | "tests" | "debugConsole";

export class ShellStore {
  activeActivity = $state<ActivityId>("explorer");
  sidebarVisible = $state(true);
  bottomPanelVisible = $state(true);
  activeBottomPanel = $state<BottomPanelId>("output");
  zenMode = $state(false);
  themeStudioOpen = $state(false);
  themeStudioDirty = $state(false);
  sidebarWidth = $state(264);
  bottomPanelHeight = $state(190);

  selectActivity(activity: ActivityId): void {
    if (activity !== "settings" && this.themeStudioOpen) {
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

  openThemeStudio(): void {
    this.activeActivity = "settings";
    this.sidebarVisible = true;
    this.themeStudioOpen = true;
    this.themeStudioDirty = false;
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
}
