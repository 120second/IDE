<script lang="ts">
  import type { SettingsStore } from "../../stores/settings.svelte";
  import type { InterfaceStyle } from "../../types/settings";
  let { settings }: { settings: SettingsStore } = $props();
  let transparencyPercent = $derived(Math.round(settings.value.sublimeTransparency * 100));
  function changeTransparency(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) settings.update({ sublimeTransparency: value / 100 });
  }
</script>

<div class="interface-style-picker appearance-block">
  <div class="appearance-block-heading"><strong>界面风格</strong><span>随时切换工作台布局，代码和测试数据继续保留。</span></div>
  <div class="style-options" role="group" aria-label="界面风格">
    {#each [{ id: "lightcp", title: "LightCP", detail: "保留当前界面" }, { id: "classic", title: "经典 IDE", detail: "灰色面板 · 蓝色强调 · 顶部菜单" }, { id: "sublime", title: "Sublime 风格", detail: "黑灰半透明 · 文件树 · 右侧测试点 / 题面" }] as style}
      <button class:active={settings.value.interfaceStyle === style.id} aria-pressed={settings.value.interfaceStyle === style.id} onclick={() => settings.update({ interfaceStyle: style.id as InterfaceStyle })}>
        <span class="mini-window" class:classic={style.id === "classic"} class:sublime={style.id === "sublime"} aria-hidden="true"><i class="mini-title"></i><i class="mini-activity"></i><i class="mini-sidebar"></i><i class="mini-tab"></i><i class="mini-code"></i></span>
        <span><strong>{style.title}</strong><small>{style.detail}</small></span>
        <span class="selection-dot" aria-hidden="true"></span>
      </button>
    {/each}
  </div>
  {#if settings.value.interfaceStyle === "sublime"}
    <section class="window-transparency" aria-label="Sublime 整体透明度设置">
      <div class="transparency-heading"><label for="sublime-transparency">整体透明度</label><div class="transparency-value"><input type="number" aria-label="整体透明度百分比" min="0" max="100" step="1" value={transparencyPercent} oninput={changeTransparency}/><span>%</span></div></div>
      <input id="sublime-transparency" class="transparency-slider" type="range" min="0" max="100" step="1" value={transparencyPercent} oninput={changeTransparency} aria-valuetext={`${transparencyPercent}% 透明度`}/>
      <div class="transparency-endpoints"><span>不透明</span><span>更透明</span></div>
      <p>拖动立即预览，自动保存。统一调整窗口背景，文字保持清晰。</p>
      <div class="transparency-presets"><button onclick={() => settings.update({ sublimeTransparency: 0 })}>完全不透明</button><button onclick={() => settings.update({ sublimeTransparency: 0.03 })}>恢复默认 3%</button></div>
    </section>
  {/if}
  <label class="testcase-style-label"><span>测试框风格</span>
    <select aria-label="测试框风格" disabled={settings.value.interfaceStyle === "sublime"} value={settings.value.testcaseStyle} onchange={(event) => settings.update({ testcaseStyle: event.currentTarget.value as "follow" | "standard" | "compact" })}>
      <option value="follow">跟随界面</option><option value="standard">LightCP 标准</option><option value="compact">经典紧凑双栏</option>
    </select>
  </label>
  <p>{settings.value.interfaceStyle === "sublime" ? "Sublime 使用右侧 CPH 风格测试面板。测试框选择会保留，切换回其他界面后继续生效。" : "经典 IDE 默认使用紧凑双栏测试框，也可以单独选择。"}编辑器配色设为“跟随界面主题”时使用对应风格的代码配色。</p>
</div>

<style>
  .window-transparency { display: grid; gap: 9px; padding: 14px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-sunken); }
  .transparency-heading, .transparency-value, .transparency-endpoints, .transparency-presets { display: flex; align-items: center; }
  .transparency-heading, .transparency-endpoints { justify-content: space-between; }
  .transparency-heading > label { font-size: 13px; font-weight: 600; }
  .transparency-value { gap: 5px; font-size: 12px; }
  .transparency-value input { width: 64px; height: 29px; padding: 3px 6px; border: 1px solid var(--border-strong); border-radius: 3px; background: var(--input-background); color: var(--text-primary); }
  .transparency-slider { display: block; width: 100%; height: 24px; padding: 0; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .transparency-endpoints { color: var(--text-muted); font-size: 11px; }
  .transparency-presets { gap: 8px; flex-wrap: wrap; }
  .transparency-presets button { padding: 4px 9px; border: 1px solid var(--border-strong); border-radius: 3px; background: var(--surface); color: var(--text-secondary); font-size: 12px; cursor: pointer; }
  .transparency-presets button:hover { background: var(--hover-background); color: var(--text-primary); }
  .style-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 10px; }
  .style-options > button { position: relative; display: grid; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 7px; text-align: left; color: var(--text-primary); background: var(--surface); transition: border-color 100ms ease, background-color 100ms ease; }
  .style-options > button.active { border-color: var(--accent); background: var(--accent-soft); }
  .style-options strong { display: block; font-size: 13px; } small, p { color: var(--text-secondary); font-size: 12px; line-height: 1.6; } p { margin: 0; }
  .selection-dot { position: absolute; right: 10px; bottom: 30px; width: 10px; height: 10px; border: 1px solid var(--border-strong); border-radius: 50%; }
  .active .selection-dot { border: 3px solid var(--accent); background: var(--accent-contrast); }
  .mini-window { position: relative; height: 80px; border: 1px solid #485064; border-radius: 3px; background: #161c28; overflow: hidden; }
  .mini-window i { position: absolute; display: block; }
  .mini-title { inset: 0 0 auto; height: 8px; background: #293345; }
  .mini-activity { top: 8px; bottom: 0; width: 14px; background: #202a3c; }
  .mini-sidebar { top: 8px; bottom: 0; left: 14px; width: 40px; background: #273144; }
  .mini-tab { top: 8px; left: 54px; width: 35px; height: 9px; background: #374963; border-bottom: 2px solid #72a6ef; }
  .mini-code { top: 26px; left: 62px; width: 50%; height: 24px; background: repeating-linear-gradient(0deg, transparent 0 5px, #8197bc 5px 7px); opacity: .6; }
  .classic { background: #24252a; } .classic .mini-title { height: 14px; background: #36373c; } .classic .mini-activity { top: 14px; width: 17px; background: #303137; }
  .classic .mini-sidebar { top: 14px; left: 17px; width: 48px; background: #393a40; } .classic .mini-tab { top: 14px; left: 65px; border-color: #007acc; background: #3f414a; } .classic .mini-code { left: 74px; }
  .sublime { background: #242622; border-color: #5f6558; } .sublime .mini-title { background: #232520; } .sublime .mini-activity { display: none; } .sublime .mini-sidebar { left: 0; width: 36px; background: #20221f; } .sublime .mini-tab { left: 36px; background: #34362f; border-color: #a6ad91; } .sublime .mini-code { left: 43px; background: repeating-linear-gradient(0deg, transparent 0 5px, #d47a97 5px 7px); }
  .testcase-style-label { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
  select { min-height: 32px; border: 1px solid var(--border-strong); border-radius: 4px; padding: 4px 8px; color: var(--text-primary); background: var(--input-background); }
  @media (prefers-reduced-motion: reduce) { .style-options > button { transition: none; } }
</style>
