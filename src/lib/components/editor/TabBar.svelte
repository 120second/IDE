<script lang="ts">
  import { tick } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import Icon from "../shell/Icon.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import type { KeybindingMap } from "../../keybindings";

  interface Props {
    workspace: EditorWorkspace;
    togglePanel: () => void;
    toggleZen: () => void;
    compile: () => void;
    run: () => void;
    stop: () => void;
    busy: boolean;
    running: boolean;
    ux: UxStore;
    keybindings: KeybindingMap;
  }

  let { workspace, togglePanel, toggleZen, compile, run, stop, busy, running, ux, keybindings }: Props = $props();
  let tabStrip: HTMLDivElement;

  async function closeTab(id: string): Promise<void> {
    const tab = workspace.tabs.find((candidate) => candidate.id === id);
    if (tab?.dirty) {
      const accepted = await ux.confirm({
        title: "关闭未保存的文件",
        message: `“${tab.title}”包含未保存的更改，确定关闭吗？`,
        confirmLabel: "仍然关闭",
        danger: true,
      });
      if (!accepted) return;
    }
    workspace.closeTab(id);
  }

  async function handleTabKey(event: KeyboardEvent, id: string): Promise<void> {
    if ((event.target as HTMLElement).closest(".close-tab")) return;
    const index = workspace.tabs.findIndex((tab) => tab.id === id);
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + workspace.tabs.length) % workspace.tabs.length;
    else if (event.key === "ArrowRight") next = (index + 1) % workspace.tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = workspace.tabs.length - 1;
    else if (event.key === "Delete") {
      event.preventDefault();
      await closeTab(id);
      return;
    } else return;
    event.preventDefault();
    workspace.switchTab(workspace.tabs[next].id);
    await tick();
    tabStrip.querySelectorAll<HTMLElement>(".editor-tab")[next]?.focus();
  }
</script>

<header class="tab-bar">
  <div class="tab-strip" role="tablist" aria-label="已打开的编辑器" bind:this={tabStrip}>
    {#each workspace.tabs as tab (tab.id)}
      <button
        class="editor-tab"
        class:active={tab.id === workspace.activeId}
        class:deleted={tab.deleted}
        class:external-modified={tab.externalModified}
        role="tab"
        aria-selected={tab.id === workspace.activeId}
        tabindex={tab.id === workspace.activeId ? 0 : -1}
        title={tab.path ?? tab.title}
        onclick={() => workspace.switchTab(tab.id)}
        onkeydown={(event) => void handleTabKey(event, tab.id)}
      >
        <Icon name="cpp" size={15} />
        <span class="tab-title">{tab.title}{tab.deleted ? "（已删除）" : ""}</span>
        {#if tab.loading}<span class="tab-loading" aria-label="正在加载"></span>{/if}
        {#if tab.externalModified}<span class="external-marker" title="磁盘内容已更改">!</span>{/if}
        {#if tab.dirty}<span class="dirty" aria-label="未保存的更改"></span>{/if}
        <span
          class="close-tab"
          role="button"
          tabindex="0"
          aria-label={`关闭 ${tab.title}`}
          onclick={(event) => {
            event.stopPropagation();
            void closeTab(tab.id);
          }}
          onkeydown={(event) => {
            if (event.key === "Enter" || event.key === " ") void closeTab(tab.id);
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
      <button class="tab-run-action" disabled={busy} title={`运行当前文件 · ${keybindings.runCurrent}`} onclick={run}>运行</button>
    {/if}
    <button class="tab-action" aria-label="切换底部面板" title={`切换底部面板 · ${keybindings.togglePanel}`} onclick={togglePanel}>
      <Icon name="panel" size={16} />
    </button>
    <button class="tab-action" aria-label="切换禅模式" title="禅模式 · Ctrl+K Z" onclick={toggleZen}>
      <Icon name="zen" size={16} />
    </button>
  </div>
</header>
