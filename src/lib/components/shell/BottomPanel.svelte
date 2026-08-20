<script lang="ts">
  import { onDestroy } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { DebugStore } from "../../stores/debug.svelte";
  import type { BottomPanelId, ShellStore } from "../../stores/shell.svelte";
  import type { HealthStatus } from "../../types/health";
  import type { LspStore } from "../../stores/lsp.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    shell: ShellStore;
    workspace: EditorWorkspace;
    backendState: "checking" | "ready" | "error";
    health?: HealthStatus;
    execution: ExecutionStore;
    debug: DebugStore;
    lsp: LspStore;
  }

  const panels: { id: BottomPanelId; label: string }[] = [
    { id: "problems", label: "问题" },
    { id: "output", label: "输出" },
    { id: "tests", label: "测试结果" },
    { id: "terminal", label: "终端" },
    { id: "debugConsole", label: "调试控制台" },
  ];

  let { shell, workspace, backendState, health, execution, debug, lsp }: Props = $props();
  const LSP_PAGE_SIZE = 150;
  let referencePage = $state(0);
  let diagnosticPage = $state(0);
  let referencePageCount = $derived(Math.max(1, Math.ceil(lsp.referencesResult.length / LSP_PAGE_SIZE)));
  let diagnosticPageCount = $derived(Math.max(1, Math.ceil(lsp.diagnostics.length / LSP_PAGE_SIZE)));
  let currentReferencePage = $derived(Math.min(referencePage, referencePageCount - 1));
  let currentDiagnosticPage = $derived(Math.min(diagnosticPage, diagnosticPageCount - 1));
  let visibleReferences = $derived(lsp.referencesResult.slice(
    currentReferencePage * LSP_PAGE_SIZE,
    (currentReferencePage + 1) * LSP_PAGE_SIZE,
  ));
  let visibleDiagnostics = $derived(lsp.diagnostics.slice(
    currentDiagnosticPage * LSP_PAGE_SIZE,
    (currentDiagnosticPage + 1) * LSP_PAGE_SIZE,
  ));
  let selectedResultId = $state<number>();
  let selectedResult = $derived(
    execution.results.find((result) => result.testcaseId === selectedResultId)
      ?? execution.results[0],
  );
  let stopResize = () => {};
  onDestroy(() => stopResize());

  function beginResize(event: PointerEvent): void {
    event.preventDefault();
    stopResize();
    const startY = event.clientY;
    const startHeight = shell.bottomPanelHeight;
    const onMove = (moveEvent: PointerEvent) =>
      shell.setBottomPanelHeight(startHeight + startY - moveEvent.clientY);
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      stopResize = () => {};
    };
    const onUp = () => cleanup();
    stopResize = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
          {#if panel.id === "problems"}<span class="panel-badge">{lsp.diagnostics.length}</span>{/if}
        </button>
      {/each}
    </div>
    <button class="panel-close" aria-label="关闭面板" title="关闭面板 · Ctrl+J" onclick={() => shell.toggleBottomPanel()}>
      <Icon name="close" size={14} />
    </button>
  </header>
  <div class="panel-content">
    {#if shell.activeBottomPanel === "problems"}
      <div class="lsp-results">
        {#if lsp.referencesResult.length > 0}
          <div class="lsp-results-heading">
            <strong>引用（{lsp.referencesResult.length}）</strong>
            {#if referencePageCount > 1}
              <span>第 {currentReferencePage + 1}/{referencePageCount} 页</span>
              <button disabled={currentReferencePage <= 0} onclick={() => (referencePage = currentReferencePage - 1)}>上一页</button>
              <button disabled={currentReferencePage >= referencePageCount - 1} onclick={() => (referencePage = currentReferencePage + 1)}>下一页</button>
            {/if}
            <button onclick={() => { lsp.clearReferences(); referencePage = 0; }}>清除</button>
          </div>
          <div class="lsp-result-list">
            {#each visibleReferences as location, index (`${location.path}:${location.range.start.line}:${location.range.start.character}:${index}`)}
              <button onclick={() => void workspace.openLocation(location)}>
                <strong>{location.path.replaceAll("/", "\\").split("\\").at(-1)}</strong>
                <span>行 {location.range.start.line + 1}，列 {location.range.start.character + 1}</span>
                <small>{location.path}</small>
              </button>
            {/each}
          </div>
        {/if}
        {#if lsp.diagnostics.length > 0}
          <div class="lsp-results-heading">
            <strong>诊断（{lsp.errorCount} 个错误，{lsp.warningCount} 个警告）</strong>
            <span>{lsp.message}</span>
            {#if diagnosticPageCount > 1}
              <span>第 {currentDiagnosticPage + 1}/{diagnosticPageCount} 页</span>
              <button disabled={currentDiagnosticPage <= 0} onclick={() => (diagnosticPage = currentDiagnosticPage - 1)}>上一页</button>
              <button disabled={currentDiagnosticPage >= diagnosticPageCount - 1} onclick={() => (diagnosticPage = currentDiagnosticPage + 1)}>下一页</button>
            {/if}
          </div>
          <div class="lsp-result-list">
            {#each visibleDiagnostics as diagnostic, index (`${diagnostic.path}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.message}:${index}`)}
              <button onclick={() => void workspace.openLocation({ path: diagnostic.path, range: diagnostic.range })}>
                <span class:error={diagnostic.severity === 1} class:warning={diagnostic.severity === 2} class="lsp-severity">
                  {diagnostic.severity === 1 ? "错误" : diagnostic.severity === 2 ? "警告" : diagnostic.severity === 4 ? "提示" : "信息"}
                </span>
                <strong>{diagnostic.message}</strong>
                <span>行 {diagnostic.range.start.line + 1}，列 {diagnostic.range.start.character + 1}</span>
                <small>{diagnostic.path}{diagnostic.code ? ` · ${diagnostic.code}` : ""}</small>
              </button>
            {/each}
          </div>
        {:else if lsp.referencesResult.length === 0}
          <div class="panel-empty">
            <Icon name="check" size={20} />
            <span>{lsp.state === "ready" ? "当前工作区没有检测到问题。" : lsp.message}</span>
            {#if lsp.state === "unavailable" || lsp.state === "crashed"}
              <button onclick={() => lsp.reconnect()}>重新连接</button>
            {/if}
          </div>
        {/if}
      </div>
    {:else if shell.activeBottomPanel === "output"}
      <div class="execution-output">
        <div class="execution-toolbar">
          <button onclick={() => execution.clearOutput()}>清空</button>
          <span>{execution.compiling ? "正在编译…" : execution.running ? "正在运行…" : backendState === "ready" ? `后端就绪 · 数据库 v${health?.databaseSchemaVersion ?? 0}` : "后端不可用"}</span>
        </div>
        <textarea class="process-output" readonly spellcheck="false" aria-label="程序输出" value={execution.output || `[LightCP] 已就绪。当前共 ${workspace.tabs.length} 个编辑器状态。\n${workspace.notice ? `[文件] ${workspace.notice}\n` : ""}`}></textarea>
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
        <textarea class="process-output" readonly spellcheck="false" aria-label="调试控制台输出" value={debug.console || "[调试控制台] 启动调试后将在此显示程序输出和 GDB 消息。\n"}></textarea>
      </div>
    {/if}
  </div>
</section>
