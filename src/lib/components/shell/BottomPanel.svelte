<script lang="ts">
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { DebugStore } from "../../stores/debug.svelte";
  import type { BottomPanelId, ShellStore } from "../../stores/shell.svelte";
  import type { HealthStatus } from "../../types/health";
  import Icon from "./Icon.svelte";

  interface Props {
    shell: ShellStore;
    workspace: EditorWorkspace;
    backendState: "checking" | "ready" | "error";
    health?: HealthStatus;
    execution: ExecutionStore;
    debug: DebugStore;
  }

  const panels: { id: BottomPanelId; label: string; badge?: string }[] = [
    { id: "problems", label: "问题", badge: "0" },
    { id: "output", label: "输出" },
    { id: "tests", label: "测试结果" },
    { id: "terminal", label: "终端" },
    { id: "debugConsole", label: "调试控制台" },
  ];

  let { shell, workspace, backendState, health, execution, debug }: Props = $props();
  let selectedResultId = $state<number>();
  let selectedResult = $derived(
    execution.results.find((result) => result.testcaseId === selectedResultId)
      ?? execution.results[0],
  );

  function beginResize(event: PointerEvent): void {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = shell.bottomPanelHeight;
    const onMove = (moveEvent: PointerEvent) =>
      shell.setBottomPanelHeight(startHeight + startY - moveEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function statusLabel(status: string): string {
    if (status === "Stopped") return "已停止";
    if (status === "Running") return "运行中";
    return status;
  }
</script>

<section class="bottom-panel" style:height={`${shell.bottomPanelHeight}px`} aria-label="底部面板">
  <div class="panel-resize-handle" role="separator" aria-orientation="horizontal" onpointerdown={beginResize}></div>
  <header class="panel-tabs">
    <div class="panel-tab-list" role="tablist" aria-label="面板视图">
      {#each panels as panel}
        <button
          class:active={shell.activeBottomPanel === panel.id}
          role="tab"
          aria-selected={shell.activeBottomPanel === panel.id}
          onclick={() => shell.showBottomPanel(panel.id)}
        >
          {panel.label}
          {#if panel.badge}<span class="panel-badge">{panel.badge}</span>{/if}
        </button>
      {/each}
    </div>
    <button class="panel-close" aria-label="关闭面板" title="关闭面板 · Ctrl+J" onclick={() => shell.toggleBottomPanel()}>
      <Icon name="close" size={14} />
    </button>
  </header>
  <div class="panel-content">
    {#if shell.activeBottomPanel === "problems"}
      <div class="panel-empty"><Icon name="check" size={20} /><span>当前编辑器中没有检测到问题。</span></div>
    {:else if shell.activeBottomPanel === "output"}
      <div class="execution-output">
        <div class="execution-toolbar">
          <button onclick={() => execution.clearOutput()}>清空</button>
          <span>{execution.compiling ? "正在编译…" : execution.running ? "正在运行…" : backendState === "ready" ? `后端就绪 · 数据库 v${health?.databaseSchemaVersion ?? 0}` : "后端不可用"}</span>
        </div>
        <pre class="process-output" aria-live="polite">{execution.output || `[LightCP] 已就绪。当前共 ${workspace.tabs.length} 个编辑器状态。\n${workspace.notice ? `[文件] ${workspace.notice}\n` : ""}`}</pre>
      </div>
    {:else if shell.activeBottomPanel === "tests"}
      <div class="test-results-panel">
        <div class="test-results-list">
          {#each execution.results as result (result.testcaseId)}
            <button class:active={selectedResult?.testcaseId === result.testcaseId} onclick={() => (selectedResultId = result.testcaseId)}>
              <span class={`test-status status-${result.status.toLowerCase()}`}>{statusLabel(result.status)}</span>
              <strong>{result.name}</strong>
              <small>{result.durationMs}ms</small>
            </button>
          {/each}
          {#if execution.results.length === 0}<span class="test-results-empty">运行测试点后将在此显示 AC、WA、RE、TLE、CE 或已停止。</span>{/if}
        </div>
        <div class="test-result-detail">
          {#if selectedResult}
            <header><strong>{selectedResult.name}</strong><span>{statusLabel(selectedResult.status)} · {selectedResult.durationMs}ms{selectedResult.exitCode === undefined ? "" : ` · 退出码 ${selectedResult.exitCode}`}</span></header>
            <pre>{`预期输出：\n${selectedResult.expectedOutput}\n\n实际输出：\n${selectedResult.actualOutput}${selectedResult.stderr ? `\n\n错误输出：\n${selectedResult.stderr}` : ""}`}</pre>
          {:else}
            <span class="test-results-empty">尚未选择测试结果。</span>
          {/if}
        </div>
      </div>
    {:else if shell.activeBottomPanel === "terminal"}
      <div class="panel-empty"><Icon name="terminal" size={20} /><span>程序输出会缓冲显示在“输出”面板中。</span></div>
    {:else}
      <div class="execution-output debug-console-panel">
        <div class="execution-toolbar">
          <button onclick={() => debug.clearConsole()}>清空</button>
          <span>{debug.state === "idle" ? "调试器未启动" : debug.reason || "GDB/MI 会话已连接"}</span>
        </div>
        <pre class="process-output" aria-live="polite">{debug.console || "[调试控制台] 启动调试后将在此显示程序输出和 GDB 消息。\n"}</pre>
      </div>
    {/if}
  </div>
</section>
