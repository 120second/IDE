import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { loadSettings, saveSettings } from "../api/settings";
import type { AppSettings, SettingsSaveState } from "../types/settings";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  backgroundImage: "",
  backgroundOpacity: 0.18,
  sidebarOpacity: 0.96,
  editorOpacity: 0.98,
  blur: 12,
  fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
  fontSize: 14,
  lineHeight: 1.62,
  performanceMode: false,
  compilerPath: "g++",
  gdbPath: "gdb",
  compilerStandard: "c++20",
  releaseArgs: ["-O2"],
  debugArgs: ["-g", "-O0"],
  runTimeoutMs: 2000,
  maxOutputBytes: 2 * 1024 * 1024,
};

export class SettingsStore {
  value = $state.raw<AppSettings>({ ...DEFAULT_SETTINGS });
  saveState = $state<SettingsSaveState>("idle");
  errorMessage = $state("");

  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saveSequence = 0;
  private persistedFingerprint = "";
  private persisting = false;
  private retryAfterPersist = false;

  async initialize(): Promise<void> {
    this.saveState = "loading";
    try {
      this.value = normalizeSettings(await loadSettings(DEFAULT_SETTINGS));
      this.persistedFingerprint = fingerprint(this.value);
      this.saveState = "idle";
      this.errorMessage = "";
    } catch (error) {
      this.value = { ...DEFAULT_SETTINGS };
      this.saveState = "error";
      this.errorMessage = errorMessage(error);
    }
  }

  update(patch: Partial<AppSettings>): void {
    const next = normalizeSettings({ ...this.value, ...patch });
    if (fingerprint(next) === fingerprint(this.value)) return;
    this.value = next;
    this.queueSave();
  }

  reset(): void {
    const next = { ...DEFAULT_SETTINGS };
    if (fingerprint(next) === fingerprint(this.value)) return;
    this.value = next;
    this.queueSave();
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      void this.persist(this.saveSequence);
    }
  }

  private queueSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveState = "saving";
    const sequence = ++this.saveSequence;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.persist(sequence);
    }, 400);
  }

  private async persist(sequence: number): Promise<void> {
    if (this.persisting) {
      this.retryAfterPersist = true;
      return;
    }
    const snapshot = this.value;
    const snapshotFingerprint = fingerprint(snapshot);
    if (snapshotFingerprint === this.persistedFingerprint) {
      if (sequence === this.saveSequence) this.saveState = "saved";
      return;
    }
    this.persisting = true;
    try {
      const saved = normalizeSettings(await saveSettings(snapshot));
      this.persistedFingerprint = fingerprint(saved);
      if (sequence === this.saveSequence) {
        if (fingerprint(this.value) !== this.persistedFingerprint) this.value = saved;
        this.saveState = "saved";
        this.errorMessage = "";
      }
    } catch (error) {
      if (sequence === this.saveSequence) {
        this.saveState = "error";
        this.errorMessage = errorMessage(error);
      }
    } finally {
      this.persisting = false;
      if (this.retryAfterPersist) {
        this.retryAfterPersist = false;
        void this.persist(this.saveSequence);
      }
    }
  }
}

function fingerprint(settings: AppSettings): string {
  return JSON.stringify(settings);
}

export function applyDocumentAppearance(settings: AppSettings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.classList.toggle("performance-mode", settings.performanceMode);
  root.style.setProperty("--background-opacity", `${settings.backgroundOpacity}`);
  root.style.setProperty("--sidebar-opacity", `${settings.sidebarOpacity}`);
  root.style.setProperty("--sidebar-opacity-percent", `${settings.sidebarOpacity * 100}%`);
  root.style.setProperty("--editor-opacity", `${settings.editorOpacity}`);
  root.style.setProperty("--editor-opacity-percent", `${settings.editorOpacity * 100}%`);
  root.style.setProperty("--surface-blur", `${settings.performanceMode ? 0 : settings.blur}px`);
  root.style.setProperty("--editor-font-family", settings.fontFamily);
  root.style.setProperty("--editor-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--editor-line-height", `${settings.lineHeight}`);

  const backgroundUrl = resolveBackgroundUrl(settings.backgroundImage);
  root.style.setProperty(
    "--workspace-background-image",
    backgroundUrl ? `url("${escapeCssUrl(backgroundUrl)}")` : "none",
  );
}

function resolveBackgroundUrl(value: string): string {
  const path = value.trim();
  if (!path) return "";
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return isTauri() ? convertFileSrc(path) : path;
}

function escapeCssUrl(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    theme: settings.theme === "light" ? "light" : "dark",
    backgroundImage: String(settings.backgroundImage ?? "").trim().slice(0, 2048),
    backgroundOpacity: clamp(settings.backgroundOpacity, 0, 1, 0.18),
    sidebarOpacity: clamp(settings.sidebarOpacity, 0.5, 1, 0.96),
    editorOpacity: clamp(settings.editorOpacity, 0.75, 1, 0.98),
    blur: clamp(settings.blur, 0, 24, 12),
    fontFamily:
      String(settings.fontFamily ?? "").trim().slice(0, 256) || DEFAULT_SETTINGS.fontFamily,
    fontSize: clamp(settings.fontSize, 11, 24, 14),
    lineHeight: clamp(settings.lineHeight, 1.2, 2, 1.62),
    performanceMode: Boolean(settings.performanceMode),
    compilerPath: String(settings.compilerPath ?? "").trim().slice(0, 2048) || "g++",
    gdbPath: String(settings.gdbPath ?? "").trim().slice(0, 2048) || "gdb",
    compilerStandard: String(settings.compilerStandard ?? "").trim().slice(0, 32) || "c++20",
    releaseArgs: normalizeArguments(settings.releaseArgs, ["-O2"]),
    debugArgs: normalizeArguments(settings.debugArgs, ["-g", "-O0"]),
    runTimeoutMs: clamp(settings.runTimeoutMs, 100, 60_000, 2000),
    maxOutputBytes: clamp(settings.maxOutputBytes, 64 * 1024, 16 * 1024 * 1024, 2 * 1024 * 1024),
  };
}

function normalizeArguments(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const arguments_ = value
    .map((argument) => String(argument).trim().slice(0, 256))
    .filter(Boolean)
    .slice(0, 32);
  return arguments_.length ? arguments_ : [...fallback];
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error && "userMessage" in error) {
    return String(error.userMessage);
  }
  return error instanceof Error ? error.message : String(error);
}
