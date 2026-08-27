<script lang="ts">
  import { onDestroy } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { GeneratorStore } from "../../stores/generator.svelte";
  import type { DebugStore } from "../../stores/debug.svelte";
  import type { SettingsStore } from "../../stores/settings.svelte";
  import type { ActivityId, ShellStore } from "../../stores/shell.svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import ExplorerPanel from "../explorer/ExplorerPanel.svelte";
  import TestcasePanel from "../testcases/TestcasePanel.svelte";
  import SettingsPanel from "../settings/SettingsPanel.svelte";
  import TemplateSidebar from "../templates/TemplateSidebar.svelte";
  import Icon from "./Icon.svelte";
  import DebugPanel from "../debug/DebugPanel.svelte";

  interface Props {
    shell: ShellStore;
    workspace: EditorWorkspace;
    fileWorkspace: WorkspaceStore;
    templateStore: TemplateStore;
    settings: SettingsStore;
    execution: ExecutionStore;
    generator: GeneratorStore;
    archiveStore: ArchiveStore;
    debug: DebugStore;
    ux: UxStore;
    newFile: (parent: string) => void;
  }

  const titles: Record<ActivityId, string> = {
    explorer: "资源管理器",
    testcases: "测试点",
    templates: "模板",
    debug: "运行与调试",
    judge: "对拍",
    settings: "设置",
  };

  let { shell, workspace, fileWorkspace, templateStore, settings, execution, generator, archiveStore, debug, ux, newFile }: Props = $props();
  let stopResize = () => {};
  onDestroy(() => stopResize());

  function beginResize(event: PointerEvent): void {
    event.preventDefault();
    stopResize();
    const startX = event.clientX;
    const startWidth = shell.sidebarWidth;
    const onMove = (moveEvent: PointerEvent) =>
      shell.setSidebarWidth(startWidth + moveEvent.clientX - startX);
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

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    shell.setSidebarWidth(shell.sidebarWidth + (event.key === "ArrowRight" ? 12 : -12));
  }
</script>

<aside class="sidebar" style:width={`${shell.sidebarWidth}px`} aria-label={titles[shell.activeActivity]}>
  <header class="sidebar-header">
    <span>{titles[shell.activeActivity]}</span>
    <button aria-label="隐藏侧栏" title={`隐藏侧栏 · ${settings.value.keybindings.toggleSidebar}`} onclick={() => shell.toggleSidebar()}>
      <Icon name="close" size={14} />
    </button>
  </header>

  <div
    class:explorer-content={shell.activeActivity === "explorer"}
    class:templates-content={shell.activeActivity === "templates"}
    class="sidebar-content"
  >
    {#if shell.activeActivity === "settings"}
      <SettingsPanel {settings} {shell} />
    {:else if shell.activeActivity === "explorer"}
      <ExplorerPanel {fileWorkspace} {archiveStore} editor={workspace} {ux} {newFile} keybindings={settings.value.keybindings} />
    {:else if shell.activeActivity === "testcases"}
      <TestcasePanel {workspace} {execution} {generator} keybindings={settings.value.keybindings} />
    {:else if shell.activeActivity === "templates"}
      <TemplateSidebar {templateStore} />
    {:else if shell.activeActivity === "debug"}
      <DebugPanel {debug} {execution} {workspace} />
    {:else if shell.activeActivity === "judge"}
      <div class="empty-state">
        <Icon name="judge" size={30} />
        <p>对拍</p>
        <span>使用随机数据比较待测程序与暴力程序，自动寻找反例。</span>
      </div>
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="sidebar-resize-handle"
    role="separator"
    aria-label="调整侧栏宽度"
    aria-orientation="vertical"
    aria-valuemin="210"
    aria-valuemax="380"
    aria-valuenow={shell.sidebarWidth}
    tabindex="0"
    onpointerdown={beginResize}
    onkeydown={resizeWithKeyboard}
  ></div>
</aside>
