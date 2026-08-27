<script lang="ts">
  import type { SettingsStore } from "../../stores/settings.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import {
    COLOR_THEMES,
    EDITOR_FONT_PRESETS,
    EDITOR_LINE_HEIGHTS,
    UI_DENSITIES,
  } from "../../stores/settings.svelte";
  import type { ThemePreference } from "../../types/settings";
  import { diagnoseToolchain } from "../../api/health";
  import type { ToolStatus, ToolchainStatus } from "../../types/health";
  import {
    DEFAULT_KEYBINDINGS,
    SHORTCUT_IDS,
    SHORTCUT_LABELS,
    shortcutConflicts,
    shortcutFromEvent,
    type ShortcutId,
  } from "../../keybindings";

  interface Props {
    settings: SettingsStore;
    shell: ShellStore;
  }

  let { settings, shell }: Props = $props();

  const parseArguments = (value: string) => value.split(/\s+/).map((argument) => argument.trim()).filter(Boolean);
  let conflicts = $derived(shortcutConflicts(settings.value.keybindings));
  let toolchain = $state<ToolchainStatus>();
  let checkingToolchain = $state(false);
  let toolchainError = $state("");
  let diagnosticRequest = 0;
  let toolRows = $derived<{ label: string; tool: ToolStatus | undefined }[]>([
    { label: "编译", tool: toolchain?.compiler },
    { label: "调试", tool: toolchain?.debugger },
    { label: "智能提示", tool: toolchain?.languageServer },
  ]);

  const themeModes: { id: ThemePreference; label: string; description: string }[] = [
    { id: "system", label: "跟随系统", description: "随 Windows 外观自动切换" },
    { id: "dark", label: "深色", description: "固定使用深色版本" },
    { id: "light", label: "浅色", description: "固定使用浅色版本" },
  ];

  function fontPresetActive(value: string): boolean {
    return settings.value.fontFamily === value;
  }

  function lineHeightActive(value: number): boolean {
    return Math.abs(settings.value.lineHeight - value) < 0.001;
  }

  function adjustFontSize(delta: number): void {
    settings.update({ fontSize: Math.max(11, Math.min(24, settings.value.fontSize + delta)) });
  }

  function openThemeStudio(): void {
    if (!settings.value.activeCustomTheme) settings.createCustomTheme();
    shell.openThemeStudio();
  }

  function captureShortcut(event: KeyboardEvent, id: ShortcutId): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Backspace" || event.key === "Delete") {
      updateShortcut(id, DEFAULT_KEYBINDINGS[id]);
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (shortcut) updateShortcut(id, shortcut);
  }

  function updateShortcut(id: ShortcutId, value: string): void {
    settings.update({ keybindings: { ...settings.value.keybindings, [id]: value } });
  }

  async function refreshToolchain(): Promise<void> {
    const request = ++diagnosticRequest;
    checkingToolchain = true;
    toolchainError = "";
    try {
      const result = await diagnoseToolchain(
        settings.value.compilerPath,
        settings.value.gdbPath,
        settings.value.clangdPath,
      );
      if (request === diagnosticRequest) toolchain = result;
    } catch (error) {
      if (request === diagnosticRequest) {
        toolchainError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === diagnosticRequest) checkingToolchain = false;
    }
  }

  function toolLabel(tool: ToolStatus | undefined): string {
    if (!tool) return "尚未检查";
    return tool.available ? "可用" : "未找到";
  }

  $effect(() => {
    settings.value.compilerPath;
    settings.value.gdbPath;
    settings.value.clangdPath;
    const timer = window.setTimeout(() => void refreshToolchain(), 350);
    return () => window.clearTimeout(timer);
  });
</script>

<div class="settings-panel">
  <section class="settings-section">
    <div class="section-heading">
      <div>
        <h3>外观</h3>
        <p>修改会立即应用到整个工作台。</p>
      </div>
      <span class:failed={settings.saveState === "error"} class="save-state">
        {#if settings.saveState === "saving"}正在保存…
        {:else if settings.saveState === "saved"}已保存
        {:else if settings.saveState === "error"}保存失败
        {:else if settings.saveState === "loading"}正在加载…
        {/if}
      </span>
    </div>

    <div class="appearance-block">
      <div class="appearance-block-heading">
        <strong>显示模式</strong>
        <span>每套颜色主题都包含匹配的浅色和深色版本。</span>
      </div>
      <div class="appearance-mode-picker" role="group" aria-label="显示模式">
        {#each themeModes as mode}
          <button
            aria-pressed={settings.value.theme === mode.id}
            class:active={settings.value.theme === mode.id}
            title={mode.description}
            onclick={() => settings.update({ theme: mode.id })}
          >{mode.label}</button>
        {/each}
      </div>
    </div>

    <div class="appearance-block">
      <div class="appearance-block-heading">
        <strong>颜色主题</strong>
        <span>选择后立即应用到编辑器、侧栏、面板和弹窗。</span>
      </div>
      <div class="appearance-theme-grid" role="group" aria-label="颜色主题">
        {#each COLOR_THEMES as theme}
          <button
            class:active={!settings.value.activeCustomTheme && settings.value.colorTheme === theme.id}
            class="appearance-theme-card"
            data-preview-theme={theme.id}
            aria-pressed={!settings.value.activeCustomTheme && settings.value.colorTheme === theme.id}
            onclick={() => settings.selectBuiltinTheme(theme.id)}
          >
            <span class="theme-color-rail" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <span><strong>{theme.label}</strong><small>{theme.description}</small></span>
            <span class="theme-selected" aria-hidden="true">{!settings.value.activeCustomTheme && settings.value.colorTheme === theme.id ? "✓" : ""}</span>
          </button>
        {/each}
        {#each settings.value.customThemes as theme}
          <button
            class:active={settings.value.activeCustomTheme === theme.id}
            class="appearance-theme-card custom-theme-card"
            data-preview-theme={theme.inherits}
            aria-pressed={settings.value.activeCustomTheme === theme.id}
            onclick={() => settings.selectCustomTheme(theme.id)}
          >
            <span class="theme-color-rail" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <span><strong>{theme.name}</strong><small>继承 {COLOR_THEMES.find((item) => item.id === theme.inherits)?.label}</small></span>
            <span class="theme-selected custom-mark" aria-hidden="true">{settings.value.activeCustomTheme === theme.id ? "✓" : "◆"}</span>
          </button>
        {/each}
      </div>
      <button class="primary-button open-theme-studio" onclick={openThemeStudio}>
        {settings.value.activeCustomTheme ? "编辑当前自定义主题" : "创建副本并自定义"}
      </button>
    </div>

    <div class="appearance-block">
      <div class="appearance-block-heading">
        <strong>界面密度</strong>
        <span>同时调整导航、标签、列表和表单的空间。</span>
      </div>
      <div class="density-picker" role="group" aria-label="界面密度">
        {#each UI_DENSITIES as density}
          <button
            class:active={settings.value.uiDensity === density.id}
            aria-pressed={settings.value.uiDensity === density.id}
            title={density.description}
            onclick={() => settings.update({ uiDensity: density.id })}
          >{density.label}</button>
        {/each}
      </div>
    </div>

    <div class="appearance-block editor-typography-block">
      <div class="appearance-block-heading">
        <strong>编辑器字体</strong>
        <span>只影响代码区，界面文字继续使用系统字体。</span>
      </div>
      <div class="font-preset-list" role="group" aria-label="编辑器字体">
        {#each EDITOR_FONT_PRESETS as font}
          <button
            class:active={fontPresetActive(font.value)}
            data-font={font.id}
            aria-pressed={fontPresetActive(font.value)}
            onclick={() => settings.update({ fontFamily: font.value })}
          ><span>{font.label}</span><code>Aa 01 {'{}'}</code></button>
        {/each}
      </div>

      <div class="font-metrics-row">
        <div>
          <span>字号</span>
          <div class="font-size-stepper">
            <button aria-label="减小编辑器字号" disabled={settings.value.fontSize <= 11} onclick={() => adjustFontSize(-1)}>−</button>
            <output aria-live="polite">{settings.value.fontSize.toFixed(0)} px</output>
            <button aria-label="增大编辑器字号" disabled={settings.value.fontSize >= 24} onclick={() => adjustFontSize(1)}>+</button>
          </div>
        </div>
        <div>
          <span>行距</span>
          <div class="line-height-picker" role="group" aria-label="编辑器行距">
            {#each EDITOR_LINE_HEIGHTS as option}
              <button
                class:active={lineHeightActive(option.value)}
                aria-pressed={lineHeightActive(option.value)}
                onclick={() => settings.update({ lineHeight: option.value })}
              >{option.label}</button>
            {/each}
          </div>
        </div>
      </div>

      <details class="appearance-advanced">
        <summary>自定义字体族</summary>
        <label>
          <span>CSS 字体族</span>
          <input
            class="text-input"
            name="editor-font-family"
            autocomplete="off"
            value={settings.value.fontFamily}
            oninput={(event) => settings.update({ fontFamily: event.currentTarget.value })}
          />
        </label>
      </details>
    </div>

    <button class="secondary-button reset-appearance" onclick={() => settings.resetAppearance()}>
      恢复默认外观
    </button>
  </section>

  <section class="settings-section shortcut-settings">
    <div class="section-heading">
      <div>
        <h3>快捷键</h3>
        <p>聚焦输入框后直接按下新的组合键；按 Backspace 恢复该项默认值。</p>
      </div>
    </div>

    {#each SHORTCUT_IDS as id}
      <label class:error-row={conflicts.has(id)} class="shortcut-row">
        <span>
          <strong>{SHORTCUT_LABELS[id]}</strong>
          {#if conflicts.has(id)}
            <small>与 {conflicts.get(id)?.map((other) => SHORTCUT_LABELS[other]).join("、")} 冲突</small>
          {/if}
        </span>
        <input
          class="shortcut-input"
          readonly
          aria-invalid={conflicts.has(id)}
          aria-label={`${SHORTCUT_LABELS[id]}快捷键`}
          value={settings.value.keybindings[id]}
          onkeydown={(event) => captureShortcut(event, id)}
        />
      </label>
    {/each}
  </section>

  <section class="settings-section">
    <div class="section-heading">
      <div>
        <h3>C++ 工具链</h3>
        <p>用于编译、调试和代码智能功能。</p>
      </div>
      <button class="secondary-button compact-button" disabled={checkingToolchain} onclick={() => void refreshToolchain()}>
        {checkingToolchain ? "检查中…" : "重新检查"}
      </button>
    </div>

    <div class="toolchain-status" aria-label="C++ 工具链状态">
      {#each toolRows as row}
        <div class:available={row.tool?.available} class:missing={row.tool && !row.tool.available} class="tool-status-item">
          <span class="tool-status-dot" aria-hidden="true"></span>
          <strong>{row.label}</strong>
          <span>{toolLabel(row.tool)}</span>
          {#if row.tool?.resolvedPath}<small title={row.tool.resolvedPath}>{row.tool.resolvedPath}</small>{/if}
        </div>
      {/each}
    </div>
    {#if toolchainError}<p class="settings-error">工具链检查失败：{toolchainError}</p>{/if}

    <label class="setting-row vertical">
      <span class="setting-label">编译器路径</span>
      <input
        class="text-input"
        value={settings.value.compilerPath}
        placeholder="g++ 或 C:\mingw64\bin\g++.exe"
        oninput={(event) => settings.update({ compilerPath: event.currentTarget.value })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="setting-label">GDB 路径</span>
      <input
        class="text-input"
        value={settings.value.gdbPath}
        placeholder="gdb 或 C:\mingw64\bin\gdb.exe"
        oninput={(event) => settings.update({ gdbPath: event.currentTarget.value })}
      />
      <span class="setting-hint">图形化调试使用 GDB/MI。找不到 GDB 时请填写 gdb.exe 的完整路径。</span>
    </label>

    <label class="setting-row vertical">
      <span class="setting-label">clangd 路径</span>
      <input
        class="text-input"
        value={settings.value.clangdPath}
        placeholder="自动查找，或 C:\Program Files\LLVM\bin\clangd.exe"
        oninput={(event) => settings.update({ clangdPath: event.currentTarget.value })}
      />
      <span class="setting-hint">留空时从 PATH、LLVM 和 Visual Studio 2022 的标准目录查找；修改后会为当前工作区重新连接。</span>
    </label>

    <label class="setting-row vertical">
      <span class="setting-label">C++ 标准</span>
      <select
        class="text-input"
        value={settings.value.compilerStandard}
        onchange={(event) => settings.update({ compilerStandard: event.currentTarget.value })}
      >
        <option value="c++17">C++17</option>
        <option value="c++20">C++20</option>
        <option value="c++23">C++23</option>
      </select>
    </label>

    <label class="setting-row vertical">
      <span class="setting-label">发布模式参数</span>
      <input
        class="text-input"
        value={settings.value.releaseArgs.join(" ")}
        oninput={(event) => settings.update({ releaseArgs: parseArguments(event.currentTarget.value) })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="setting-label">调试模式参数</span>
      <input
        class="text-input"
        value={settings.value.debugArgs.join(" ")}
        oninput={(event) => settings.update({ debugArgs: parseArguments(event.currentTarget.value) })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>运行超时</span><output>{settings.value.runTimeoutMs} 毫秒</output></span>
      <input
        type="range"
        min="100"
        max="10000"
        step="100"
        value={settings.value.runTimeoutMs}
        oninput={(event) => settings.update({ runTimeoutMs: Number(event.currentTarget.value) })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="setting-label">最大输出捕获量</span>
      <select
        class="text-input"
        value={settings.value.maxOutputBytes}
        onchange={(event) => settings.update({ maxOutputBytes: Number(event.currentTarget.value) })}
      >
        <option value={512 * 1024}>512 KiB</option>
        <option value={2 * 1024 * 1024}>2 MiB</option>
        <option value={8 * 1024 * 1024}>8 MiB</option>
        <option value={16 * 1024 * 1024}>16 MiB</option>
      </select>
    </label>
  </section>

  <section class="settings-section">
    <label class="toggle-row">
      <span>
        <strong>性能模式</strong>
        <small>关闭过渡动画和非必要阴影，降低低配置设备的绘制负担。</small>
      </span>
      <input
        type="checkbox"
        checked={settings.value.performanceMode}
        onchange={(event) => settings.update({ performanceMode: event.currentTarget.checked })}
      />
    </label>
  </section>

  {#if settings.errorMessage}
    <p class="settings-error">{settings.errorMessage}</p>
  {/if}

  <button class="secondary-button reset-settings" onclick={() => settings.reset()}>
    恢复默认设置
  </button>
</div>
