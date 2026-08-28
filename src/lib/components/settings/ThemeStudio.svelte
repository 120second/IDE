<script lang="ts">
  import type { SettingsStore } from "../../stores/settings.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import type {
    ColorThemeId,
    CustomThemeDefinition,
    EditorSyntaxToken,
    ResolvedTheme,
    ThemeColorToken,
  } from "../../types/settings";
  import { resolveThemePreference } from "../../types/settings";
  import {
    contrastRatio,
    getActiveCustomTheme,
    isThemeColor,
    opaqueColor,
    resolveEditorThemeColors,
    resolveThemeColors,
    SYNTAX_COLOR_GROUPS,
    THEME_COLOR_GROUPS,
  } from "../../theme/themes";
  import { exportThemeDocument, importThemeDocument } from "../../api/themes";
  import { COLOR_THEMES } from "../../stores/settings.svelte";

  interface Props {
    settings: SettingsStore;
    ux: UxStore;
    close: () => void;
    setDirty: (dirty: boolean) => void;
  }

  let { settings, ux, close, setDirty }: Props = $props();

  type StudioTab = "interface" | "syntax" | "json";
  let activeTab = $state<StudioTab>("interface");
  let selectedUiGroup = $state(THEME_COLOR_GROUPS[0].id);
  let selectedSyntaxGroup = $state(SYNTAX_COLOR_GROUPS[0].id);
  let jsonDraft = $state("");
  let jsonDirty = $state(false);
  let message = $state("");
  let error = $state("");
  let transferring = $state(false);

  let activeTheme = $derived(getActiveCustomTheme(settings.value));
  let variant = $derived(resolveThemePreference(settings.value.theme));
  let colors = $derived(resolveThemeColors(settings.value, variant));
  let syntax = $derived(resolveEditorThemeColors(settings.value, variant));
  let currentUiGroup = $derived(THEME_COLOR_GROUPS.find((group) => group.id === selectedUiGroup) ?? THEME_COLOR_GROUPS[0]);
  let currentSyntaxGroup = $derived(SYNTAX_COLOR_GROUPS.find((group) => group.id === selectedSyntaxGroup) ?? SYNTAX_COLOR_GROUPS[0]);

  $effect(() => {
    const theme = activeTheme;
    if (theme && !jsonDirty) jsonDraft = serializeTheme(theme);
  });

  $effect(() => {
    setDirty(jsonDirty);
  });

  function setVariant(next: ResolvedTheme): void {
    settings.update({ theme: next });
  }

  function setBaseTheme(next: ColorThemeId): void {
    if (activeTheme) settings.setCustomThemeBase(activeTheme.id, next);
  }

  function openJsonTab(): void {
    if (activeTab === "json") return;
    activeTab = "json";
    if (jsonDirty) {
      clearFeedback();
    } else {
      refreshJson();
    }
  }

  async function attemptClose(): Promise<void> {
    if (jsonDirty && !await ux.confirm({
      title: "放弃主题 JSON 修改",
      message: "主题 JSON 还有未应用的修改。返回工作台将放弃这些内容。",
      confirmLabel: "放弃修改",
      danger: true,
    })) return;
    setDirty(false);
    close();
  }

  function updateUiColor(token: ThemeColorToken, value: string): void {
    clearFeedback();
    if (!isThemeColor(value)) {
      error = "颜色必须使用 #RGB、#RGBA、#RRGGBB 或 #RRGGBBAA 格式。";
      return;
    }
    settings.updateCustomColor(variant, token, value);
  }

  function updateSyntaxColor(token: EditorSyntaxToken, value: string): void {
    clearFeedback();
    if (!isThemeColor(value)) {
      error = "颜色必须使用 #RGB、#RGBA、#RRGGBB 或 #RRGGBBAA 格式。";
      return;
    }
    settings.updateCustomSyntax(variant, token, value);
  }

  function applyJson(): void {
    clearFeedback();
    try {
      const theme = parseThemeDocument(jsonDraft);
      settings.importCustomTheme(theme);
      jsonDirty = false;
      jsonDraft = serializeTheme(theme);
      message = "主题 JSON 已应用。";
    } catch (reason) {
      error = errorMessage(reason);
    }
  }

  function refreshJson(): void {
    if (!activeTheme) return;
    jsonDraft = serializeTheme(activeTheme);
    jsonDirty = false;
    clearFeedback();
  }

  async function importTheme(): Promise<void> {
    if (transferring) return;
    if (jsonDirty && !await ux.confirm({
      title: "放弃主题 JSON 修改",
      message: "导入主题会放弃当前尚未应用的 JSON 内容。",
      confirmLabel: "继续导入",
      danger: true,
    })) return;
    transferring = true;
    clearFeedback();
    try {
      const content = await importThemeDocument();
      if (!content) return;
      const theme = parseThemeDocument(content);
      const existing = settings.value.customThemes.find((candidate) => candidate.id === theme.id);
      if (existing && !await ux.confirm({
        title: "覆盖同名主题标识",
        message: `导入文件的标识与“${existing.name}”相同。继续将覆盖现有主题配置。`,
        confirmLabel: "覆盖并导入",
        danger: true,
      })) return;
      settings.importCustomTheme(theme);
      jsonDirty = false;
      jsonDraft = serializeTheme(theme);
      message = `已导入“${theme.name}”。`;
    } catch (reason) {
      error = errorMessage(reason);
    } finally {
      transferring = false;
    }
  }

  async function exportTheme(): Promise<void> {
    if (!activeTheme || transferring) return;
    transferring = true;
    clearFeedback();
    try {
      if (await exportThemeDocument(activeTheme.name, serializeTheme(activeTheme))) {
        message = "主题文件已导出。";
      }
    } catch (reason) {
      error = errorMessage(reason);
    } finally {
      transferring = false;
    }
  }

  async function deleteTheme(): Promise<void> {
    if (!activeTheme) return;
    if (!await ux.confirm({
      title: "删除自定义主题",
      message: `确定删除“${activeTheme.name}”吗？此操作无法撤销。`,
      confirmLabel: "删除主题",
      danger: true,
    })) return;
    settings.deleteCustomTheme(activeTheme.id);
    close();
  }

  function clearFeedback(): void {
    message = "";
    error = "";
  }

  function overrideCount(theme: CustomThemeDefinition, targetVariant: ResolvedTheme): number {
    return Object.keys(theme.variants[targetVariant].colors).length
      + Object.keys(theme.variants[targetVariant].syntax).length;
  }

  function contrastLabel(token: ThemeColorToken, against: ThemeColorToken | undefined): string {
    if (!against) return "";
    const ratio = contrastRatio(colors[token], colors[against]);
    return ratio ? `${ratio.toFixed(1)}:1` : "";
  }

  function contrastPass(token: ThemeColorToken, against: ThemeColorToken | undefined): boolean {
    if (!against) return true;
    return (contrastRatio(colors[token], colors[against]) ?? 0) >= 4.5;
  }

  function serializeTheme(theme: CustomThemeDefinition): string {
    return JSON.stringify({ version: 1, theme }, null, 2);
  }

  function parseThemeDocument(content: string): CustomThemeDefinition {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (reason) {
      throw new Error(`JSON 格式错误：${reason instanceof Error ? reason.message : String(reason)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("主题文件顶层必须是 JSON 对象。");
    }
    const container = parsed as { version?: unknown; theme?: unknown };
    if (container.version !== undefined && container.version !== 1) {
      throw new Error("当前仅支持版本 1 的 LightCP 主题文件。");
    }
    const source = (container.theme ?? parsed) as Partial<CustomThemeDefinition>;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("主题文件缺少 theme 对象。");
    }
    if (typeof source.id !== "string" || !source.id.trim()) throw new Error("主题缺少有效的 id。");
    if (typeof source.name !== "string" || !source.name.trim()) throw new Error("主题缺少有效的 name。");
    if (source.inherits !== "signal" && source.inherits !== "graphite" && source.inherits !== "forest") {
      throw new Error("inherits 必须是 signal、graphite 或 forest。" );
    }
    if (!source.variants || typeof source.variants !== "object") throw new Error("主题缺少深浅 variants。");
    const uiKeys = new Set(THEME_COLOR_GROUPS.flatMap((group) => group.fields.map((field) => field.key)));
    const syntaxKeys = new Set(SYNTAX_COLOR_GROUPS.flatMap((group) => group.fields.map((field) => field.key)));
    return {
      id: source.id,
      name: source.name,
      inherits: source.inherits,
      variants: {
        dark: validateVariant(source.variants.dark, "dark", uiKeys, syntaxKeys),
        light: validateVariant(source.variants.light, "light", uiKeys, syntaxKeys),
      },
    };
  }

  function validateVariant(
    value: unknown,
    label: string,
    uiKeys: ReadonlySet<ThemeColorToken>,
    syntaxKeys: ReadonlySet<EditorSyntaxToken>,
  ): CustomThemeDefinition["variants"][ResolvedTheme] {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`variants.${label} 必须是对象。`);
    }
    const variantSource = value as { colors?: unknown; syntax?: unknown };
    return {
      colors: validateColorRecord(variantSource.colors, uiKeys, `variants.${label}.colors`),
      syntax: validateColorRecord(variantSource.syntax, syntaxKeys, `variants.${label}.syntax`),
    };
  }

  function validateColorRecord<T extends string>(
    value: unknown,
    allowed: ReadonlySet<T>,
    path: string,
  ): Partial<Record<T, string>> {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象。`);
    const result: Partial<Record<T, string>> = {};
    for (const [key, color] of Object.entries(value)) {
      if (!allowed.has(key as T)) throw new Error(`${path}.${key} 不是受支持的语义令牌。`);
      if (!isThemeColor(color)) throw new Error(`${path}.${key} 不是有效的十六进制颜色。`);
      result[key as T] = color;
    }
    return result;
  }

  function errorMessage(reason: unknown): string {
    if (typeof reason === "object" && reason) {
      const commandError = reason as { technicalMessage?: unknown; userMessage?: unknown };
      if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
      if (typeof commandError.userMessage === "string") return commandError.userMessage;
    }
    return reason instanceof Error ? reason.message : String(reason);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    void attemptClose();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<section class="theme-studio" aria-label="主题工作室">
  {#if activeTheme}
    <header class="theme-studio-header">
      <div class="theme-studio-title">
        <span>主题工作室 · {variant === "dark" ? "深色版本" : "浅色版本"}</span>
        <input
          aria-label="自定义主题名称"
          name="custom-theme-name"
          autocomplete="off"
          value={activeTheme.name}
          onblur={(event) => settings.renameCustomTheme(activeTheme.id, event.currentTarget.value)}
          onkeydown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <small>继承 {activeTheme.inherits} · 当前版本覆盖 {overrideCount(activeTheme, variant)} 项</small>
      </div>
      <div class="theme-studio-header-actions">
        <button class="secondary-button" disabled={transferring} onclick={() => void importTheme()}>导入</button>
        <button class="secondary-button" disabled={transferring} onclick={() => void exportTheme()}>导出</button>
        <button class="secondary-button" onclick={() => void attemptClose()}>查看工作台</button>
      </div>
    </header>

    <div class="theme-studio-toolbar">
      <div class="theme-studio-tabs" role="group" aria-label="主题编辑内容">
        <button class:active={activeTab === "interface"} aria-pressed={activeTab === "interface"} onclick={() => activeTab = "interface"}>界面颜色</button>
        <button class:active={activeTab === "syntax"} aria-pressed={activeTab === "syntax"} onclick={() => activeTab = "syntax"}>代码高亮</button>
        <button class:active={activeTab === "json"} aria-pressed={activeTab === "json"} onclick={openJsonTab}>主题 JSON</button>
      </div>
      <div class="theme-studio-scope-controls">
        <label>
          <span>基础主题</span>
          <select value={activeTheme.inherits} onchange={(event) => setBaseTheme(event.currentTarget.value as ColorThemeId)}>
            {#each COLOR_THEMES as option}<option value={option.id}>{option.label}</option>{/each}
          </select>
        </label>
        <div class="theme-variant-picker" role="group" aria-label="编辑主题版本">
          <button class:active={variant === "dark"} aria-pressed={variant === "dark"} onclick={() => setVariant("dark")}>深色</button>
          <button class:active={variant === "light"} aria-pressed={variant === "light"} onclick={() => setVariant("light")}>浅色</button>
        </div>
      </div>
    </div>

    <p class:error class="theme-studio-message" aria-live="polite">{error || message}</p>

    {#if activeTab === "interface"}
      <div class="theme-studio-workspace">
        <nav class="theme-token-navigation" aria-label="界面颜色分组">
          {#each THEME_COLOR_GROUPS as group}
            <button class:active={selectedUiGroup === group.id} aria-pressed={selectedUiGroup === group.id} onclick={() => selectedUiGroup = group.id}>
              <span>{group.label}</span><small>{group.fields.length}</small>
            </button>
          {/each}
        </nav>
        <div class="theme-token-editor">
          <div class="theme-token-heading">
            <div><h2>{currentUiGroup.label}</h2><p>修改会立即应用；只保存相对“{activeTheme.inherits}”的差异。</p></div>
            <div class="theme-token-heading-actions">
              <span>{variant === "dark" ? "DARK" : "LIGHT"}</span>
              <button
                disabled={!currentUiGroup.fields.some((field) => activeTheme.variants[variant].colors[field.key] !== undefined)}
                onclick={() => settings.resetCustomColorGroup(variant, currentUiGroup.fields.map((field) => field.key))}
              >恢复本组</button>
            </div>
          </div>
          <div class="theme-token-list">
            {#each currentUiGroup.fields as field}
              <div class="theme-token-row">
                <input
                  class="theme-color-picker"
                  type="color"
                  aria-label={`${field.label}颜色`}
                  value={opaqueColor(colors[field.key])}
                  oninput={(event) => updateUiColor(field.key, event.currentTarget.value)}
                />
                <label>
                  <span><strong>{field.label}</strong><small>{field.description}</small></span>
                  <input
                    class="theme-color-value"
                    aria-label={`${field.label}十六进制颜色`}
                    name={`theme-color-${field.key}`}
                    autocomplete="off"
                    value={colors[field.key]}
                    onchange={(event) => updateUiColor(field.key, event.currentTarget.value.trim())}
                  />
                </label>
                {#if field.contrastAgainst}
                  <span class:failed={!contrastPass(field.key, field.contrastAgainst)} class="contrast-badge" title={`与${field.contrastAgainst}的对比度`}>
                    {contrastLabel(field.key, field.contrastAgainst)}
                  </span>
                {:else}
                  <span></span>
                {/if}
                <button
                  class="token-reset"
                  aria-label={`恢复${field.label}`}
                  disabled={activeTheme.variants[variant].colors[field.key] === undefined}
                  onclick={() => settings.updateCustomColor(variant, field.key, undefined)}
                >恢复</button>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {:else if activeTab === "syntax"}
      <div class="theme-studio-workspace">
        <nav class="theme-token-navigation" aria-label="代码高亮分组">
          {#each SYNTAX_COLOR_GROUPS as group}
            <button class:active={selectedSyntaxGroup === group.id} aria-pressed={selectedSyntaxGroup === group.id} onclick={() => selectedSyntaxGroup = group.id}>
              <span>{group.label}</span><small>{group.fields.length}</small>
            </button>
          {/each}
        </nav>
        <div class="theme-token-editor syntax-token-editor">
          <div class="theme-token-heading">
            <div><h2>{currentSyntaxGroup.label}</h2><p>代码高亮使用语义分组，不需要按语言组件逐个修改。</p></div>
            <div class="theme-token-heading-actions">
              <span>{variant === "dark" ? "C++ · DARK" : "C++ · LIGHT"}</span>
              <button
                disabled={!currentSyntaxGroup.fields.some((field) => activeTheme.variants[variant].syntax[field.key] !== undefined)}
                onclick={() => settings.resetCustomSyntaxGroup(variant, currentSyntaxGroup.fields.map((field) => field.key))}
              >恢复本组</button>
            </div>
          </div>
          <div class="syntax-sample" aria-label="当前代码高亮示例">
            <span style:color={syntax.keyword}>template</span><span>&lt;</span><span style:color={syntax.keyword}>class</span> <span style:color={syntax.type}>T</span><span>&gt;</span><br />
            <span style:color={syntax.type}>vector</span><span>&lt;</span><span style:color={syntax.type}>T</span><span>&gt;</span> <span style:color={syntax.function}>solve</span><span>(</span><span style:color={syntax.type}>int</span> <span style:color={syntax.variable}>n</span><span>) {'{'}</span><br />
            &nbsp;&nbsp;<span style:color={syntax.comment}>// competition workbench</span><br />
            &nbsp;&nbsp;<span style:color={syntax.keyword}>return</span> <span style:color={syntax.string}>"LightCP"</span><span>;</span><br />
            <span>{'}'}</span>
          </div>
          <div class="theme-token-list">
            {#each currentSyntaxGroup.fields as field}
              <div class="theme-token-row syntax-token-row">
                <input
                  class="theme-color-picker"
                  type="color"
                  aria-label={`${field.label}颜色`}
                  value={opaqueColor(syntax[field.key])}
                  oninput={(event) => updateSyntaxColor(field.key, event.currentTarget.value)}
                />
                <label>
                  <span><strong>{field.label}</strong><small>{field.description}</small></span>
                  <input
                    class="theme-color-value"
                    aria-label={`${field.label}十六进制颜色`}
                    name={`syntax-color-${field.key}`}
                    autocomplete="off"
                    value={syntax[field.key]}
                    onchange={(event) => updateSyntaxColor(field.key, event.currentTarget.value.trim())}
                  />
                </label>
                <span></span>
                <button
                  class="token-reset"
                  aria-label={`恢复${field.label}`}
                  disabled={activeTheme.variants[variant].syntax[field.key] === undefined}
                  onclick={() => settings.updateCustomSyntax(variant, field.key, undefined)}
                >恢复</button>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <div class="theme-json-editor">
        <div class="theme-token-heading">
          <div><h2>主题 JSON</h2><p>适合批量修改、版本管理和分享；应用前会完整校验。</p></div>
          <span>FORMAT · V1</span>
        </div>
        <label for="theme-json-source">主题配置</label>
        <textarea
          id="theme-json-source"
          name="theme-json-source"
          autocomplete="off"
          spellcheck="false"
          value={jsonDraft}
          oninput={(event) => { jsonDraft = event.currentTarget.value; jsonDirty = true; clearFeedback(); }}
        ></textarea>
        <div class="theme-json-actions">
          <button class="secondary-button" disabled={!jsonDirty} onclick={refreshJson}>放弃 JSON 修改</button>
          <button class="primary-button" disabled={!jsonDirty} onclick={applyJson}>校验并应用</button>
        </div>
      </div>
    {/if}

    <footer class="theme-studio-footer">
      <span>内置主题保持只读；当前自定义主题会自动保存。</span>
      <button class="danger-text-button" onclick={() => void deleteTheme()}>删除此自定义主题</button>
    </footer>
  {:else}
    <div class="theme-studio-empty">
      <h2>没有可编辑的自定义主题</h2>
      <p>请从设置侧栏创建一个内置主题副本。</p>
      <button class="secondary-button" onclick={close}>返回工作台</button>
    </div>
  {/if}
</section>
