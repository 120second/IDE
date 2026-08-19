<script lang="ts">
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    shell: ShellStore;
    workspace: EditorWorkspace;
    backendState: "checking" | "ready" | "error";
  }

  let { shell, workspace, backendState }: Props = $props();
</script>

<footer class="status-bar">
  <div class="status-left">
    <button class="status-item" title="切换侧栏 · Ctrl+B" onclick={() => shell.toggleSidebar()}>
      <Icon name="panel" size={13} />
      <span>LightCP</span>
    </button>
    <span class="status-item backend-status" title="Rust 后端状态">
      <span class:ready={backendState === "ready"} class:error={backendState === "error"} class="status-dot"></span>
      {backendState === "ready" ? "后端就绪" : backendState === "checking" ? "正在连接" : "预览模式"}
    </span>
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
