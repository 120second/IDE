<script lang="ts">
  import type { SettingsStore } from "../../stores/settings.svelte";
  import {
    APPEARANCE_PRESETS,
    backgroundImageUrl,
    type AppearancePresetId,
  } from "../../stores/settings.svelte";
  import { chooseBackgroundImage } from "../../api/appearance";
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
  }

  let { settings }: Props = $props();

  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const parseArguments = (value: string) => value.split(/\s+/).map((argument) => argument.trim()).filter(Boolean);
  let conflicts = $derived(shortcutConflicts(settings.value.keybindings));
  let choosingBackground = $state(false);
  let loadedBackground = $state("");
  let failedBackground = $state("");
  let backgroundPickerError = $state("");
  let previewUrl = $derived(backgroundImageUrl(settings.value.backgroundImage));
  let toolchain = $state<ToolchainStatus>();
  let checkingToolchain = $state(false);
  let toolchainError = $state("");
  let diagnosticRequest = 0;
  let toolRows = $derived<{ label: string; tool: ToolStatus | undefined }[]>([
    { label: "编译", tool: toolchain?.compiler },
    { label: "调试", tool: toolchain?.debugger },
    { label: "智能提示", tool: toolchain?.languageServer },
  ]);

  const appearancePresets: { id: AppearancePresetId; label: string }[] = [
    { id: "solid", label: "不透明" },
    { id: "balanced", label: "毛玻璃" },
    { id: "glass", label: "透明" },
  ];

  function presetActive(id: AppearancePresetId): boolean {
    const preset = APPEARANCE_PRESETS[id];
    return Math.abs(settings.value.backgroundOpacity - preset.backgroundOpacity) < 0.001
      && settings.value.backgroundEffect === preset.backgroundEffect
      && Math.abs(settings.value.windowOpacity - preset.windowOpacity) < 0.001
      && Math.abs(settings.value.sidebarOpacity - preset.sidebarOpacity) < 0.001
      && Math.abs(settings.value.editorOpacity - preset.editorOpacity) < 0.001
      && Math.abs(settings.value.blur - preset.blur) < 0.001;
  }

  async function browseBackground(): Promise<void> {
    if (choosingBackground) return;
    choosingBackground = true;
    backgroundPickerError = "";
    try {
      const selected = await chooseBackgroundImage();
      if (selected) settings.update({ backgroundImage: selected });
    } catch (error) {
      backgroundPickerError = error instanceof Error ? error.message : String(error);
    } finally {
      choosingBackground = false;
    }
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

    <div class="setting-row vertical">
      <span class="setting-label">外观预设</span>
      <div class="segmented appearance-presets" aria-label="外观预设">
        {#each appearancePresets as preset}
          <button
            class:active={presetActive(preset.id)}
            onclick={() => settings.applyAppearancePreset(preset.id)}>{preset.label}</button
          >
        {/each}
      </div>
      <span class="setting-hint">“透明”保留桌面细节；“毛玻璃”会使用 Windows Acrylic 强模糊。</span>
    </div>

    <div class="setting-row vertical">
      <span class="setting-label">主题</span>
      <div class="segmented" aria-label="主题">
        <button
          class:active={settings.value.theme === "dark"}
          onclick={() => settings.update({ theme: "dark" })}>深色</button
        >
        <button
          class:active={settings.value.theme === "light"}
          onclick={() => settings.update({ theme: "light" })}>浅色</button
        >
      </div>
    </div>

    <div class="setting-row vertical">
      <span class="setting-label">背景图片路径</span>
      <div class="background-input-row">
        <input
          class="text-input"
          aria-label="背景图片路径"
          value={settings.value.backgroundImage}
          placeholder="本地图片路径或 HTTPS 地址"
          oninput={(event) => {
            backgroundPickerError = "";
            settings.update({ backgroundImage: event.currentTarget.value });
          }}
        />
        <button class="secondary-button" disabled={choosingBackground} onclick={() => void browseBackground()}>
          {choosingBackground ? "选择中…" : "浏览"}
        </button>
        <button
          class="secondary-button"
          disabled={!settings.value.backgroundImage}
          onclick={() => {
            backgroundPickerError = "";
            settings.update({ backgroundImage: "" });
          }}>清除</button
        >
      </div>
      <span
        class:failed={(Boolean(settings.value.backgroundImage) && failedBackground === settings.value.backgroundImage) || Boolean(backgroundPickerError)}
        class="background-image-state"
      >
        {#if previewUrl}
          {#key previewUrl}
            <img
              class="background-image-probe"
              src={previewUrl}
              alt=""
              aria-hidden="true"
              onload={() => { loadedBackground = settings.value.backgroundImage; failedBackground = ""; }}
              onerror={() => { failedBackground = settings.value.backgroundImage; loadedBackground = ""; }}
            />
          {/key}
        {/if}
        {#if backgroundPickerError}
          选择失败：{backgroundPickerError}
        {:else if !settings.value.backgroundImage}
          未设置背景图片
        {:else if failedBackground === settings.value.backgroundImage}
          图片无法加载；本地图片需位于 Windows 用户目录内
        {:else if loadedBackground === settings.value.backgroundImage}
          图片已加载
        {:else}
          正在检查图片…
        {/if}
      </span>
      <span class="setting-hint">支持用户目录内的 PNG、JPG、WebP、GIF、BMP、SVG，或 HTTPS 图片地址。</span>
    </div>

    <label class="setting-row vertical">
      <span class="range-heading"><span>背景图片可见度</span><output>{percent(settings.value.backgroundOpacity)}</output></span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={settings.value.backgroundOpacity}
        oninput={(event) => settings.update({ backgroundOpacity: Number(event.currentTarget.value) })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>窗口底色不透明度</span><output>{percent(settings.value.windowOpacity)}</output></span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={settings.value.windowOpacity}
        oninput={(event) => settings.update({ windowOpacity: Number(event.currentTarget.value) })}
      />
      <span class="setting-hint">数值越低，桌面透出越明显；设为 0% 时不再叠加窗口底色。</span>
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>侧栏不透明度</span><output>{percent(settings.value.sidebarOpacity)}</output></span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={settings.value.sidebarOpacity}
        oninput={(event) => settings.update({ sidebarOpacity: Number(event.currentTarget.value) })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>编辑区不透明度</span><output>{percent(settings.value.editorOpacity)}</output></span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={settings.value.editorOpacity}
        oninput={(event) => settings.update({ editorOpacity: Number(event.currentTarget.value) })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>界面模糊</span><output>{Math.round(settings.value.blur)}px</output></span>
      <input
        type="range"
        min="0"
        max="24"
        step="1"
        value={settings.value.blur}
        disabled={settings.value.performanceMode}
        oninput={(event) => settings.update({ blur: Number(event.currentTarget.value) })}
      />
    </label>

    <button class="secondary-button reset-appearance" onclick={() => settings.resetAppearance()}>
      恢复默认外观
    </button>
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
    <div class="section-heading">
      <div>
        <h3>编辑器字体</h3>
        <p>适合长时间竞赛使用。</p>
      </div>
    </div>

    <label class="setting-row vertical">
      <span class="setting-label">字体</span>
      <input
        class="text-input"
        value={settings.value.fontFamily}
        oninput={(event) => settings.update({ fontFamily: event.currentTarget.value })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>字号</span><output>{settings.value.fontSize.toFixed(0)}px</output></span>
      <input
        type="range"
        min="11"
        max="24"
        step="1"
        value={settings.value.fontSize}
        oninput={(event) => settings.update({ fontSize: Number(event.currentTarget.value) })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>行高</span><output>{settings.value.lineHeight.toFixed(2)}</output></span>
      <input
        type="range"
        min="1.2"
        max="2"
        step="0.02"
        value={settings.value.lineHeight}
        oninput={(event) => settings.update({ lineHeight: Number(event.currentTarget.value) })}
      />
    </label>
  </section>

  <section class="settings-section">
    <label class="toggle-row">
      <span>
        <strong>性能模式</strong>
        <small>关闭系统毛玻璃、界面模糊、过渡动画和装饰效果。</small>
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
