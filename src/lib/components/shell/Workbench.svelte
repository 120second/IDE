<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { SettingsStore } from "../../stores/settings.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { GeneratorStore } from "../../stores/generator.svelte";
  import type { DebugStore } from "../../stores/debug.svelte";
  import type { StressStore } from "../../stores/stress.svelte";
  import type { SettingsPage, ShellStore } from "../../stores/shell.svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import type { LspStore } from "../../stores/lsp.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import type { HealthStatus } from "../../types/health";
  import EditorHost from "../editor/EditorHost.svelte";
  import TabBar from "../editor/TabBar.svelte";
  import TemplateCenter from "../templates/TemplateCenter.svelte";
  import TemplateQuickSearch from "../templates/TemplateQuickSearch.svelte";
  import QuickArchiveDialog from "../archive/QuickArchiveDialog.svelte";
  import StressCenter from "../stress/StressCenter.svelte";
  import ActivityBar from "./ActivityBar.svelte";
  import BottomPanel from "./BottomPanel.svelte";
  import Icon from "./Icon.svelte";
  import { matchesShortcut } from "../../keybindings";
  import Sidebar from "./Sidebar.svelte";
  import StatusBar from "./StatusBar.svelte";
  import UxOverlay from "../ux/UxOverlay.svelte";
  import WelcomeView from "../editor/WelcomeView.svelte";
  import QuickFileOpen from "../editor/QuickFileOpen.svelte";
  import { requestCloseTabs } from "../../editor/closeTabs";
  import CommandPalette from "./CommandPalette.svelte";
  import type { WorkbenchCommand } from "../../types/commands";
  import FileTemplateDialog from "../templates/FileTemplateDialog.svelte";
  import ThemeStudio from "../settings/ThemeStudio.svelte";
  import SettingsWindow from "../settings/SettingsWindow.svelte";
  import EditorBreadcrumbs from "../editor/EditorBreadcrumbs.svelte";
  import SettingsMenu from "./SettingsMenu.svelte";

  interface Props {
    shell: ShellStore;
    workspace: EditorWorkspace;
    fileWorkspace: WorkspaceStore;
    templateStore: TemplateStore;
    settings: SettingsStore;
    execution: ExecutionStore;
    generator: GeneratorStore;
    archiveStore: ArchiveStore;
    debugStore: DebugStore;
    stressStore: StressStore;
    lspStore: LspStore;
    ux: UxStore;
    backendState: "checking" | "ready" | "error";
    health?: HealthStatus;
  }

  let { shell, workspace, fileWorkspace, templateStore, execution, generator, archiveStore, debugStore, stressStore, lspStore, settings, ux, backendState, health }: Props = $props();
  let quickSearchOpen = $state(false);
  let quickFileOpen = $state(false);
  let commandPaletteOpen = $state(false);
  let fileDialogParent = $state<string>();
  let settingsMenuAnchor = $state<HTMLButtonElement>();
  let TemplateReferenceWindow = $state.raw<
    (typeof import("../editor/TemplateReferenceWindow.svelte"))["default"]
  >();
  let activeFileReady = $derived(Boolean(
    workspace.activeTab?.path
    && !workspace.activeTab.deleted
    && !workspace.activeTab.loading,
  ));
  let buildReady = $derived(activeFileReady && backendState === "ready" && !execution.compiling && !execution.running);
  let workbenchCommands = $derived<WorkbenchCommand[]>([
    command("file.new", "新建 C++ 文件", "文件", "newFile", () => void createSourceFile()),
    command("file.openFolder", "打开文件夹", "文件", undefined, () => void fileWorkspace.openFolderPicker()),
    command("file.quickOpen", "快速打开文件", "文件", "quickOpen", () => openQuickFile(), Boolean(fileWorkspace.info), "请先打开工作区"),
    command("file.save", "保存当前文件", "文件", "save", () => void saveCurrent(), activeFileReady, "当前没有可保存文件"),
    { id: "file.saveAll", label: "保存全部文件", category: "文件", shortcut: "Ctrl+K S", enabled: workspace.tabs.some((tab) => tab.dirty && tab.path && !tab.deleted), disabledReason: "没有未保存文件", run: () => void saveAll() },
    command("file.reveal", "在资源管理器中显露当前文件", "文件", undefined, revealCurrentFile, activeFileReady, "当前没有工作区文件"),
    command("editor.close", "关闭当前编辑器", "编辑器", "closeEditor", () => void closeActiveEditor(), Boolean(workspace.activeId), "没有打开的编辑器"),
    command("build.compile", "编译当前文件", "运行", undefined, () => void execution.compileCurrent(), buildReady, buildDisabledReason()),
    command("build.run", "编译并运行当前文件", "运行", "runCurrent", () => void execution.runCurrent(), buildReady, buildDisabledReason()),
    command("build.stop", "停止当前程序", "运行", undefined, () => void execution.stop(), execution.running, "当前没有运行中的程序"),
    command("test.runAll", "运行全部测试点", "运行", "runAll", () => { showActivity("testcases"); void execution.runAll(); }, buildReady && execution.testcases.length > 0, execution.testcases.length ? buildDisabledReason() : "尚未添加测试点"),
    command("debug.start", "开始调试", "调试", "debug", () => { showActivity("debug"); void debugStore.startCurrent(); }, debugStartReady(), debugDisabledReason()),
    { id: "debug.continue", label: "继续调试", category: "调试", shortcut: "F5", enabled: debugStore.active && debugStore.stopped && !debugStore.busy, disabledReason: "调试器尚未暂停", run: () => void debugStore.continueExecution() },
    { id: "debug.toggleBreakpoint", label: "切换当前行断点", category: "调试", shortcut: "F9", enabled: activeFileReady && !debugStore.breakpointBusy, disabledReason: "当前没有可设置断点的文件", run: () => {
      const path = workspace.activeTab?.path;
      if (path) void debugStore.toggleBreakpoint(path, workspace.cursorLine);
    } },
    { id: "debug.stepOver", label: "单步跳过", category: "调试", shortcut: "F10", enabled: debugStore.active && debugStore.stopped && !debugStore.busy, disabledReason: "调试器尚未暂停", run: () => void debugStore.stepOver() },
    { id: "debug.stepInto", label: "单步进入", category: "调试", shortcut: "F11", enabled: debugStore.active && debugStore.stopped && !debugStore.busy, disabledReason: "调试器尚未暂停", run: () => void debugStore.stepInto() },
    { id: "debug.stepOut", label: "单步跳出", category: "调试", shortcut: "Shift+F11", enabled: debugStore.active && debugStore.stopped && !debugStore.busy, disabledReason: "调试器尚未暂停", run: () => void debugStore.stepOut() },
    { id: "debug.restart", label: "重新启动调试", category: "调试", shortcut: "Ctrl+Shift+F5", enabled: debugStore.active && !debugStore.busy, disabledReason: "调试会话尚未启动", run: () => void debugStore.restart() },
    { id: "debug.stop", label: "停止调试", category: "调试", shortcut: "Shift+F5", enabled: debugStore.active && !debugStore.busy, disabledReason: "调试会话尚未启动", run: () => void debugStore.stop() },
    command("stress.start", "开始对拍", "竞赛", "stress", () => { showActivity("judge"); void stressStore.start(); }),
    command("view.explorer", "显示资源管理器", "视图", undefined, () => showActivity("explorer")),
    command("view.templates", "显示代码模板", "视图", undefined, () => showActivity("templates")),
    command("view.settings", "打开设置", "视图", undefined, () => openSettingsPage("theme")),
    command("view.problems", "显示问题面板", "视图", undefined, () => shell.showBottomPanel("problems")),
    command("view.output", "显示输出面板", "视图", undefined, () => shell.showBottomPanel("output")),
    command("view.toggleSidebar", "切换侧栏", "视图", "toggleSidebar", () => shell.toggleSidebar()),
    command("view.togglePanel", "切换底部面板", "视图", "togglePanel", () => shell.toggleBottomPanel()),
    { id: "view.zen", label: "切换禅模式", category: "视图", shortcut: "Ctrl+K Z", run: () => shell.toggleZenMode() },
    { id: "lsp.reconnect", label: "重新连接 clangd", category: "语言服务", enabled: Boolean(fileWorkspace.info) && lspStore.state !== "starting", disabledReason: fileWorkspace.info ? "clangd 正在连接" : "请先打开工作区", run: () => lspStore.reconnect() },
  ]);

  $effect(() => {
    if (shell.activeActivity === "templates") void templateStore.initialize();
  });

  $effect(() => {
    const path = workspace.activeTab?.path;
    const root = fileWorkspace.info?.path;
    if (path && root) untrack(() => void fileWorkspace.revealPath(path));
  });

  $effect(() => {
    if (!workspace.templateReference || TemplateReferenceWindow) return;
    void import("../editor/TemplateReferenceWindow.svelte").then((module) => {
      TemplateReferenceWindow = module.default;
    });
  });

  onMount(() => {
    let awaitingChordKey = false;
    let chordTimer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const keybindings = settings.value.keybindings;
      if (matchesShortcut(event, "commandPalette", keybindings)) {
        event.preventDefault();
        commandPaletteOpen = true;
        return;
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === ",") {
        event.preventDefault();
        openSettingsPage("theme");
        return;
      }
      if (matchesShortcut(event, "quickArchive", keybindings)) {
        event.preventDefault();
        archiveStore.openQuickArchive();
        return;
      }
      if (matchesShortcut(event, "quickTemplate", keybindings)) {
        event.preventDefault();
        quickSearchOpen = true;
        return;
      }
      if (matchesShortcut(event, "newFile", keybindings)) {
        event.preventDefault();
        void createSourceFile();
        return;
      }
      if (matchesShortcut(event, "quickOpen", keybindings)) {
        event.preventDefault();
        if (fileWorkspace.info) quickFileOpen = true;
        else {
          shell.activeActivity = "explorer";
          shell.sidebarVisible = true;
          ux.info("请先打开一个工作区，再使用快速打开文件。");
        }
        return;
      }
      if (matchesShortcut(event, "closeEditor", keybindings)) {
        event.preventDefault();
        if (workspace.activeId) void requestCloseTabs(workspace, ux, [workspace.activeId]);
        return;
      }
      if (matchesShortcut(event, "nextEditor", keybindings)) {
        event.preventDefault();
        switchEditor(1);
        return;
      }
      if (matchesShortcut(event, "previousEditor", keybindings)) {
        event.preventDefault();
        switchEditor(-1);
        return;
      }
      if (event.key === "Escape" && shell.zenMode) {
        event.preventDefault();
        shell.toggleZenMode();
        return;
      }
      const shortcutKey = event.key.toUpperCase();
      const formControlFocused = event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement;
      if (!formControlFocused && !event.altKey && !event.metaKey) {
        if (shortcutKey === "F9" && !event.ctrlKey && !event.shiftKey) {
          event.preventDefault();
          const path = workspace.activeTab?.path;
          if (path) void debugStore.toggleBreakpoint(path, workspace.cursorLine);
          return;
        }
        if (debugStore.active && shortcutKey === "F5") {
          event.preventDefault();
          if (event.ctrlKey && event.shiftKey) void debugStore.restart();
          else if (!event.ctrlKey && event.shiftKey) void debugStore.stop();
          else if (!event.ctrlKey && !event.shiftKey && debugStore.stopped) void debugStore.continueExecution();
          return;
        }
        if (debugStore.active && shortcutKey === "F10" && !event.ctrlKey && !event.shiftKey) {
          event.preventDefault();
          void debugStore.stepOver();
          return;
        }
        if (debugStore.active && shortcutKey === "F11" && !event.ctrlKey) {
          event.preventDefault();
          if (event.shiftKey) void debugStore.stepOut();
          else void debugStore.stepInto();
          return;
        }
      }
      if (matchesShortcut(event, "toggleSidebar", keybindings)) {
        event.preventDefault();
        shell.toggleSidebar();
        return;
      }
      if (matchesShortcut(event, "togglePanel", keybindings)) {
        event.preventDefault();
        shell.toggleBottomPanel();
        return;
      }
      if (matchesShortcut(event, "save", keybindings)) {
        event.preventDefault();
        void workspace.saveActive();
        return;
      }
      if (matchesShortcut(event, "runCurrent", keybindings)) {
        event.preventDefault();
        if (event.repeat) return;
        if (shell.activeActivity === "templates") shell.activeActivity = "explorer";
        void execution.runCurrent();
        return;
      }
      if (matchesShortcut(event, "runAll", keybindings)) {
        event.preventDefault();
        if (event.repeat) return;
        shell.activeActivity = "testcases";
        shell.sidebarVisible = true;
        void execution.runAll();
        return;
      }
      if (matchesShortcut(event, "stress", keybindings)) {
        event.preventDefault();
        if (event.repeat) return;
        shell.activeActivity = "judge";
        shell.sidebarVisible = true;
        void stressStore.start();
        return;
      }
      if (matchesShortcut(event, "debug", keybindings)) {
        event.preventDefault();
        if (event.repeat) return;
        shell.activeActivity = "debug";
        shell.sidebarVisible = true;
        void debugStore.startCurrent();
        return;
      }
      if (awaitingChordKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const chordKey = event.key.toLowerCase();
        awaitingChordKey = false;
        if (chordTimer) clearTimeout(chordTimer);
        if (chordKey === "z") {
          event.preventDefault();
          shell.toggleZenMode();
          return;
        }
        if (chordKey === "s") {
          event.preventDefault();
          void saveAll();
          return;
        }
      }
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        awaitingChordKey = true;
        if (chordTimer) clearTimeout(chordTimer);
        chordTimer = setTimeout(() => (awaitingChordKey = false), 1200);
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

  function command(
    id: string,
    label: string,
    category: string,
    shortcutId: keyof typeof settings.value.keybindings | undefined,
    run: () => void,
    enabled = true,
    disabledReason?: string,
  ): WorkbenchCommand {
    return {
      id,
      label,
      category,
      shortcut: shortcutId ? settings.value.keybindings[shortcutId] : undefined,
      enabled,
      disabledReason: enabled ? undefined : disabledReason,
      run,
    };
  }

  function showActivity(activity: typeof shell.activeActivity): void {
    shell.activeActivity = activity;
    shell.sidebarVisible = true;
  }

  function openSettingsPage(page: SettingsPage): void {
    shell.openSettings(page);
  }

  function toggleSettingsMenu(anchor: HTMLButtonElement): void {
    settingsMenuAnchor = settingsMenuAnchor ? undefined : anchor;
  }

  function closeSettingsMenu(restoreFocus = false): void {
    const anchor = settingsMenuAnchor;
    settingsMenuAnchor = undefined;
    if (restoreFocus) queueMicrotask(() => anchor?.focus());
  }

  function openSnippets(): void {
    showActivity("templates");
    void templateStore.initialize().then(() => templateStore.setKind("snippet"));
  }

  function openQuickFile(): void {
    if (fileWorkspace.info) quickFileOpen = true;
    else ux.info("请先打开一个工作区，再使用快速打开文件。");
  }

  function revealCurrentFile(): void {
    const path = workspace.activeTab?.path;
    if (!path) return;
    showActivity("explorer");
    void fileWorkspace.revealPath(path);
  }

  function buildDisabledReason(): string | undefined {
    if (!activeFileReady) return "当前没有可运行的文件";
    if (backendState !== "ready") return "本地后端尚未就绪";
    if (execution.compiling) return "正在编译";
    if (execution.running) return "程序正在运行";
    return undefined;
  }

  function debugStartReady(): boolean {
    return activeFileReady
      && backendState === "ready"
      && !execution.compiling
      && !execution.running
      && !debugStore.active
      && !debugStore.busy;
  }

  function debugDisabledReason(): string | undefined {
    if (!activeFileReady) return "当前没有可调试文件";
    if (backendState !== "ready") return "本地后端尚未就绪";
    if (execution.compiling || execution.running) return "请先结束当前编译或运行";
    if (debugStore.active) return "调试会话已启动";
    if (debugStore.busy) return "调试器正在处理命令";
    return undefined;
  }

  async function saveCurrent(): Promise<void> {
    if (await workspace.saveActive()) ux.success("已保存当前文件。");
    else if (workspace.notice) ux.error(workspace.notice);
  }

  async function closeActiveEditor(): Promise<void> {
    if (workspace.activeId) await requestCloseTabs(workspace, ux, [workspace.activeId]);
  }

  function switchEditor(direction: 1 | -1): void {
    if (workspace.tabs.length < 2) return;
    const current = workspace.tabs.findIndex((tab) => tab.id === workspace.activeId);
    const next = (Math.max(0, current) + direction + workspace.tabs.length) % workspace.tabs.length;
    workspace.switchTab(workspace.tabs[next].id);
    workspace.focus();
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

  async function createSourceFile(parent?: string): Promise<void> {
    if (!fileWorkspace.info) await fileWorkspace.openFolderPicker();
    const root = fileWorkspace.info?.path;
    if (!root) return;
    fileDialogParent = parent ?? root;
  }
</script>

<div class:zen-mode={shell.zenMode} class="app-shell">
  <div class="workspace-background" aria-hidden="true"></div>
  <div class="shell-body">
    {#if !shell.zenMode}
      <ActivityBar
        {shell}
        settingsMenuOpen={Boolean(settingsMenuAnchor)}
        {toggleSettingsMenu}
      />
    {/if}
    <div class="workbench">
      {#if shell.sidebarVisible && !shell.zenMode && shell.activeActivity !== "judge"}
        <Sidebar
          {shell}
          {workspace}
          {fileWorkspace}
          {templateStore}
          {execution}
          {generator}
          {archiveStore}
          debug={debugStore}
          {settings}
          {ux}
          newFile={(parent) => void createSourceFile(parent)}
        />
      {/if}
      <section class="editor-column" aria-label="编辑器工作台">
        {#if shell.themeStudioOpen && !shell.zenMode}
          <ThemeStudio
            {settings}
            {ux}
            close={() => shell.closeThemeStudio()}
            setDirty={(dirty) => shell.setThemeStudioDirty(dirty)}
          />
        {:else if shell.activeActivity === "templates" && !shell.zenMode}
          <TemplateCenter {templateStore} />
        {:else if shell.activeActivity === "judge" && !shell.zenMode}
          <StressCenter stress={stressStore} {generator} {workspace} />
        {:else}
          <TabBar
            {workspace}
            {ux}
            lsp={lspStore}
            keybindings={settings.value.keybindings}
            togglePanel={() => shell.toggleBottomPanel()}
            toggleZen={() => shell.toggleZenMode()}
            compile={() => void execution.compileCurrent()}
            run={() => void execution.runCurrent()}
            stop={() => void execution.stop()}
            busy={execution.compiling || execution.running}
            running={execution.running}
            newFile={() => void createSourceFile()}
          />
          {#if workspace.activeTab && !shell.zenMode}
            <EditorBreadcrumbs
              {workspace}
              {fileWorkspace}
              showExplorer={() => showActivity("explorer")}
            />
          {/if}
          <div class="editor-surface">
            {#if workspace.activeTab}
              <EditorHost {workspace} saveAsSnippet={saveSelectionAsSnippet} />
            {:else}
              <WelcomeView
                {fileWorkspace}
                {shell}
                keybindings={settings.value.keybindings}
                newFile={() => void createSourceFile()}
              />
            {/if}
            {#if workspace.templateReference && TemplateReferenceWindow}
              {#key workspace.templateReference.template.id}
                <TemplateReferenceWindow
                  {workspace}
                  {settings}
                  reference={workspace.templateReference.template}
                />
              {/key}
            {/if}
          </div>
          {#if shell.bottomPanelVisible && !shell.zenMode}
            <BottomPanel {shell} {workspace} {execution} debug={debugStore} lsp={lspStore} keybindings={settings.value.keybindings} {backendState} {health} />
          {/if}
        {/if}
        {#if shell.settingsWindowOpen && !shell.zenMode && !shell.themeStudioOpen}
          <SettingsWindow {settings} {shell} {ux} />
        {/if}
      </section>
    </div>
    {#if shell.zenMode}
      <button class="exit-zen" title="退出禅模式 · Escape" aria-label="退出禅模式" onclick={() => shell.toggleZenMode()}>
        <Icon name="zen" size={16} />
      </button>
    {/if}
  </div>
  <StatusBar {shell} {workspace} {fileWorkspace} lsp={lspStore} keybindings={settings.value.keybindings} {backendState} />
</div>

{#if settingsMenuAnchor}
  <SettingsMenu
    anchor={settingsMenuAnchor}
    commandShortcut={settings.value.keybindings.commandPalette}
    close={closeSettingsMenu}
    openCommandPalette={() => (commandPaletteOpen = true)}
    openSettings={openSettingsPage}
    {openSnippets}
    openTasks={() => showActivity("testcases")}
  />
{/if}

<UxOverlay {ux} />

{#if fileDialogParent}
  <FileTemplateDialog
    parent={fileDialogParent}
    {templateStore}
    {fileWorkspace}
    close={() => {
      fileDialogParent = undefined;
      workspace.focus();
    }}
  />
{/if}

{#if quickSearchOpen}
  <TemplateQuickSearch
    {templateStore}
    close={() => {
      quickSearchOpen = false;
      workspace.focus();
    }}
  />
{/if}

{#if quickFileOpen}
  <QuickFileOpen
    {workspace}
    shortcut={settings.value.keybindings.quickOpen}
    close={() => {
      quickFileOpen = false;
      workspace.focus();
    }}
  />
{/if}

{#if commandPaletteOpen}
  <CommandPalette
    commands={workbenchCommands}
    shortcut={settings.value.keybindings.commandPalette}
    close={() => {
      commandPaletteOpen = false;
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
