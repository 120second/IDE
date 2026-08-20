<script lang="ts">
  import { untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { DebugStore } from "../../stores/debug.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { Testcase } from "../../types/execution";
  import VariableTree from "./VariableTree.svelte";

  interface Props {
    debug: DebugStore;
    execution: ExecutionStore;
    workspace: EditorWorkspace;
  }

  let { debug, execution, workspace }: Props = $props();
  let selectedTestcaseId = $state<number>();
  let watchDraft = $state("");
  let observedSource = "";
  let selectedTestcase = $derived(
    execution.testcases.find((testcase) => testcase.id === selectedTestcaseId)
      ?? execution.testcases.find((testcase) => testcase.enabled)
      ?? execution.testcases[0],
  );

  $effect(() => {
    const sourcePath = workspace.activeTab?.path ?? "";
    if (sourcePath === observedSource) return;
    observedSource = sourcePath;
    untrack(() => void execution.syncActiveSource(sourcePath, true));
  });

  function addWatch(): void {
    debug.addWatch(watchDraft);
    watchDraft = "";
  }

  function breakpointName(file: string): string {
    return file.split(/[\\/]/).pop() ?? file;
  }

  function stateLabel(): string {
    if (debug.state === "idle") return "未启动";
    if (debug.state === "starting") return "正在启动";
    if (debug.state === "running") return "运行中";
    if (debug.state === "stopped") return "已暂停";
    if (debug.state === "exited") return "已退出";
    return "错误";
  }

  function debugTestcase(testcase: Testcase | undefined): void {
    if (testcase) void debug.startTestcase(testcase);
  }
</script>

<div class="debug-panel">
  <div class="debug-launch">
    <button class="primary-button" disabled={debug.active || debug.busy || execution.compiling} onclick={() => void debug.startCurrent()}>
      调试当前文件
    </button>
    <div class="debug-testcase-launch">
      <select aria-label="选择调试测试点" disabled={debug.active || execution.testcases.length === 0} bind:value={selectedTestcaseId}>
        {#each execution.testcases as testcase (testcase.id)}
          <option value={testcase.id}>{testcase.name}</option>
        {/each}
      </select>
      <button disabled={debug.active || debug.busy || !selectedTestcase} onclick={() => debugTestcase(selectedTestcase)}>调试测试点</button>
    </div>
  </div>

  <div class="debug-status" class:error={debug.state === "error"}>
    <strong>{stateLabel()}</strong>
    <span>{debug.reason || "在编辑器行号左侧点击可设置断点。"}</span>
  </div>

  {#if debug.active}
    <div class="debug-controls" aria-label="调试控制">
      {#if debug.state === "running"}
        <button title="暂停" disabled={debug.busy} onclick={() => void debug.pause()}>Ⅱ<span>暂停</span></button>
      {:else}
        <button title="继续" disabled={debug.busy || !debug.stopped} onclick={() => void debug.continueExecution()}>▶<span>继续</span></button>
      {/if}
      <button title="单步跳过" disabled={debug.busy || !debug.stopped} onclick={() => void debug.stepOver()}>↷<span>跳过</span></button>
      <button title="单步进入" disabled={debug.busy || !debug.stopped} onclick={() => void debug.stepInto()}>↓<span>进入</span></button>
      <button title="单步跳出" disabled={debug.busy || !debug.stopped} onclick={() => void debug.stepOut()}>↑<span>跳出</span></button>
      <button title="重新启动" disabled={debug.busy} onclick={() => void debug.restart()}>↻<span>重启</span></button>
      <button class="danger" title="停止调试" disabled={debug.busy} onclick={() => void debug.stop()}>■<span>停止</span></button>
    </div>
  {/if}

  <section class="debug-section">
    <header><h3>变量</h3><span>{debug.stopped ? `${debug.variables.length} 个局部变量` : "暂停后刷新"}</span></header>
    {#if debug.stopped && debug.variables.length}
      <VariableTree {debug} variables={debug.variables} />
    {:else}
      <p class="debug-empty">{debug.state === "running" ? "程序运行时不读取变量。" : "暂停在断点后显示局部变量。"}</p>
    {/if}
  </section>

  <section class="debug-section">
    <header><h3>监视</h3><span>{debug.watches.length}</span></header>
    <form class="debug-watch-form" onsubmit={(event) => { event.preventDefault(); addWatch(); }}>
      <input bind:value={watchDraft} placeholder="输入表达式，例如 a[i]" aria-label="监视表达式" />
      <button aria-label="添加监视">+</button>
    </form>
    <div class="debug-watch-list">
      {#each debug.watches as watch (watch.id)}
        <div class="debug-watch-row">
          <span title={watch.expression}>{watch.expression}</span>
          <code class:error={Boolean(watch.error)} title={watch.error || watch.value}>{watch.error ? "<错误>" : watch.value || (debug.stopped ? "<无值>" : "—")}</code>
          <button aria-label={`删除监视 ${watch.expression}`} onclick={() => debug.removeWatch(watch.id)}>×</button>
        </div>
      {/each}
    </div>
  </section>

  <section class="debug-section">
    <header><h3>调用栈</h3><span>{debug.frames.length}</span></header>
    <div class="debug-frame-list">
      {#each debug.frames as frame (frame.level)}
        <button class:active={frame.level === debug.selectedFrame} onclick={() => void debug.selectFrame(frame.level)}>
          <strong>{frame.function}</strong>
          <small>{frame.file || "未知文件"}{frame.line ? `:${frame.line}` : ""}</small>
        </button>
      {/each}
      {#if !debug.frames.length}<p class="debug-empty">暂停后显示调用栈。</p>{/if}
    </div>
  </section>

  <section class="debug-section">
    <header><h3>断点</h3><span>{debug.breakpoints.length}</span></header>
    <div class="debug-breakpoint-list">
      {#each debug.breakpoints as breakpoint (breakpoint.id)}
        <div class="debug-breakpoint-row" class:unverified={debug.active && breakpoint.enabled && !breakpoint.verified}>
          <label title={breakpoint.file}>
            <input type="checkbox" checked={breakpoint.enabled} onchange={(event) => void debug.updateBreakpoint(breakpoint.id, { enabled: event.currentTarget.checked })} />
            <span>{breakpointName(breakpoint.file)}:{breakpoint.line}</span>
          </label>
          <button aria-label="删除断点" onclick={() => void debug.toggleBreakpoint(breakpoint.file, breakpoint.line)}>×</button>
          <input
            class="debug-condition"
            value={breakpoint.condition}
            placeholder="条件，例如 i == 514"
            title={breakpoint.message || "条件断点"}
            onchange={(event) => void debug.updateBreakpoint(breakpoint.id, { condition: event.currentTarget.value.trim() })}
          />
          {#if breakpoint.message}<small>{breakpoint.message}</small>{/if}
        </div>
      {/each}
      {#if !debug.breakpoints.length}<p class="debug-empty">点击编辑器行号左侧的圆点区域添加断点。</p>{/if}
    </div>
  </section>

  {#if debug.error}<p class="debug-error" role="alert">{debug.error}</p>{/if}
</div>
