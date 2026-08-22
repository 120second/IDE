export type ActivityId =
  | "explorer"
  | "testcases"
  | "search"
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
  sidebarWidth = $state(264);
  bottomPanelHeight = $state(190);

  selectActivity(activity: ActivityId): void {
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
    this.zenMode = !this.zenMode;
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = Math.min(380, Math.max(210, width));
  }

  setBottomPanelHeight(height: number): void {
    this.bottomPanelHeight = Math.min(420, Math.max(120, height));
  }
}
