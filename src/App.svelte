<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { healthCheck } from "./lib/api/health";
  import TitleBar from "./lib/components/shell/TitleBar.svelte";
  import Workbench from "./lib/components/shell/Workbench.svelte";
  import type { EditorWorkspace } from "./lib/editor/workspace.svelte";
  import {
    applyDocumentAppearance,
    SettingsStore,
  } from "./lib/stores/settings.svelte";
  import { ShellStore } from "./lib/stores/shell.svelte";
  import { ArchiveStore } from "./lib/stores/archive.svelte";
  import { ExecutionStore } from "./lib/stores/execution.svelte";
  import { GeneratorStore } from "./lib/stores/generator.svelte";
  import { DebugStore } from "./lib/stores/debug.svelte";
  import { StressStore } from "./lib/stores/stress.svelte";
  import { TemplateStore } from "./lib/stores/templates.svelte";
  import { WorkspaceStore } from "./lib/stores/workspace.svelte";
  import { LspStore } from "./lib/stores/lsp.svelte";
  import { UxStore } from "./lib/stores/ux.svelte";
  import { SessionStore } from "./lib/stores/session";
  import type { CommandError, HealthStatus } from "./lib/types/health";
  import {
    installPerformanceConsole,
    markFrontendReady,
    registerPerformanceReaders,
  } from "./lib/performance";

  const shell = new ShellStore();
  const settings = new SettingsStore();
  const ux = new UxStore();

  let workspace = $state<EditorWorkspace>();
  let fileWorkspace = $state<WorkspaceStore>();
  let templateStore = $state<TemplateStore>();
  let execution = $state<ExecutionStore>();
  let archiveStore = $state<ArchiveStore>();
  let debugStore = $state<DebugStore>();
  let stressStore = $state<StressStore>();
  let lspStore = $state<LspStore>();
  let sessionStore = $state<SessionStore>();
  const generator = new GeneratorStore();
  let backendState = $state<"checking" | "ready" | "error">("checking");
  let health = $state<HealthStatus>();
  let editorLoadError = $state("");

  $effect(() => {
    const appearance = settings.value;
    applyDocumentAppearance(appearance);
    untrack(() => workspace?.updateAppearance(appearance));
  });

  $effect(() => {
    fileWorkspace?.info?.path;
    shell.activeActivity;
    shell.sidebarVisible;
    shell.bottomPanelVisible;
    shell.activeBottomPanel;
    shell.sidebarWidth;
    shell.bottomPanelHeight;
    untrack(() => sessionStore?.schedulePersist());
  });

  $effect(() => {
    const errors = [
      settings.errorMessage,
      fileWorkspace?.error,
      templateStore?.error,
      execution?.error,
      archiveStore?.error,
      debugStore?.error,
      stressStore?.error,
      generator.error,
    ].filter((message): message is string => Boolean(message));
    untrack(() => errors.forEach((message) => ux.error(message)));
  });

  $effect(() => {
    const root = fileWorkspace?.info?.path;
    const clangdPath = settings.value.clangdPath;
    const compilerPath = settings.value.compilerPath;
    const compilerStandard = settings.value.compilerStandard;
    const compilerArgs = [...settings.value.releaseArgs];
    untrack(() => lspStore?.configure(
      root,
      clangdPath,
      compilerPath,
      compilerStandard,
      compilerArgs,
    ));
  });

  onMount(() => {
    let disposed = false;
    const systemTheme = window.matchMedia("(prefers-color-scheme: light)");
    const refreshSystemTheme = () => {
      if (settings.value.theme !== "system") return;
      applyDocumentAppearance(settings.value);
      workspace?.updateAppearance(settings.value);
    };
    systemTheme.addEventListener("change", refreshSystemTheme);
    installPerformanceConsole();
    void Promise.all([
      settings.initialize(),
      import("./lib/editor/workspace.svelte"),
    ])
      .then(([, editorModule]) => {
        const editor = new editorModule.EditorWorkspace(settings.value);
        if (disposed) return;
        editor.setExternalConflictResolver(({ title }) => ux.confirm({
          title: "文件已在磁盘上更改",
          message: `“${title}”在 LightCP 外部被修改。确认后将用编辑器中的内容覆盖磁盘版本。`,
          confirmLabel: "覆盖磁盘文件",
          danger: true,
        }));
        workspace = editor;
        lspStore = new LspStore(editor, shell);
        archiveStore = new ArchiveStore(editor, ux);
        fileWorkspace = new WorkspaceStore(editor, archiveStore);
        fileWorkspace.setWorkspaceChangeGuard(async (nextPath) => {
          const dirty = editor.tabs.filter((tab) => tab.dirty);
          if (dirty.length === 0) return true;
          const names = dirty.slice(0, 5).map((tab) => `“${tab.title}”`).join("、");
          const remainder = dirty.length > 5 ? ` 等 ${dirty.length} 个文件` : "";
          const choice = await ux.choose({
            title: "切换工作区",
            message: `${names}${remainder}包含未保存的更改。\n即将打开：${nextPath}`,
            confirmLabel: "保存并切换",
            secondaryLabel: "不保存",
            secondaryDanger: true,
          });
          if (choice === "cancel") return false;
          if (choice === "secondary") return true;
          for (const tab of dirty) {
            if (await editor.saveTab(tab.id)) continue;
            ux.error(editor.notice || `无法保存 ${tab.title}，已取消切换工作区。`);
            return false;
          }
          return true;
        });
        templateStore = new TemplateStore(editor, ux);
        execution = new ExecutionStore(
          editor,
          settings,
          shell,
          (sourcePath) => lspStore?.acceptSuccessfulCompile(sourcePath),
        );
        debugStore = new DebugStore(editor, execution, settings, shell);
        stressStore = new StressStore(editor, generator, execution, debugStore, settings, shell);
        sessionStore = new SessionStore(fileWorkspace, editor, shell, ux);
        registerPerformanceReaders(
          () => execution!.approximateOutputBytes + debugStore!.approximateOutputBytes,
          () =>
            Number(execution!.running)
            + Number(debugStore!.active)
            + Number(stressStore!.running)
            + Number(lspStore!.state === "starting" || lspStore!.ready),
        );
        void fileWorkspace.initialize().then(() => sessionStore?.initialize());
        void execution.initialize();
        void debugStore.initialize();
        void stressStore.initialize();
        requestAnimationFrame(() => markFrontendReady());
      })
      .catch((error: unknown) => {
        if (disposed) return;
        editorLoadError = error instanceof Error ? error.message : String(error);
      });

    void (async () => {
      try {
        const result = await healthCheck();
        if (disposed) return;
        health = result;
        backendState = "ready";
      } catch (error) {
        if (disposed) return;
        const commandError = error as Partial<CommandError>;
        console.info(commandError.userMessage ?? "浏览器预览模式下无法使用 Rust IPC。");
        backendState = "error";
      }
    })();

    return () => {
      disposed = true;
      systemTheme.removeEventListener("change", refreshSystemTheme);
      sessionStore?.dispose();
      fileWorkspace?.dispose();
      templateStore?.dispose();
      execution?.dispose();
      debugStore?.dispose();
      stressStore?.dispose();
      archiveStore?.dispose();
      lspStore?.dispose();
      workspace?.dispose();
      generator.dispose();
      settings.dispose();
      ux.dispose();
    };
  });
</script>

<svelte:head>
  <title>LightCP</title>
</svelte:head>

<div class="window-frame">
  <TitleBar />
  <div class="window-content">
    {#if workspace && fileWorkspace && templateStore && execution && archiveStore && debugStore && stressStore && lspStore}
      <Workbench {shell} {workspace} {fileWorkspace} {templateStore} {execution} {archiveStore} {debugStore} {stressStore} {lspStore} {generator} {settings} {ux} {backendState} {health} />
    {:else}
      <main class="boot-screen" aria-live="polite">
        <div class="boot-mark">L</div>
        {#if editorLoadError}
          <p>编辑器加载失败</p>
          <span>{editorLoadError}</span>
        {:else}
          <p>正在启动 LightCP…</p>
        {/if}
      </main>
    {/if}
  </div>
</div>
