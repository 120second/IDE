<script lang="ts">
  import { untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { DebugStore } from "../../stores/debug.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { Testcase } from "../../types/execution";
  import Icon from "../shell/Icon.svelte";
  import VariableTree from "./VariableTree.svelte";

  interface Props {
    debug: DebugStore;
    execution: ExecutionStore;
    workspace: EditorWorkspace;
  }

  let { debug, execution, workspace }: Props = $props();
  let selectedTestcaseId = $state<number>();
  let watchDraft = $state("");
  let stdinDraft = $state("");
  let observedSource = "";
  let selectedTestcase = $derived(
    execution.testcases.find((testcase) => testcase.id === selectedTestcaseId)
      ?? execution.testcases.find((testcase) => testcase.enabled)
      ?? execution.testcases[0],
  );
  let enabledBreakpointCount = $derived(debug.breakpoints.filter((breakpoint) => breakpoint.enabled).length);
  let stdinLineCount = $derived(stdinDraft ? stdinDraft.split(/\r?\n/).length : 0);
  let canStep = $derived(
    !debug.busy
      && !debug.pendingStep
      && (debug.state === "running" || debug.state === "stopped"),
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

  function stateMessage(): string {
    if (debug.pendingStep) return "正在自动暂停，随后执行单步操作…";
    if (debug.state === "running") return `${debug.reason || "程序正在运行"}；可直接点击单步按钮。`;
    return debug.reason || "在编辑器行号左侧点击可设置断点。";
  }

  function stepTitle(label: string, shortcut: string): string {
    const pauseHint = debug.state === "running" ? "，将先自动暂停" : "";
    return `${label} · ${shortcut}${pauseHint}`;
  }

  function debugTestcase(testcase: Testcase | undefined): void {
    if (testcase) void debug.startTestcase(testcase);
  }

  function startCurrent(): void {
    if (stdinDraft) void debug.startInput(stdinDraft, "自定义输入");
    else void debug.startCurrent();
  }

  function breakpointState(breakpoint: { enabled: boolean; verified: boolean }): string {
    if (!breakpoint.enabled) return "已禁用";
    if (!debug.active) return "等待调试";
    return breakpoint.verified ? "已验证" : "未验证";
  }
</script>

<div class="debug-panel">
  <div class="debug-launch">
    <button class="primary-button" disabled={debug.active || debug.busy || execution.compiling} onclick={startCurrent}>
      <Icon name="debug" size={15} />
      {stdinDraft ? "使用当前输入调试" : "调试当前文件"}
    </button>
    <details class="debug-input-panel">
      <summary>
        <span>程序输入（可选）</span>
        <small>{stdinLineCount ? `${stdinLineCount} 行` : "未设置"}</small>
      </summary>
      <textarea
        bind:value={stdinDraft}
        disabled={debug.active}
        spellcheck="false"
        aria-label="调试程序输入"
        placeholder="例如：&#10;5&#10;1 3 2 5 4"
      ></textarea>
      <div class="debug-input-help">
        <span>程序使用 cin 时，可预先填写输入，避免启动后一直等待。</span>
        <button type="button" disabled={debug.active || !stdinDraft} onclick={() => (stdinDraft = "")}>清空</button>
      </div>
    </details>
    <div class="debug-testcase-launch">
      <select aria-label="选择调试测试点" disabled={debug.active || execution.testcases.length === 0} bind:value={selectedTestcaseId}>
        {#if execution.testcases.length === 0}<option>暂无测试点</option>{/if}
        {#each execution.testcases as testcase (testcase.id)}
          <option value={testcase.id}>{testcase.name}</option>
        {/each}
      </select>
      <button disabled={debug.active || debug.busy || !selectedTestcase} onclick={() => debugTestcase(selectedTestcase)}>调试测试点</button>
    </div>
  </div>

  <div
    class="debug-status"
    class:starting={debug.state === "starting"}
    class:running={debug.state === "running"}
    class:stopped={debug.state === "stopped"}
    class:exited={debug.state === "exited"}
    class:error={debug.state === "error"}
    role="status"
    aria-live="polite"
  >
    <strong>{stateLabel()}</strong>
    <span title={stateMessage()}>{stateMessage()}</span>
  </div>

  {#if debug.active}
    <div class="debug-controls" aria-label="调试控制" aria-busy={debug.busy || Boolean(debug.pendingStep)}>
      {#if debug.state === "running"}
        <button aria-label="暂停调试" title="暂停" disabled={debug.busy} onclick={() => void debug.pause()}><Icon name="pause" size={15} /><span>暂停</span></button>
      {:else}
        <button aria-label="继续调试" title="继续 · F5" disabled={debug.busy || !debug.stopped} onclick={() => void debug.continueExecution()}><Icon name="play" size={15} /><span>继续</span></button>
      {/if}
      <button aria-label="单步跳过" title={stepTitle("单步跳过", "F10")} disabled={!canStep} onclick={() => void debug.stepOver()}><Icon name="step-over" size={15} /><span>跳过</span></button>
      <button aria-label="单步进入" title={stepTitle("单步进入", "F11")} disabled={!canStep} onclick={() => void debug.stepInto()}><Icon name="step-into" size={15} /><span>进入</span></button>
      <button aria-label="单步跳出" title={stepTitle("单步跳出", "Shift+F11")} disabled={!canStep} onclick={() => void debug.stepOut()}><Icon name="step-out" size={15} /><span>跳出</span></button>
      <button aria-label="重新启动调试" title="重新启动 · Ctrl+Shift+F5" disabled={debug.busy} onclick={() => void debug.restart()}><Icon name="refresh" size={15} /><span>重启</span></button>
      <button class="danger" aria-label="停止调试" title="停止调试 · Shift+F5" disabled={debug.busy} onclick={() => void debug.stop()}><Icon name="stop" size={15} /><span>停止</span></button>
    </div>
  {/if}

  <section class="debug-section">
    <header>
      <h3>变量</h3>
      <div class="debug-section-actions">
        <span>{debug.stopped ? `${debug.variables.length} 个局部变量` : "暂停后刷新"}</span>
        <button aria-label="刷新变量" title="刷新变量和监视" disabled={!debug.stopped || debug.busy} onclick={() => void debug.refresh()}><Icon name="refresh" size={12} /></button>
      </div>
    </header>
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
      <button aria-label="添加监视" disabled={!watchDraft.trim()}><Icon name="plus" size={14} /></button>
    </form>
    <div class="debug-watch-list">
      {#each debug.watches as watch (watch.id)}
        <div class="debug-watch-row">
          <span title={watch.expression}>{watch.expression}</span>
          <code class:error={Boolean(watch.error)} title={watch.error || watch.value}>{watch.error ? "<错误>" : watch.value || (debug.stopped ? "<无值>" : "—")}</code>
          <button aria-label={`删除监视 ${watch.expression}`} title="删除监视" onclick={() => debug.removeWatch(watch.id)}><Icon name="close" size={11} /></button>
        </div>
      {/each}
      {#if !debug.watches.length}<p class="debug-empty">添加变量名或表达式，暂停时会自动求值。</p>{/if}
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
    <header>
      <h3>断点</h3>
      <div class="debug-section-actions">
        <span>{enabledBreakpointCount}/{debug.breakpoints.length}</span>
        {#if debug.breakpoints.length}
          <button
            aria-label={enabledBreakpointCount ? "禁用全部断点" : "启用全部断点"}
            title={enabledBreakpointCount ? "禁用全部断点" : "启用全部断点"}
            disabled={debug.busy || debug.breakpointBusy}
            onclick={() => void debug.setAllBreakpointsEnabled(enabledBreakpointCount === 0)}
          >{enabledBreakpointCount ? "禁用" : "启用"}</button>
          <button class="danger" aria-label="清空全部断点" title="清空全部断点" disabled={debug.busy || debug.breakpointBusy} onclick={() => void debug.clearBreakpoints()}><Icon name="trash" size={12} /></button>
        {/if}
      </div>
    </header>
    <div class="debug-breakpoint-list">
      {#each debug.breakpoints as breakpoint (breakpoint.id)}
        <div class="debug-breakpoint-row" class:unverified={debug.active && breakpoint.enabled && !breakpoint.verified}>
          <div class="debug-breakpoint-main">
            <input aria-label={`启用断点 ${breakpointName(breakpoint.file)}:${breakpoint.line}`} type="checkbox" checked={breakpoint.enabled} disabled={debug.busy || debug.breakpointBusy} onchange={(event) => void debug.updateBreakpoint(breakpoint.id, { enabled: event.currentTarget.checked })} />
            <button class="debug-breakpoint-location" title={breakpoint.file} onclick={() => void debug.revealBreakpoint(breakpoint)}>
              <span aria-hidden="true" class="debug-breakpoint-dot" class:verified={breakpoint.verified} class:disabled={!breakpoint.enabled}></span>
              <span><strong>{breakpointName(breakpoint.file)}:{breakpoint.line}</strong><small>{breakpointState(breakpoint)}</small></span>
            </button>
            <button aria-label="删除断点" title="删除断点" disabled={debug.busy || debug.breakpointBusy} onclick={() => void debug.toggleBreakpoint(breakpoint.file, breakpoint.line)}><Icon name="close" size={12} /></button>
          </div>
          <input
            class="debug-condition"
            value={breakpoint.condition}
            aria-label={`断点条件 ${breakpointName(breakpoint.file)}:${breakpoint.line}`}
            aria-describedby={breakpoint.message ? `debug-breakpoint-message-${breakpoint.id}` : undefined}
            placeholder="条件，例如 i == 514"
            title={breakpoint.message || "条件断点"}
            disabled={debug.busy || debug.breakpointBusy}
            onchange={(event) => void debug.updateBreakpoint(breakpoint.id, { condition: event.currentTarget.value.trim() })}
          />
          {#if breakpoint.message}<small id={`debug-breakpoint-message-${breakpoint.id}`}>{breakpoint.message}</small>{/if}
        </div>
      {/each}
      {#if !debug.breakpoints.length}<p class="debug-empty">点击编辑器行号左侧的圆点区域添加断点。</p>{/if}
    </div>
  </section>

  {#if debug.error}<p class="debug-error" role="alert">{debug.error}</p>{/if}
</div>
