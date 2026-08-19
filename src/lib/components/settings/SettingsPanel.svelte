<script lang="ts">
  import type { SettingsStore } from "../../stores/settings.svelte";

  interface Props {
    settings: SettingsStore;
  }

  let { settings }: Props = $props();

  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const parseArguments = (value: string) => value.split(/\s+/).map((argument) => argument.trim()).filter(Boolean);
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

    <label class="setting-row vertical">
      <span class="setting-label">背景图片路径</span>
      <input
        class="text-input"
        value={settings.value.backgroundImage}
        placeholder="C:\用户\你的用户名\图片\background.jpg"
        oninput={(event) => settings.update({ backgroundImage: event.currentTarget.value })}
      />
      <span class="setting-hint">支持用户目录内的绝对路径或 HTTPS 图片地址。</span>
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>背景透明度</span><output>{percent(settings.value.backgroundOpacity)}</output></span>
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
      <span class="range-heading"><span>侧栏透明度</span><output>{percent(settings.value.sidebarOpacity)}</output></span>
      <input
        type="range"
        min="0.5"
        max="1"
        step="0.01"
        value={settings.value.sidebarOpacity}
        oninput={(event) => settings.update({ sidebarOpacity: Number(event.currentTarget.value) })}
      />
    </label>

    <label class="setting-row vertical">
      <span class="range-heading"><span>编辑器透明度</span><output>{percent(settings.value.editorOpacity)}</output></span>
      <input
        type="range"
        min="0.75"
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
  </section>

  <section class="settings-section">
    <div class="section-heading">
      <div>
        <h3>C++ 工具链</h3>
        <p>用于编译当前文件和运行测试点。</p>
      </div>
    </div>

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
        <small>关闭模糊、过渡动画和装饰效果。</small>
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
