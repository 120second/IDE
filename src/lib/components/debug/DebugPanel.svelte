<script lang="ts">
  import { untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { DebugStore } from "../../stores/debug.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import Icon from "../shell/Icon.svelte";
  import VariableTree from "./VariableTree.svelte";

  interface Props {
    debug: DebugStore;
    execution: ExecutionStore;
    workspace: EditorWorkspace;
  }

  let { debug, execution, workspace }: Props = $props();
  let watchDraft = $state("");
  let observedSource = "";
  let selectedTestcase = $derived(debug.selectedTestcase);
  let inputValue = $derived(debug.inputMode === "testcase" ? `testcase:${selectedTestcase?.id ?? ""}` : debug.inputMode);
  let currentFrame = $derived(debug.frames.find((frame) => frame.level === debug.selectedFrame));
  let enabledBreakpointCount = $derived(debug.breakpoints.filter((breakpoint) => breakpoint.enabled).length);
  let canStep = $derived(
    !debug.busy
      && !debug.pendingStep
      && debug.stopped,
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
    if (debug.stopRequested) return "正在停止，请稍候…";
    if (debug.pendingStep) return "正在自动暂停，随后执行单步操作…";
    if (debug.state === "running") return "等待断点；也可点击暂停，查看程序执行到哪里。";
    if (debug.stopped) return currentFrame?.line
      ? `${breakpointName(currentFrame.fullName || currentFrame.file)} · 第 ${currentFrame.line} 行（尚未执行）`
      : debug.reason || "选择下一步，执行一行代码。";
    return debug.reason || "开始后在 main 暂停，再逐行查看变量变化。";
  }

  function stepTitle(label: string, shortcut: string): string {
    const pauseHint = debug.state === "running" ? "，将先自动暂停" : "";
    return `${label} · ${shortcut}${pauseHint}`;
  }

  function selectInput(value: string): void {
    if (value.startsWith("testcase:")) {
      debug.inputMode = "testcase";
      debug.selectedTestcaseId = Number(value.slice(9));
    } else debug.inputMode = value === "custom" ? "custom" : "none";
  }

  function breakpointState(breakpoint: { enabled: boolean; verified: boolean }): string {
    if (!breakpoint.enabled) return "已禁用";
    if (!debug.active) return "等待调试";
    return breakpoint.verified ? "已验证" : "未验证";
  }
</script>

<div class="debug-panel">
  <div class="debug-session-top" class:active={debug.active}>
  <div class="debug-launch">
    <div class="debug-file-heading">
      <div><small>{debug.active ? "正在调试" : "当前文件"}</small><strong title={debug.active ? debug.sourcePath : workspace.activeTab?.path}>{breakpointName((debug.active ? debug.sourcePath : workspace.activeTab?.path) || "未打开 C++ 文件")}</strong></div>
      <button class="debug-text-button" title="配置编译器和 GDB 路径" onclick={() => debug.openToolchainSettings()}>设置</button>
    </div>
    {#if !debug.active}
      <label class="debug-input-label" for="debug-input-source">程序输入</label>
      <select id="debug-input-source" class="debug-input-select" value={inputValue} disabled={debug.busy} onchange={(event) => selectInput(event.currentTarget.value)}>
        <option value="none">无输入</option>
        <option value="custom">手动输入 / 粘贴数据</option>
        {#each execution.testcases as testcase (testcase.id)}
          <option value={`testcase:${testcase.id}`}>测试点 · {testcase.name}</option>
        {/each}
      </select>
      {#if debug.inputMode === "custom"}
        <div class="debug-input-panel">
          <textarea bind:value={debug.stdinDraft} disabled={debug.busy} spellcheck="false" aria-label="调试程序输入" placeholder="粘贴提供给 cin / scanf 的数据"></textarea>
          <div class="debug-input-help"><span>一次性提供给程序，读完即结束输入。</span><button disabled={debug.busy || !debug.stdinDraft} onclick={() => (debug.stdinDraft = "")}>清空</button></div>
        </div>
      {:else if debug.inputMode === "testcase"}
        <details class="debug-input-panel"><summary>查看测试点输入</summary><pre class="debug-input-preview">{selectedTestcase?.input || "（空输入）"}</pre></details>
      {:else}
        <p class="debug-launch-hint">使用 cin / scanf 的程序，请先选择测试点或填写输入。</p>
      {/if}
      <label class="debug-entry-option"><input type="checkbox" bind:checked={debug.stopOnEntry} disabled={debug.busy} />开始时停在 main</label>
      <button class="primary-button" disabled={Boolean(debug.startDisabledReason)} title={debug.startDisabledReason || "编译当前文件并开始调试"} onclick={() => void debug.startCurrent()}>
        <Icon name="debug" size={15} />{debug.state === "exited" || debug.state === "error" ? "再次调试" : "开始调试"}
      </button>
      {#if debug.startDisabledReason}<p class="debug-launch-hint">{debug.startDisabledReason}</p>{/if}
    {:else}
      <div class="debug-active-input">
        <span>输入：{debug.inputMode === "testcase" ? selectedTestcase?.name : debug.inputMode === "custom" ? "手动输入" : "无输入"}</span>
        <button class="debug-text-button" onclick={() => debug.showConsole()}>查看输出</button>
      </div>
    {/if}
  </div>

  {#if debug.error}
    <div class="debug-error" role="alert"><strong>调试遇到问题</strong><p>{debug.error}</p><div class="debug-error-actions"><button onclick={() => debug.showCompilerOutput()}>编译输出</button><button onclick={() => debug.showConsole()}>调试日志</button><button onclick={() => debug.openToolchainSettings()}>工具链设置</button></div></div>
  {/if}

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
      <button aria-label="下一步（单步跳过）" title={stepTitle("执行当前行，不进入函数", "F10")} disabled={!canStep} onclick={() => void debug.stepOver()}><Icon name="step-over" size={15} /><span>下一步</span></button>
      <button aria-label="单步进入" title={stepTitle("进入当前行调用的函数", "F11")} disabled={!canStep} onclick={() => void debug.stepInto()}><Icon name="step-into" size={15} /><span>进入函数</span></button>
      <button aria-label="单步跳出" title={stepTitle("执行到当前函数返回", "Shift+F11")} disabled={!canStep} onclick={() => void debug.stepOut()}><Icon name="step-out" size={15} /><span>跳出函数</span></button>
      <button aria-label="重新启动调试" title="重新启动 · Ctrl+Shift+F5" disabled={debug.busy} onclick={() => void debug.restart()}><Icon name="refresh" size={15} /><span>重启</span></button>
      <button class="danger" aria-label="停止调试" title="停止调试 · Shift+F5" disabled={debug.stopRequested} onclick={() => void debug.stop()}><Icon name="stop" size={15} /><span>{debug.stopRequested ? "停止中" : "停止"}</span></button>
    </div>
  {/if}
  </div>

  <section class="debug-section">
    <header>
      <h3>局部变量</h3>
      <div class="debug-section-actions">
        <span>{debug.refreshing ? "读取中…" : debug.stopped ? `${debug.variables.length} 项` : "暂停后显示"}</span>
        <button aria-label="刷新变量" title="刷新变量和监视" disabled={!debug.stopped || debug.busy} onclick={() => void debug.refresh()}><Icon name="refresh" size={12} /></button>
      </div>
    </header>
    {#if debug.stopped && debug.variables.length}
      {#key debug.inspectionVersion}<VariableTree {debug} variables={debug.variables} />{/key}
    {:else}
      <p class="debug-empty">{debug.refreshing ? "正在读取当前函数的变量…" : debug.stopped ? "当前函数没有局部变量；全局变量可添加到监视。" : debug.state === "running" ? "暂停后查看变量的当前值。" : "开始调试后，在这里查看每一步的变量值。"}</p>
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
          <code class:error={debug.stopped && Boolean(watch.error)} title={watch.error || watch.value}>{!debug.stopped ? "等待暂停" : watch.error ? "无法求值" : watch.value || "—"}</code>
          <button aria-label={`删除监视 ${watch.expression}`} title="删除监视" onclick={() => debug.removeWatch(watch.id)}><Icon name="close" size={11} /></button>
        </div>
        {#if debug.stopped && watch.error}<p class="debug-inline-error">{watch.expression}：{watch.error}</p>{/if}
      {/each}
      {#if !debug.watches.length}<p class="debug-empty">添加变量名或表达式，暂停时会自动求值。</p>{/if}
    </div>
  </section>

  <details class="debug-section debug-fold-section" open={debug.stopped}>
    <summary>调用栈 <span>{debug.frames.length}</span></summary>
    <div class="debug-frame-list">
      {#each debug.frames as frame (frame.level)}
        <button disabled={!debug.stopped || debug.busy} class:active={frame.level === debug.selectedFrame} onclick={() => void debug.selectFrame(frame.level)}>
          <strong>{frame.function}</strong>
          <small>{frame.file || "未知文件"}{frame.line ? `:${frame.line}` : ""}</small>
        </button>
      {/each}
      {#if !debug.frames.length}<p class="debug-empty">暂停后显示调用栈。</p>{/if}
    </div>
  </details>

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
          <details class="debug-breakpoint-condition" open={Boolean(breakpoint.condition)}><summary>条件{breakpoint.condition ? `：${breakpoint.condition}` : "（可选）"}</summary><input
            class="debug-condition"
            value={breakpoint.condition}
            aria-label={`断点条件 ${breakpointName(breakpoint.file)}:${breakpoint.line}`}
            aria-describedby={breakpoint.message ? `debug-breakpoint-message-${breakpoint.id}` : undefined}
            placeholder="条件，例如 i == 514"
            title={breakpoint.message || "条件断点"}
            disabled={debug.busy || debug.breakpointBusy}
            onchange={(event) => void debug.updateBreakpoint(breakpoint.id, { condition: event.currentTarget.value.trim() })}
          /></details>
          {#if breakpoint.message}<small id={`debug-breakpoint-message-${breakpoint.id}`}>{breakpoint.message}</small>{/if}
        </div>
      {/each}
      {#if !debug.breakpoints.length}<p class="debug-empty">点击行号左侧添加断点，或按 F9。点击“继续”可运行到下一个断点。</p>{/if}
    </div>
  </section>

</div>
