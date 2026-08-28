<script lang="ts">
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { LspStore } from "../../stores/lsp.svelte";
  import Icon from "./Icon.svelte";
  import type { KeybindingMap } from "../../keybindings";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";

  interface Props {
    shell: ShellStore;
    workspace: EditorWorkspace;
    backendState: "checking" | "ready" | "error";
    lsp: LspStore;
    keybindings: KeybindingMap;
    fileWorkspace: WorkspaceStore;
  }

  let { shell, workspace, backendState, lsp, keybindings, fileWorkspace }: Props = $props();
  let activeTab = $derived(workspace.activeTab);

  const lspLabel = () => {
    if (lsp.state === "ready") return lsp.serverVersion ? `clangd ${lsp.serverVersion}` : "clangd 就绪";
    if (lsp.state === "starting") return "clangd 连接中";
    if (lsp.state === "unavailable") return "未找到 clangd";
    if (lsp.state === "crashed") return "clangd 已退出";
    return "clangd 未启动";
  };

  function showExplorer(): void {
    shell.activeActivity = "explorer";
    shell.sidebarVisible = true;
  }
</script>

<footer class="status-bar">
  <div class="status-left">
    <button class="status-item status-workspace" title={fileWorkspace.info?.path ?? `打开资源管理器 · ${keybindings.toggleSidebar}`} onclick={showExplorer}>
      <Icon name={fileWorkspace.info ? "folder" : "explorer"} size={13} />
      <span>{fileWorkspace.info?.name ?? "未打开工作区"}</span>
    </button>
    <button
      class:error={lsp.errorCount > 0}
      class:warning={lsp.errorCount === 0 && lsp.warningCount > 0}
      class="status-item problem-status"
      title="打开问题面板"
      onclick={() => shell.showBottomPanel("problems")}
    >
      <Icon name={lsp.errorCount || lsp.warningCount ? "warning" : "check"} size={12} />
      <span>{lsp.errorCount} 错误</span><span>{lsp.warningCount} 警告</span>
    </button>
    <span class="status-item backend-status" title={backendState === "ready" ? "Rust 后端已连接" : backendState === "checking" ? "正在连接 Rust 后端" : "浏览器预览模式不连接 Rust 后端"}>
      <span class:ready={backendState === "ready"} class:error={backendState === "error"} class="status-dot"></span>
      {backendState === "ready" ? "本地" : backendState === "checking" ? "连接中" : "预览"}
    </span>
    <button
      class:error={lsp.state === "unavailable" || lsp.state === "crashed"}
      class:ready={lsp.state === "ready"}
      class="status-item lsp-status"
      title={`${lsp.message}${lsp.state === "unavailable" || lsp.state === "crashed" ? " · 点击重新连接" : ""}`}
      onclick={() => {
        if (lsp.state === "unavailable" || lsp.state === "crashed") lsp.reconnect();
      }}
    >
      <span class="status-dot"></span>{lspLabel()}
    </button>
  </div>
  <div class="status-right">
    {#if shell.zenMode}<span class="status-item">禅模式</span>{/if}
    {#if workspace.saveState === "saving"}<span class="status-item">正在保存…</span>{/if}
    {#if workspace.saveState === "saved"}<span class="status-item">已保存</span>{/if}
    {#if workspace.saveState === "error"}<span class="status-item">文件错误</span>{/if}
    {#if activeTab}
      <span class="status-item">行 {workspace.cursorLine}，列 {workspace.cursorColumn}</span>
      <span class="status-item">空格：4</span>
      <span class="status-item">{activeTab.eol.toUpperCase()}</span>
      <span class="status-item">UTF-8</span>
      <span class="status-item">C++</span>
    {/if}
  </div>
</footer>
