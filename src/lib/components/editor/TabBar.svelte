<script lang="ts">
  import { tick } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import Icon from "../shell/Icon.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import type { KeybindingMap } from "../../keybindings";
  import ContextMenu from "../ux/ContextMenu.svelte";
  import { requestCloseTabs } from "../../editor/closeTabs";
  import type { LspStore } from "../../stores/lsp.svelte";

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
    newFile: () => void;
    lsp: LspStore;
  }

  let { workspace, togglePanel, toggleZen, compile, run, stop, busy, running, ux, keybindings, newFile, lsp }: Props = $props();
  let tabStrip: HTMLDivElement;
  let menu = $state<{ x: number; y: number; tabId: string }>();

  async function closeTab(id: string): Promise<void> {
    await requestCloseTabs(workspace, ux, [id]);
  }

  async function handleTabKey(event: KeyboardEvent, id: string): Promise<void> {
    if ((event.target as HTMLElement).closest(".close-tab")) return;
    const index = workspace.tabs.findIndex((tab) => tab.id === id);
    let next = index;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      workspace.switchTab(id);
      return;
    }
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
    tabStrip.querySelectorAll<HTMLElement>(".editor-tab-main")[next]?.focus();
  }

  async function saveAll(): Promise<void> {
    const result = await workspace.saveAll();
    if (result.failed || result.skipped) {
      ux.error(`保存完成：成功 ${result.saved} 个，失败 ${result.failed} 个，跳过 ${result.skipped} 个。`);
    } else if (result.saved > 0) {
      ux.success(`已保存 ${result.saved} 个文件。`);
    } else {
      ux.info("没有需要保存的文件。");
    }
  }

  async function saveTab(id: string): Promise<void> {
    const tab = workspace.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (await workspace.saveTab(id)) ux.success(`已保存 ${tab.title}。`);
    else ux.error(workspace.notice);
  }

  function openMenu(event: MouseEvent, tabId: string): void {
    event.preventDefault();
    workspace.switchTab(tabId);
    menu = { x: event.clientX, y: event.clientY, tabId };
  }
</script>

<header class="tab-bar">
  <div class="tab-strip" role="tablist" aria-label="已打开的编辑器" bind:this={tabStrip}>
    {#each workspace.tabs as tab (tab.id)}
      {@const diagnostics = tab.path ? lsp.diagnosticsFor(tab.path) : []}
      {@const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 1).length}
      {@const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 2).length}
      <div
        class="editor-tab"
        role="presentation"
        class:active={tab.id === workspace.activeId}
        class:deleted={tab.deleted}
        class:external-modified={tab.externalModified}
        class:dirty-tab={tab.dirty}
        oncontextmenu={(event) => openMenu(event, tab.id)}
        onauxclick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            void closeTab(tab.id);
          }
        }}
      >
        <button
          type="button"
          class="editor-tab-main"
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
          {#if errorCount || warningCount}
            <span
              class:error={errorCount > 0}
              class:warning={errorCount === 0 && warningCount > 0}
              class="tab-diagnostic"
              title={`${errorCount} 个错误，${warningCount} 个警告`}
              aria-label={`${errorCount} 个错误，${warningCount} 个警告`}
            >{errorCount || warningCount}</span>
          {/if}
          {#if tab.dirty}<span class="dirty" aria-label="未保存的更改"></span>{/if}
        </button>
        <button
          type="button"
          class="close-tab"
          tabindex="-1"
          aria-label={`关闭 ${tab.title}`}
          onclick={(event) => {
            event.stopPropagation();
            void closeTab(tab.id);
          }}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    {/each}
    <button class="tab-action add-tab" aria-label="新建 C++ 文件" title={`新建 C++ 文件 · ${keybindings.newFile}`} onclick={newFile}>
      <Icon name="plus" size={15} />
    </button>
  </div>
  <div class="editor-actions">
    <button class="tab-run-action" disabled={busy} title="编译当前文件" onclick={compile}>编译</button>
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

{#if menu}
  {@const selected = workspace.tabs.find((tab) => tab.id === menu!.tabId)}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    close={() => (menu = undefined)}
    items={[
      {
        label: "保存",
        action: () => void saveTab(menu!.tabId),
        disabled: !selected?.dirty || !selected.path || selected.deleted,
      },
      {
        label: "保存全部",
        action: () => void saveAll(),
        disabled: !workspace.tabs.some((tab) => tab.dirty && tab.path && !tab.deleted),
      },
      { label: "关闭", separatorBefore: true, action: () => void requestCloseTabs(workspace, ux, [menu!.tabId]) },
      {
        label: "关闭其他编辑器",
        action: () => void requestCloseTabs(workspace, ux, workspace.tabs.filter((tab) => tab.id !== menu!.tabId).map((tab) => tab.id)),
        disabled: workspace.tabs.length < 2,
      },
      {
        label: "关闭全部编辑器",
        action: () => void requestCloseTabs(workspace, ux, workspace.tabs.map((tab) => tab.id)),
      },
    ]}
  />
{/if}
