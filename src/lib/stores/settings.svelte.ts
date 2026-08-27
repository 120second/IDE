import { loadSettings, saveSettings } from "../api/settings";
import {
  resolveThemePreference,
  type AppSettings,
  type ColorThemeId,
  type CustomThemeDefinition,
  type EditorSyntaxToken,
  type ResolvedTheme,
  type SettingsSaveState,
  type ThemeColorToken,
  type ThemePreference,
  type UiDensity,
} from "../types/settings";
import { DEFAULT_KEYBINDINGS, normalizeKeybindings } from "../keybindings";
import {
  createCustomTheme as createCustomThemeDefinition,
  getActiveCustomTheme,
  getEffectiveBaseTheme,
  isThemeColor,
  SYNTAX_COLOR_GROUPS,
  THEME_COLOR_GROUPS,
  THEME_CSS_VARIABLES,
} from "../theme/themes";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  colorTheme: "signal",
  activeCustomTheme: "",
  customThemes: [],
  uiDensity: "compact",
  fontFamily: "Cascadia Code, JetBrains Mono, Consolas, monospace",
  fontSize: 14,
  lineHeight: 1.55,
  performanceMode: false,
  compilerPath: "g++",
  gdbPath: "gdb",
  clangdPath: "",
  compilerStandard: "c++20",
  releaseArgs: ["-O2"],
  debugArgs: ["-g", "-O0"],
  runTimeoutMs: 2000,
  maxOutputBytes: 2 * 1024 * 1024,
  keybindings: { ...DEFAULT_KEYBINDINGS },
};

export const COLOR_THEMES: ReadonlyArray<{
  id: ColorThemeId;
  label: string;
  description: string;
}> = [
  { id: "signal", label: "赛场蓝", description: "清晰边界与高辨识度状态色" },
  { id: "graphite", label: "石墨", description: "低饱和中性色，减少视觉干扰" },
  { id: "forest", label: "松针", description: "柔和青绿，适合长时间阅读" },
];

export const UI_DENSITIES: ReadonlyArray<{
  id: UiDensity;
  label: string;
  description: string;
}> = [
  { id: "compact", label: "紧凑", description: "同屏显示更多代码与测试信息" },
  { id: "standard", label: "标准", description: "信息密度与操作空间平衡" },
  { id: "comfortable", label: "舒展", description: "更大的行距与控件热区" },
];

export const EDITOR_FONT_PRESETS = [
  { id: "cascadia", label: "Cascadia Code", value: "Cascadia Code, JetBrains Mono, Consolas, monospace" },
  { id: "jetbrains", label: "JetBrains Mono", value: "JetBrains Mono, Cascadia Code, Consolas, monospace" },
  { id: "consolas", label: "Consolas", value: "Consolas, Cascadia Code, monospace" },
] as const;

export const EDITOR_LINE_HEIGHTS = [
  { label: "紧凑", value: 1.35 },
  { label: "标准", value: 1.55 },
  { label: "舒适", value: 1.75 },
] as const;

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
      this.value = cloneDefaults();
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
    const next = cloneDefaults();
    if (fingerprint(next) === fingerprint(this.value)) return;
    this.value = next;
    this.queueSave();
  }

  resetAppearance(): void {
    this.update({
      theme: DEFAULT_SETTINGS.theme,
      colorTheme: DEFAULT_SETTINGS.colorTheme,
      activeCustomTheme: "",
      uiDensity: DEFAULT_SETTINGS.uiDensity,
      fontFamily: DEFAULT_SETTINGS.fontFamily,
      fontSize: DEFAULT_SETTINGS.fontSize,
      lineHeight: DEFAULT_SETTINGS.lineHeight,
    });
  }

  selectBuiltinTheme(theme: ColorThemeId): void {
    this.update({ colorTheme: theme, activeCustomTheme: "" });
  }

  selectCustomTheme(id: string): void {
    const theme = this.value.customThemes.find((candidate) => candidate.id === id);
    if (!theme) return;
    this.update({ colorTheme: theme.inherits, activeCustomTheme: theme.id });
  }

  createCustomTheme(): string {
    const base = getEffectiveBaseTheme(this.value);
    const baseLabel = COLOR_THEMES.find((theme) => theme.id === base)?.label ?? "主题";
    const custom = createCustomThemeDefinition(
      base,
      `${baseLabel}副本`,
      this.value.customThemes.map((theme) => theme.id),
    );
    this.update({
      colorTheme: base,
      activeCustomTheme: custom.id,
      customThemes: [...this.value.customThemes, custom],
    });
    return custom.id;
  }

  renameCustomTheme(id: string, name: string): void {
    this.replaceCustomTheme(id, (theme) => ({ ...theme, name: name.trim().slice(0, 48) || theme.name }));
  }

  setCustomThemeBase(id: string, inherits: ColorThemeId): void {
    this.replaceCustomTheme(id, (theme) => ({ ...theme, inherits }));
    if (this.value.activeCustomTheme === id) this.update({ colorTheme: inherits });
  }

  updateCustomColor(variant: ResolvedTheme, token: ThemeColorToken, value: string | undefined): void {
    const id = this.value.activeCustomTheme;
    if (!id || (value !== undefined && !isThemeColor(value))) return;
    this.replaceCustomTheme(id, (theme) => ({
      ...theme,
      variants: {
        ...theme.variants,
        [variant]: {
          ...theme.variants[variant],
          colors: withOverride(theme.variants[variant].colors, token, value),
        },
      },
    }));
  }

  updateCustomSyntax(variant: ResolvedTheme, token: EditorSyntaxToken, value: string | undefined): void {
    const id = this.value.activeCustomTheme;
    if (!id || (value !== undefined && !isThemeColor(value))) return;
    this.replaceCustomTheme(id, (theme) => ({
      ...theme,
      variants: {
        ...theme.variants,
        [variant]: {
          ...theme.variants[variant],
          syntax: withOverride(theme.variants[variant].syntax, token, value),
        },
      },
    }));
  }

  resetCustomColorGroup(variant: ResolvedTheme, tokens: ReadonlyArray<ThemeColorToken>): void {
    const id = this.value.activeCustomTheme;
    if (!id) return;
    this.replaceCustomTheme(id, (theme) => ({
      ...theme,
      variants: {
        ...theme.variants,
        [variant]: {
          ...theme.variants[variant],
          colors: withoutOverrides(theme.variants[variant].colors, tokens),
        },
      },
    }));
  }

  resetCustomSyntaxGroup(variant: ResolvedTheme, tokens: ReadonlyArray<EditorSyntaxToken>): void {
    const id = this.value.activeCustomTheme;
    if (!id) return;
    this.replaceCustomTheme(id, (theme) => ({
      ...theme,
      variants: {
        ...theme.variants,
        [variant]: {
          ...theme.variants[variant],
          syntax: withoutOverrides(theme.variants[variant].syntax, tokens),
        },
      },
    }));
  }

  importCustomTheme(theme: CustomThemeDefinition): string {
    const normalized = normalizeCustomThemes([theme])[0];
    if (!normalized) throw new Error("主题文件没有包含可用的主题数据。");
    const existing = this.value.customThemes.findIndex((candidate) => candidate.id === normalized.id);
    const customThemes = [...this.value.customThemes];
    if (existing >= 0) customThemes[existing] = normalized;
    else customThemes.push(normalized);
    this.update({ colorTheme: normalized.inherits, activeCustomTheme: normalized.id, customThemes });
    return normalized.id;
  }

  deleteCustomTheme(id: string): void {
    const customThemes = this.value.customThemes.filter((theme) => theme.id !== id);
    this.update({
      customThemes,
      activeCustomTheme: this.value.activeCustomTheme === id ? "" : this.value.activeCustomTheme,
    });
  }

  private replaceCustomTheme(
    id: string,
    updateTheme: (theme: CustomThemeDefinition) => CustomThemeDefinition,
  ): void {
    let changed = false;
    const customThemes = this.value.customThemes.map((theme) => {
      if (theme.id !== id) return theme;
      changed = true;
      return updateTheme(theme);
    });
    if (changed) this.update({ customThemes });
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
  const variant = resolveThemePreference(settings.theme);
  const custom = getActiveCustomTheme(settings);
  root.dataset.theme = variant;
  root.dataset.themeMode = settings.theme;
  root.dataset.colorTheme = getEffectiveBaseTheme(settings);
  root.dataset.customTheme = custom?.id ?? "";
  root.dataset.density = settings.uiDensity;
  root.classList.toggle("performance-mode", settings.performanceMode);
  root.style.setProperty("--background-opacity", "0");
  root.style.setProperty("--window-opacity", "1");
  root.style.setProperty("--window-opacity-percent", "100%");
  root.style.setProperty("--sidebar-opacity", "1");
  root.style.setProperty("--sidebar-opacity-percent", "100%");
  root.style.setProperty("--editor-opacity", "1");
  root.style.setProperty("--editor-opacity-percent", "100%");
  root.style.setProperty("--control-opacity-percent", "100%");
  root.style.setProperty("--surface-blur", "0px");
  root.style.setProperty("--editor-font-family", settings.fontFamily);
  root.style.setProperty("--editor-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--editor-line-height", `${settings.lineHeight}`);
  root.style.setProperty("--workspace-background-image", "none");
  for (const cssVariable of Object.values(THEME_CSS_VARIABLES)) root.style.removeProperty(cssVariable);
  if (custom) {
    for (const [token, value] of Object.entries(custom.variants[variant].colors)) {
      root.style.setProperty(THEME_CSS_VARIABLES[token as ThemeColorToken], value);
    }
  }
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const customThemes = normalizeCustomThemes(settings.customThemes);
  const requestedCustomTheme = String(settings.activeCustomTheme ?? "");
  return {
    theme: normalizeTheme(settings.theme),
    colorTheme: normalizeColorTheme(settings.colorTheme),
    activeCustomTheme: customThemes.some((theme) => theme.id === requestedCustomTheme)
      ? requestedCustomTheme
      : "",
    customThemes,
    uiDensity: normalizeDensity(settings.uiDensity),
    fontFamily:
      String(settings.fontFamily ?? "").trim().slice(0, 256) || DEFAULT_SETTINGS.fontFamily,
    fontSize: clamp(settings.fontSize, 11, 24, 14),
    lineHeight: clamp(settings.lineHeight, 1.2, 2, 1.55),
    performanceMode: Boolean(settings.performanceMode),
    compilerPath: String(settings.compilerPath ?? "").trim().slice(0, 2048) || "g++",
    gdbPath: String(settings.gdbPath ?? "").trim().slice(0, 2048) || "gdb",
    clangdPath: String(settings.clangdPath ?? "").trim().slice(0, 2048),
    compilerStandard: String(settings.compilerStandard ?? "").trim().slice(0, 32) || "c++20",
    releaseArgs: normalizeArguments(settings.releaseArgs, ["-O2"]),
    debugArgs: normalizeArguments(settings.debugArgs, ["-g", "-O0"]),
    runTimeoutMs: clamp(settings.runTimeoutMs, 100, 60_000, 2000),
    maxOutputBytes: clamp(settings.maxOutputBytes, 64 * 1024, 16 * 1024 * 1024, 2 * 1024 * 1024),
    keybindings: normalizeKeybindings(settings.keybindings),
  };
}

function normalizeTheme(value: ThemePreference): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

function normalizeColorTheme(value: ColorThemeId): ColorThemeId {
  return value === "graphite" || value === "forest" ? value : "signal";
}

function normalizeDensity(value: UiDensity): UiDensity {
  return value === "standard" || value === "comfortable" ? value : "compact";
}

function cloneDefaults(): AppSettings {
  return { ...DEFAULT_SETTINGS, customThemes: [], keybindings: { ...DEFAULT_KEYBINDINGS } };
}

const THEME_COLOR_KEYS = new Set<ThemeColorToken>(
  THEME_COLOR_GROUPS.flatMap((group) => group.fields.map((field) => field.key)),
);
const SYNTAX_COLOR_KEYS = new Set<EditorSyntaxToken>(
  SYNTAX_COLOR_GROUPS.flatMap((group) => group.fields.map((field) => field.key)),
);

function normalizeCustomThemes(value: unknown): CustomThemeDefinition[] {
  if (!Array.isArray(value)) return [];
  const themes: CustomThemeDefinition[] = [];
  const ids = new Set<string>();
  for (const candidate of value.slice(0, 24)) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as Partial<CustomThemeDefinition>;
    let id = String(source.id ?? "")
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (!id) id = "custom-theme";
    const stem = id;
    let suffix = 1;
    while (ids.has(id)) id = `${stem}-${++suffix}`.slice(0, 64);
    ids.add(id);
    const inherits = normalizeColorTheme(source.inherits ?? "signal");
    const variants = source.variants && typeof source.variants === "object" ? source.variants : undefined;
    themes.push({
      id,
      name: String(source.name ?? "").trim().slice(0, 48) || "自定义主题",
      inherits,
      variants: {
        dark: normalizeCustomVariant(variants?.dark),
        light: normalizeCustomVariant(variants?.light),
      },
    });
  }
  return themes;
}

function normalizeCustomVariant(value: unknown): CustomThemeDefinition["variants"][ResolvedTheme] {
  if (!value || typeof value !== "object") return { colors: {}, syntax: {} };
  const source = value as { colors?: unknown; syntax?: unknown };
  return {
    colors: normalizeColorRecord(source.colors, THEME_COLOR_KEYS),
    syntax: normalizeColorRecord(source.syntax, SYNTAX_COLOR_KEYS),
  };
}

function normalizeColorRecord<T extends string>(value: unknown, allowed: ReadonlySet<T>): Partial<Record<T, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<Record<T, string>> = {};
  for (const [key, color] of Object.entries(value).slice(0, allowed.size)) {
    if (allowed.has(key as T) && isThemeColor(color)) result[key as T] = color.toLocaleLowerCase();
  }
  return result;
}

function withOverride<T extends string>(
  source: Partial<Record<T, string>>,
  token: T,
  value: string | undefined,
): Partial<Record<T, string>> {
  const result = { ...source };
  if (value === undefined) delete result[token];
  else result[token] = value.toLocaleLowerCase();
  return result;
}

function withoutOverrides<T extends string>(
  source: Partial<Record<T, string>>,
  tokens: ReadonlyArray<T>,
): Partial<Record<T, string>> {
  const result = { ...source };
  for (const token of tokens) delete result[token];
  return result;
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
