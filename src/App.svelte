<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { healthCheck } from "./lib/api/health";
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
  import type { CommandError, HealthStatus } from "./lib/types/health";

  const shell = new ShellStore();
  const settings = new SettingsStore();

  let workspace = $state<EditorWorkspace>();
  let fileWorkspace = $state<WorkspaceStore>();
  let templateStore = $state<TemplateStore>();
  let execution = $state<ExecutionStore>();
  let archiveStore = $state<ArchiveStore>();
  let debugStore = $state<DebugStore>();
  let stressStore = $state<StressStore>();
  const generator = new GeneratorStore();
  let backendState = $state<"checking" | "ready" | "error">("checking");
  let health = $state<HealthStatus>();
  let editorLoadError = $state("");

  $effect(() => {
    const appearance = settings.value;
    applyDocumentAppearance(appearance);
    untrack(() => workspace?.updateAppearance(appearance));
  });

  onMount(() => {
    let disposed = false;
    void Promise.all([
      settings.initialize(),
      import("./lib/editor/workspace.svelte"),
    ])
      .then(([, editorModule]) => {
        const editor = new editorModule.EditorWorkspace(settings.value);
        if (disposed) return;
        workspace = editor;
        archiveStore = new ArchiveStore(editor);
        fileWorkspace = new WorkspaceStore(editor, archiveStore);
        templateStore = new TemplateStore(editor);
        execution = new ExecutionStore(editor, settings, shell);
        debugStore = new DebugStore(editor, execution, settings, shell);
        stressStore = new StressStore(editor, generator, execution, debugStore, settings, shell);
        void fileWorkspace.initialize();
        void templateStore.initialize();
        void execution.initialize();
        void debugStore.initialize();
        void stressStore.initialize();
      })
      .catch((error: unknown) => {
        editorLoadError = error instanceof Error ? error.message : String(error);
      });

    void (async () => {
      try {
        health = await healthCheck();
        backendState = "ready";
      } catch (error) {
        const commandError = error as Partial<CommandError>;
        console.info(commandError.userMessage ?? "浏览器预览模式下无法使用 Rust IPC。");
        backendState = "error";
      }
    })();

    return () => {
      disposed = true;
      fileWorkspace?.dispose();
      templateStore?.dispose();
      execution?.dispose();
      debugStore?.dispose();
      stressStore?.dispose();
      archiveStore?.dispose();
      generator.dispose();
      settings.dispose();
    };
  });
</script>

<svelte:head>
  <title>LightCP</title>
</svelte:head>

{#if workspace && fileWorkspace && templateStore && execution && archiveStore && debugStore && stressStore}
  <Workbench {shell} {workspace} {fileWorkspace} {templateStore} {execution} {archiveStore} {debugStore} {stressStore} {generator} {settings} {backendState} {health} />
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
