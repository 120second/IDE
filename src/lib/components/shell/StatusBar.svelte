<script lang="ts">
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { LspStore } from "../../stores/lsp.svelte";
  import Icon from "./Icon.svelte";
  import type { KeybindingMap } from "../../keybindings";

  interface Props {
    shell: ShellStore;
    workspace: EditorWorkspace;
    backendState: "checking" | "ready" | "error";
    lsp: LspStore;
    keybindings: KeybindingMap;
  }

  let { shell, workspace, backendState, lsp, keybindings }: Props = $props();

  const lspLabel = () => {
    if (lsp.state === "ready") return lsp.serverVersion ? `clangd ${lsp.serverVersion}` : "clangd 就绪";
    if (lsp.state === "starting") return "clangd 连接中";
    if (lsp.state === "unavailable") return "未找到 clangd";
    if (lsp.state === "crashed") return "clangd 已退出";
    return "clangd 未启动";
  };
</script>

<footer class="status-bar">
  <div class="status-left">
    <button class="status-item" title={`切换侧栏 · ${keybindings.toggleSidebar}`} onclick={() => shell.toggleSidebar()}>
      <Icon name="panel" size={13} />
      <span>LightCP</span>
    </button>
    <span class="status-item backend-status" title="Rust 后端状态">
      <span class:ready={backendState === "ready"} class:error={backendState === "error"} class="status-dot"></span>
      {backendState === "ready" ? "后端就绪" : backendState === "checking" ? "正在连接" : "预览模式"}
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
    <span class="status-item">行 {workspace.cursorLine}，列 {workspace.cursorColumn}</span>
    <span class="status-item">空格：4</span>
    <span class="status-item">UTF-8</span>
    <span class="status-item">C++</span>
  </div>
</footer>
