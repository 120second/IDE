<script lang="ts">
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    workspace: EditorWorkspace;
    togglePanel: () => void;
    toggleZen: () => void;
    compile: () => void;
    run: () => void;
    stop: () => void;
    busy: boolean;
    running: boolean;
  }

  let { workspace, togglePanel, toggleZen, compile, run, stop, busy, running }: Props = $props();
</script>

<header class="tab-bar">
  <div class="tab-strip" role="tablist" aria-label="已打开的编辑器">
    {#each workspace.tabs as tab (tab.id)}
      <button
        class="editor-tab"
        class:active={tab.id === workspace.activeId}
        class:deleted={tab.deleted}
        class:external-modified={tab.externalModified}
        role="tab"
        aria-selected={tab.id === workspace.activeId}
        title={tab.path ?? tab.title}
        onclick={() => workspace.switchTab(tab.id)}
      >
        <Icon name="cpp" size={15} />
        <span class="tab-title">{tab.title}{tab.deleted ? "（已删除）" : ""}</span>
        {#if tab.externalModified}<span class="external-marker" title="磁盘内容已更改">!</span>{/if}
        {#if tab.dirty}<span class="dirty" aria-label="未保存的更改"></span>{/if}
        <span
          class="close-tab"
          role="button"
          tabindex="0"
          aria-label={`关闭 ${tab.title}`}
          onclick={(event) => {
            event.stopPropagation();
            workspace.closeTab(tab.id);
          }}
          onkeydown={(event) => {
            if (event.key === "Enter" || event.key === " ") workspace.closeTab(tab.id);
          }}
        >
          <Icon name="close" size={13} />
        </span>
      </button>
    {/each}
    <button class="tab-action add-tab" aria-label="新建编辑器" title="新建编辑器" onclick={() => workspace.createTab()}>
      <Icon name="plus" size={15} />
    </button>
  </div>
  <div class="editor-actions">
    <button class="tab-run-action" disabled={busy && !running} title="编译当前文件" onclick={compile}>编译</button>
    {#if running}
      <button class="tab-run-action stop" title="停止" onclick={stop}>停止</button>
    {:else}
      <button class="tab-run-action" disabled={busy} title="运行当前文件 · F5" onclick={run}>运行</button>
    {/if}
    <button class="tab-action" aria-label="切换底部面板" title="切换底部面板 · Ctrl+J" onclick={togglePanel}>
      <Icon name="panel" size={16} />
    </button>
    <button class="tab-action" aria-label="切换禅模式" title="禅模式 · Ctrl+K Z" onclick={toggleZen}>
      <Icon name="zen" size={16} />
    </button>
  </div>
</header>
