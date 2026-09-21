<script lang="ts">
  import Icon from "../shell/Icon.svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { GeneratorStore } from "../../stores/generator.svelte";
  import type { StressStore } from "../../stores/stress.svelte";

  interface Props {
    stress: StressStore;
    generator: GeneratorStore;
    workspace: EditorWorkspace;
  }

  let { stress, generator, workspace }: Props = $props();
  let activeSource = $derived(workspace.activeTab?.path ?? "");
  let startHint = $derived(
    !activeSource.toLowerCase().endsWith(".cpp") ? "先从文件列表打开待测的 C++ 程序。"
      : !stress.brutePath ? "选择一个答案正确的暴力程序，用来比较输出。"
      : generator.loading ? "正在加载输入格式…"
      : !generator.valid ? "输入格式有误，请先修改生成规则。"
      : "",
  );

  const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
  const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(milliseconds >= 10_000 ? 1 : 2);

  function statusLabel(): string {
    if (stress.status === "idle") return "等待开始";
    if (stress.status === "compiling") return "正在编译";
    if (stress.status === "running") return "正在运行";
    if (stress.status === "failed") return "发现失败用例";
    if (stress.status === "stopped") return "已停止";
    if (stress.status === "completed") return "已完成";
    return "发生错误";
  }
</script>

<main class="stress-center">
  <header class="stress-page-header">
    <div>
      <h1>对拍</h1>
      <p>用相同的随机输入运行两个程序，找出答案不一致的用例。</p>
    </div>
    <div class="stress-header-state" class:failed={stress.status === "failed"} class:running={stress.running}>
      <strong>{statusLabel()}</strong>
      <span>{stress.message || "配置后即可开始"}</span>
    </div>
  </header>

  <section class="stress-config" aria-label="对拍配置">
    <div class="stress-source-card generator">
      <span>数据生成器</span>
      <strong>随机输入格式</strong>
      <small>{generator.nodes.length} 条规则 · {generator.valid ? "可生成数据" : `${generator.diagnostics.length} 处待修改`}</small>
      <button class="secondary-button" disabled={stress.running} onclick={() => stress.openGenerator()}>修改格式</button>
    </div>
    <div class="stress-source-card">
      <span>待测程序</span>
      <strong title={activeSource}>{activeSource ? fileName(activeSource) : "未选择"}</strong>
      <small title={activeSource}>{activeSource || "打开要检查的 C++ 文件"}</small>
    </div>
    <div class="stress-source-card">
      <span>暴力程序（参考答案）</span>
      <strong title={stress.brutePath}>{stress.brutePath ? fileName(stress.brutePath) : "未选择"}</strong>
      <small title={stress.brutePath}>{stress.brutePath || "选择能得到正确答案的程序"}</small>
      <button class="secondary-button" disabled={stress.running} onclick={() => void stress.chooseBrute()}>选择文件</button>
    </div>

    <div class="stress-options">
      <label>
        <span>测试组数</span>
        <input type="number" min="1" max="10000000" disabled={stress.infinite || stress.running} bind:value={stress.iterations} />
      </label>
      <label class="stress-infinite">
        <input type="checkbox" disabled={stress.running} bind:checked={stress.infinite} />
        <span>不限组数，直到手动停止</span>
      </label>
    </div>
    <details class="stress-advanced">
      <summary>更多设置<span>随机种子与超时</span></summary>
      <div class="stress-options">
      <label class="stress-seed">
        <span>随机种子</span>
        <div>
          <input inputmode="numeric" disabled={stress.running} bind:value={stress.seed} />
          <button title="换一个随机种子" aria-label="换一个随机种子" disabled={stress.running} onclick={() => stress.randomizeSeed()}><Icon name="refresh" size={14} /></button>
        </div>
      </label>
      <label>
        <span>单程序超时</span>
        <div class="stress-timeout"><input type="number" min="50" max="60000" step="50" disabled={stress.running} bind:value={stress.timeoutMs} /><em>ms</em></div>
      </label>
      </div>
    </details>

    <div class="stress-actions">
      {#if startHint && !stress.running}<span class="stress-start-hint">{startHint}</span>{/if}
      {#if stress.running}
        <button class="stress-stop" disabled={stress.stopping} onclick={() => void stress.stop()}>{stress.stopping ? "正在停止…" : "停止"}</button>
      {:else}
        <button class="primary-button" disabled={Boolean(startHint)} onclick={() => void stress.start()}>开始对拍</button>
      {/if}
      <button class="secondary-button" disabled={stress.running || (!stress.logs.length && !stress.failure)} onclick={() => stress.clear()}>清空结果</button>
    </div>
  </section>

  <section class="stress-stats" aria-label="对拍统计">
    <div><span>总用例</span><strong>{stress.stats.totalCases}</strong></div>
    <div><span>通过</span><strong class="success">{stress.stats.passed}</strong></div>
    <div><span>失败</span><strong class="failure">{stress.stats.failed}</strong></div>
    <div><span>耗时</span><strong>{seconds(stress.stats.elapsedMs)}s</strong></div>
    <div><span>速度</span><strong>{stress.stats.casesPerSecond.toFixed(2)}<small> 组/秒</small></strong></div>
  </section>

  <div class="stress-content-grid" class:with-failure={Boolean(stress.failure)}>
    <section class="stress-log-panel">
      <header><div><h2>运行记录</h2></div><strong>{stress.logs.length} 条</strong></header>
      <div class="stress-log" aria-live="polite">
        {#each stress.logs as entry (`${entry.index}-${entry.seed}-${entry.status}`)}
          <div class:failed={entry.status === "FAILED"} class="stress-log-row">
            <strong>#{entry.index}</strong>
            <span class="stress-log-status">{entry.status === "AC" ? "AC" : "失败"}</span>
            <code>种子 {entry.seed}</code>
            {#if entry.status === "AC"}
              <small>S {entry.solutionTimeMs}ms · B {entry.bruteTimeMs}ms</small>
            {:else}
              <small>{entry.reason}</small>
            {/if}
          </div>
        {/each}
        {#if !stress.logs.length}
          <div class="stress-log-empty">开始对拍后，这里会显示每组数据的结果。发现答案不一致时会自动停止。</div>
        {/if}
      </div>
    </section>

    {#if stress.failure}
      <section class="stress-failure-panel">
        <header>
          <div><span>失败 #{stress.failure.index}</span><h2>{stress.failure.reason}</h2></div>
          <code>种子 {stress.failure.seed}</code>
        </header>
        <div class="stress-failure-actions">
          <button class="primary-button" onclick={() => void stress.saveFailureAsTestcase()}>保存为测试点</button>
          <button class="secondary-button" disabled={stress.running} onclick={() => void stress.debugFailure()}>调试此用例</button>
          <button class="secondary-button" onclick={() => void stress.copyFailureInput()}>复制输入</button>
          <button class="secondary-button" disabled={stress.running || (!stress.infinite && stress.failure.index >= stress.iterations)} onclick={() => void stress.continueAfterFailure()}>继续对拍</button>
        </div>
        <div class="stress-failure-meta">
          <span>待测程序：{stress.failure.solutionTimeMs}ms{stress.failure.solutionExitCode === undefined ? "" : ` · 退出码 ${stress.failure.solutionExitCode}`}</span>
          <span>暴力程序：{stress.failure.bruteTimeMs}ms{stress.failure.bruteExitCode === undefined ? "" : ` · 退出码 ${stress.failure.bruteExitCode}`}</span>
        </div>
        <div class="stress-artifacts">
          <label><span>输入</span><textarea readonly value={stress.failure.input}></textarea></label>
          <label><span>待测程序输出</span><textarea readonly value={stress.failure.solutionOutput}></textarea></label>
          <label><span>暴力程序输出</span><textarea readonly value={stress.failure.bruteOutput}></textarea></label>
          {#if stress.failure.solutionStderr || stress.failure.bruteStderr}
            <label class="stderr"><span>错误输出</span><textarea readonly value={`待测程序：\n${stress.failure.solutionStderr}\n\n暴力程序：\n${stress.failure.bruteStderr}`}></textarea></label>
          {/if}
        </div>
      </section>
    {/if}
  </div>

  {#if stress.error}<p class="stress-error" role="alert">{stress.error}</p>{/if}
  {#if stress.notice}<p class="stress-notice" aria-live="polite">{stress.notice}</p>{/if}
</main>
