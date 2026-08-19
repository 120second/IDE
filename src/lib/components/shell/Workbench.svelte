<script lang="ts">
  import { onMount } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { SettingsStore } from "../../stores/settings.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { GeneratorStore } from "../../stores/generator.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import type { HealthStatus } from "../../types/health";
  import EditorHost from "../editor/EditorHost.svelte";
  import TabBar from "../editor/TabBar.svelte";
  import TemplateCenter from "../templates/TemplateCenter.svelte";
  import TemplateQuickSearch from "../templates/TemplateQuickSearch.svelte";
  import QuickArchiveDialog from "../archive/QuickArchiveDialog.svelte";
  import ActivityBar from "./ActivityBar.svelte";
  import BottomPanel from "./BottomPanel.svelte";
  import Icon from "./Icon.svelte";
  import { matchesShortcut } from "../../keybindings";
  import Sidebar from "./Sidebar.svelte";
  import StatusBar from "./StatusBar.svelte";

  interface Props {
    shell: ShellStore;
    workspace: EditorWorkspace;
    fileWorkspace: WorkspaceStore;
    templateStore: TemplateStore;
    settings: SettingsStore;
    execution: ExecutionStore;
    generator: GeneratorStore;
    archiveStore: ArchiveStore;
    backendState: "checking" | "ready" | "error";
    health?: HealthStatus;
  }

  let { shell, workspace, fileWorkspace, templateStore, execution, generator, archiveStore, settings, backendState, health }: Props = $props();
  let quickSearchOpen = $state(false);

  onMount(() => {
    let awaitingZenKey = false;
    let chordTimer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, "quickArchive")) {
        event.preventDefault();
        archiveStore.openQuickArchive();
        return;
      }
      if (matchesShortcut(event, "quickTemplate")) {
        event.preventDefault();
        quickSearchOpen = true;
        return;
      }
      if (event.key === "Escape" && shell.zenMode) {
        event.preventDefault();
        shell.toggleZenMode();
        return;
      }
      if (matchesShortcut(event, "toggleSidebar")) {
        event.preventDefault();
        shell.toggleSidebar();
        return;
      }
      if (matchesShortcut(event, "togglePanel")) {
        event.preventDefault();
        shell.toggleBottomPanel();
        return;
      }
      if (matchesShortcut(event, "save")) {
        event.preventDefault();
        void workspace.saveActive();
        return;
      }
      if (matchesShortcut(event, "runCurrent")) {
        event.preventDefault();
        if (event.repeat) return;
        if (shell.activeActivity === "templates") shell.activeActivity = "explorer";
        void execution.runCurrent();
        return;
      }
      if (matchesShortcut(event, "runAll")) {
        event.preventDefault();
        if (event.repeat) return;
        shell.activeActivity = "testcases";
        shell.sidebarVisible = true;
        void execution.runAll();
        return;
      }
      if (awaitingZenKey && !event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        awaitingZenKey = false;
        if (chordTimer) clearTimeout(chordTimer);
        shell.toggleZenMode();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        awaitingZenKey = true;
        if (chordTimer) clearTimeout(chordTimer);
        chordTimer = setTimeout(() => (awaitingZenKey = false), 1200);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (chordTimer) clearTimeout(chordTimer);
    };
  });

  function saveSelectionAsSnippet(code: string): void {
    templateStore.beginCreate("snippet", code);
    shell.activeActivity = "templates";
    shell.sidebarVisible = true;
  }
</script>

<div class:zen-mode={shell.zenMode} class="app-shell">
  <div class="workspace-background" aria-hidden="true"></div>
  <div class="shell-body">
    {#if !shell.zenMode}<ActivityBar {shell} />{/if}
    <div class="workbench">
      {#if shell.sidebarVisible && !shell.zenMode}
        <Sidebar {shell} {workspace} {fileWorkspace} {templateStore} {execution} {generator} {archiveStore} {settings} />
      {/if}
      <section class="editor-column" aria-label="编辑器工作台">
        {#if shell.activeActivity === "templates" && !shell.zenMode}
          <TemplateCenter {templateStore} />
        {:else}
          <TabBar
            {workspace}
            togglePanel={() => shell.toggleBottomPanel()}
            toggleZen={() => shell.toggleZenMode()}
            compile={() => void execution.compileCurrent()}
            run={() => void execution.runCurrent()}
            stop={() => void execution.stop()}
            busy={execution.compiling || execution.running}
            running={execution.running}
          />
          <div class="editor-surface">
            <EditorHost {workspace} saveAsSnippet={saveSelectionAsSnippet} />
          </div>
          {#if shell.bottomPanelVisible && !shell.zenMode}
            <BottomPanel {shell} {workspace} {execution} {backendState} {health} />
          {/if}
        {/if}
      </section>
    </div>
    {#if shell.zenMode}
      <button class="exit-zen" title="退出禅模式 · Escape" aria-label="退出禅模式" onclick={() => shell.toggleZenMode()}>
        <Icon name="zen" size={16} />
      </button>
    {/if}
  </div>
  <StatusBar {shell} {workspace} {backendState} />
</div>

{#if quickSearchOpen}
  <TemplateQuickSearch
    {templateStore}
    close={() => {
      quickSearchOpen = false;
      workspace.focus();
    }}
  />
{/if}

{#if archiveStore.quickArchivePath}
  <QuickArchiveDialog
    {archiveStore}
    path={archiveStore.quickArchivePath}
    close={() => archiveStore.closeQuickArchive()}
  />
{/if}
