<script lang="ts">
  import type { SettingsStore } from "../../stores/settings.svelte";
  let { settings }: { settings: SettingsStore } = $props();
</script>

<div class="interface-style-picker appearance-block">
  <div class="appearance-block-heading"><strong>界面风格</strong><span>随时切换工作台布局，代码和测试数据继续保留。</span></div>
  <div class="style-options" role="group" aria-label="界面风格">
    {#each [{ id: "lightcp", title: "LightCP", detail: "保留当前界面" }, { id: "classic", title: "经典 IDE", detail: "灰色面板 · 蓝色强调 · 顶部菜单" }] as style}
      <button class:active={settings.value.interfaceStyle === style.id} aria-pressed={settings.value.interfaceStyle === style.id} onclick={() => settings.update({ interfaceStyle: style.id as "lightcp" | "classic" })}>
        <span class="mini-window" class:classic={style.id === "classic"} aria-hidden="true"><i class="mini-title"></i><i class="mini-activity"></i><i class="mini-sidebar"></i><i class="mini-tab"></i><i class="mini-code"></i></span>
        <span><strong>{style.title}</strong><small>{style.detail}</small></span>
        <span class="selection-dot" aria-hidden="true"></span>
      </button>
    {/each}
  </div>
  <label class="testcase-style-label"><span>测试框风格</span>
    <select aria-label="测试框风格" value={settings.value.testcaseStyle} onchange={(event) => settings.update({ testcaseStyle: event.currentTarget.value as "follow" | "standard" | "compact" })}>
      <option value="follow">跟随界面</option><option value="standard">LightCP 标准</option><option value="compact">经典紧凑双栏</option>
    </select>
  </label>
  <p>经典界面默认使用紧凑双栏测试框，也可以单独选择。</p>
</div>

<style>
  .style-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
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
  .testcase-style-label { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
  select { min-height: 32px; border: 1px solid var(--border-strong); border-radius: 4px; padding: 4px 8px; color: var(--text-primary); background: var(--input-background); }
  @media (prefers-reduced-motion: reduce) { .style-options > button { transition: none; } }
</style>
