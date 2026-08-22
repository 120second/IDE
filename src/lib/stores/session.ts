import { isTauri } from "@tauri-apps/api/core";
import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { loadEditorRecovery, saveEditorRecovery } from "../api/session";
import type { EditorWorkspace } from "../editor/workspace.svelte";
import type { EditorRecoverySnapshot } from "../types/session";
import type { ActivityId, BottomPanelId, ShellStore } from "./shell.svelte";
import type { UxStore } from "./ux.svelte";
import type { WorkspaceStore } from "./workspace.svelte";

const STORAGE_KEY = "lightcp.session.v1";
const ACTIVITIES = new Set<ActivityId>(["explorer", "testcases", "search", "templates", "debug", "judge", "settings"]);
const PANELS = new Set<BottomPanelId>(["problems", "output", "tests", "terminal", "debugConsole"]);

interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

interface SessionSnapshot {
  version: 1;
  workspacePath?: string;
  activeActivity: ActivityId;
  sidebarVisible: boolean;
  bottomPanelVisible: boolean;
  activeBottomPanel: BottomPanelId;
  sidebarWidth: number;
  bottomPanelHeight: number;
  window?: WindowGeometry;
}

export class SessionStore {
  ready = false;

  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryWrite: Promise<void> = Promise.resolve();
  private unlistenWindow: UnlistenFn[] = [];
  private geometry: WindowGeometry | undefined;
  private lastWorkspacePath: string | undefined;
  private disposed = false;
  private closing = false;
  private allowClose = false;
  private recoveryWriteBlocked = false;
  private readonly beforeUnload = () => this.persistNow();

  constructor(
    private readonly workspace: WorkspaceStore,
    private readonly editor: EditorWorkspace,
    private readonly shell: ShellStore,
    private readonly ux: UxStore,
  ) {}

  async initialize(): Promise<void> {
    const snapshot = readSnapshot();
    let editorRecovery: EditorRecoverySnapshot | undefined;
    if (isTauri()) {
      try {
        editorRecovery = await loadEditorRecovery() ?? undefined;
      } catch (error) {
        this.ux.error(`无法读取编辑器恢复数据：${errorMessage(error)}`);
      }
    }
    if (snapshot) {
      this.restoreShell(snapshot);
      await this.restoreWindow(snapshot.window);
    }

    const recentPath = this.workspace.recent[0]?.path;
    const workspacePath = editorRecovery
      ? editorRecovery.workspacePath
      : snapshot?.workspacePath ?? recentPath;
    this.lastWorkspacePath = workspacePath;
    if (workspacePath) {
      await this.workspace.openPath(workspacePath);
      if (!this.workspace.info && recentPath && !samePath(workspacePath, recentPath)) {
        this.lastWorkspacePath = recentPath;
        await this.workspace.openPath(recentPath);
      }
      if (!this.workspace.info && this.workspace.error) {
        this.ux.error(`无法恢复上次工作区：${this.workspace.error}`);
      }
    }
    const activeWorkspace = this.workspace.info?.path;
    if (editorRecovery && (
      editorRecovery.workspacePath && activeWorkspace && samePath(editorRecovery.workspacePath, activeWorkspace)
      || !editorRecovery.workspacePath && !activeWorkspace
    )) {
      try {
        await this.editor.restoreRecoverySnapshot(editorRecovery);
      } catch (error) {
        this.recoveryWriteBlocked = true;
        this.ux.error(`无法恢复上次编辑内容：${errorMessage(error)}。原恢复快照已保留。`);
      }
    } else if (editorRecovery) {
      this.recoveryWriteBlocked = true;
      this.ux.error("上次编辑器恢复数据所属的工作区无法打开；原恢复快照已保留，未被覆盖。");
    }
    await this.watchWindow();
    window.addEventListener("beforeunload", this.beforeUnload);
    this.ready = true;
    this.editor.setSessionChangeHandler(() => this.scheduleRecovery());
    this.schedulePersist();
    this.scheduleRecovery();
  }

  schedulePersist(): void {
    if (!this.ready || this.disposed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.persistNow();
    }, 350);
  }

  scheduleRecovery(): void {
    if (!this.ready || this.disposed || this.recoveryWriteBlocked) return;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      void this.flushRecovery();
    }, 750);
  }

  async flushRecovery(): Promise<boolean> {
    if (!this.ready || !isTauri() || this.recoveryWriteBlocked) return true;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    const snapshot = this.editor.recoverySnapshot(
      this.workspace.info?.path ?? this.lastWorkspacePath,
    );
    const write = this.recoveryWrite
      .catch(() => undefined)
      .then(() => saveEditorRecovery(snapshot));
    this.recoveryWrite = write;
    try {
      await write;
      return true;
    } catch (error) {
      this.ux.error(`无法保存编辑器恢复数据：${errorMessage(error)}`);
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.editor.setSessionChangeHandler(undefined);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.saveTimer = undefined;
    this.recoveryTimer = undefined;
    this.persistNow();
    if (!this.allowClose) void this.flushRecovery();
    window.removeEventListener("beforeunload", this.beforeUnload);
    for (const unlisten of this.unlistenWindow) unlisten();
    this.unlistenWindow = [];
  }

  private restoreShell(snapshot: SessionSnapshot): void {
    this.shell.activeActivity = snapshot.activeActivity;
    this.shell.sidebarVisible = snapshot.sidebarVisible;
    this.shell.bottomPanelVisible = snapshot.bottomPanelVisible;
    this.shell.activeBottomPanel = snapshot.activeBottomPanel;
    this.shell.setSidebarWidth(snapshot.sidebarWidth);
    this.shell.setBottomPanelHeight(snapshot.bottomPanelHeight);
  }

  private persistNow(): void {
    if (!this.ready) return;
    const workspacePath = this.workspace.info?.path ?? this.lastWorkspacePath;
    if (this.workspace.info?.path) this.lastWorkspacePath = this.workspace.info.path;
    const snapshot: SessionSnapshot = {
      version: 1,
      workspacePath,
      activeActivity: this.shell.activeActivity,
      sidebarVisible: this.shell.sidebarVisible,
      bottomPanelVisible: this.shell.bottomPanelVisible,
      activeBottomPanel: this.shell.activeBottomPanel,
      sidebarWidth: this.shell.sidebarWidth,
      bottomPanelHeight: this.shell.bottomPanelHeight,
      window: this.geometry,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // A disabled or full localStorage must never prevent the IDE from closing.
    }
  }

  private async restoreWindow(geometry?: WindowGeometry): Promise<void> {
    if (!geometry || !isTauri()) return;
    try {
      const appWindow = getCurrentWindow();
      if (!geometry.maximized) {
        await appWindow.setSize(new PhysicalSize(geometry.width, geometry.height));
        const monitors = await availableMonitors();
        if (monitors.some((monitor) => windowIntersectsMonitor(geometry, monitor.workArea))) {
          await appWindow.setPosition(new PhysicalPosition(geometry.x, geometry.y));
        } else {
          await appWindow.center();
        }
      } else {
        await appWindow.maximize();
      }
      this.geometry = geometry;
    } catch {
      // Geometry can be rejected after a monitor was removed; keep platform defaults.
    }
  }

  private async watchWindow(): Promise<void> {
    if (!isTauri()) return;
    try {
      const appWindow = getCurrentWindow();
      const [position, size, maximized] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
        appWindow.isMaximized(),
      ]);
      this.geometry = sanitizeGeometry({
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
      });
      this.unlistenWindow = await Promise.all([
        appWindow.onMoved(({ payload }) => {
          if (!this.geometry) return;
          this.geometry = { ...this.geometry, x: payload.x, y: payload.y };
          this.schedulePersist();
        }),
        appWindow.onResized(async ({ payload }) => {
          if (!this.geometry) return;
          this.geometry = {
            ...this.geometry,
            width: payload.width,
            height: payload.height,
            maximized: await appWindow.isMaximized(),
          };
          this.schedulePersist();
        }),
        appWindow.onCloseRequested(async (event) => {
          if (this.allowClose) return;
          event.preventDefault();
          if (this.closing) return;
          this.closing = true;
          this.persistNow();
          const saved = await this.flushRecovery();
          if (!saved) {
            const discard = await this.ux.confirm({
              title: "无法保存恢复数据",
              message: "LightCP 无法保存未保存的编辑内容。仍然退出可能导致数据丢失。",
              confirmLabel: "仍然退出",
              danger: true,
            });
            if (!discard) {
              this.closing = false;
              return;
            }
          }
          this.allowClose = true;
          await appWindow.destroy();
        }),
      ]);
    } catch {
      // Browser preview and restricted platforms continue without geometry restore.
    }
  }
}

function readSnapshot(): SessionSnapshot | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SessionSnapshot> | null;
    if (!parsed || parsed.version !== 1) return undefined;
    const activeActivity = ACTIVITIES.has(parsed.activeActivity as ActivityId)
      ? parsed.activeActivity as ActivityId
      : "explorer";
    const activeBottomPanel = PANELS.has(parsed.activeBottomPanel as BottomPanelId)
      ? parsed.activeBottomPanel as BottomPanelId
      : "output";
    return {
      version: 1,
      workspacePath: boundedString(parsed.workspacePath, 4096),
      activeActivity,
      sidebarVisible: parsed.sidebarVisible !== false,
      bottomPanelVisible: parsed.bottomPanelVisible !== false,
      activeBottomPanel,
      sidebarWidth: finite(parsed.sidebarWidth, 210, 380, 264),
      bottomPanelHeight: finite(parsed.bottomPanelHeight, 120, 420, 190),
      window: sanitizeGeometry(parsed.window),
    };
  } catch {
    return undefined;
  }
}

function sanitizeGeometry(value: unknown): WindowGeometry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<WindowGeometry>;
  return {
    x: finite(input.x, -10_000, 10_000, 80),
    y: finite(input.y, -10_000, 10_000, 80),
    width: finite(input.width, 800, 7680, 1280),
    height: finite(input.height, 560, 4320, 800),
    maximized: Boolean(input.maximized),
  };
}

function finite(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(maximum, Math.max(minimum, value)))
    : fallback;
}

function boundedString(value: unknown, limit: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
}

export function windowIntersectsMonitor(
  geometry: Pick<WindowGeometry, "x" | "y" | "width" | "height">,
  workArea: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  },
): boolean {
  const overlapWidth = Math.min(geometry.x + geometry.width, workArea.position.x + workArea.size.width)
    - Math.max(geometry.x, workArea.position.x);
  const overlapHeight = Math.min(geometry.y + geometry.height, workArea.position.y + workArea.size.height)
    - Math.max(geometry.y, workArea.position.y);
  return overlapWidth >= 80 && overlapHeight >= 40;
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase()
    === right.replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { technicalMessage?: unknown; userMessage?: unknown };
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
