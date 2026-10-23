<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ShellStore, SublimeToolPage } from "../../stores/shell.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import type { LspStore } from "../../stores/lsp.svelte";
  import SublimeTestcases from "../testcases/SublimeTestcases.svelte";
  import Icon from "./Icon.svelte";
  import type { TestcaseInput } from "../../types/execution";
  let { shell, workspace, execution, drafts, ux, lsp, openGenerator, importSample }: {
    lsp: LspStore;
    shell: ShellStore; workspace: EditorWorkspace; execution: ExecutionStore; ux: UxStore;
    drafts: Record<number, TestcaseInput>;
    openGenerator: () => void;
    importSample: (sample: { name: string; input: string; expectedOutput: string }) => Promise<boolean>;
  } = $props();
  const pages: { id: SublimeToolPage; label: string }[] = [{ id: "testcases", label: "测试点" }, { id: "statement", label: "题面" }];
  let ProblemReader = $state.raw<(typeof import("../reader/ProblemReader.svelte"))["default"]>();
  let stopResize = () => {};
  let tabs = $state<HTMLElement>();
  $effect(() => {
    if (shell.sublimeToolPage !== "statement" || ProblemReader) return;
    untrack(() => { void import("../reader/ProblemReader.svelte").then((module) => { ProblemReader = module.default; }); });
  });
  onDestroy(() => stopResize());
  function resize(event: PointerEvent): void {
    event.preventDefault(); stopResize();
    const x = event.clientX, width = shell.problemReaderWidth;
    const move = (event: PointerEvent) => shell.setProblemReaderWidth(width + x - event.clientX);
    const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", cleanup); window.removeEventListener("pointercancel", cleanup); stopResize = () => {}; };
    stopResize = cleanup;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", cleanup); window.addEventListener("pointercancel", cleanup);
  }
  function tabKey(event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = pages.findIndex((page) => page.id === shell.sublimeToolPage);
    const next = event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + pages.length) % pages.length;
    shell.showSublimeTool(pages[next].id);
    tabs?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
</script>

<aside class="sublime-tools" class:tools-hidden={!shell.sublimeToolsVisible || shell.zenMode} style:width={`${shell.problemReaderWidth}px`} aria-label="测试点与题面">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="tools-resize" role="separator" tabindex="0" aria-label="调整右侧工具面板宽度" aria-orientation="vertical" aria-valuemin="300" aria-valuemax="760" aria-valuenow={shell.problemReaderWidth} onpointerdown={resize} onkeydown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); shell.setProblemReaderWidth(shell.problemReaderWidth + (event.key === "ArrowLeft" ? 12 : -12)); } }}></div>
  <header>
    <div role="tablist" tabindex="-1" aria-label="右侧工具页面" bind:this={tabs} onkeydown={tabKey}>
      {#each pages as page}<button id={`sublime-tab-${page.id}`} role="tab" aria-selected={shell.sublimeToolPage === page.id} aria-controls={`sublime-page-${page.id}`} tabindex={shell.sublimeToolPage === page.id ? 0 : -1} class:active={shell.sublimeToolPage === page.id} onclick={() => shell.showSublimeTool(page.id)}>{page.label}</button>{/each}
    </div>
    <button class="tools-close" aria-label="隐藏右侧工具面板" title="隐藏面板，可从工具菜单重新打开" onclick={() => { shell.sublimeToolsVisible = false; }}><Icon name="close" size={14}/></button>
  </header>
  <div class="tool-page" id="sublime-page-testcases" role="tabpanel" aria-labelledby="sublime-tab-testcases" hidden={shell.sublimeToolPage !== "testcases"}><SublimeTestcases {workspace} {execution} {drafts} {ux} {lsp} {shell} {openGenerator}/></div>
  <div class="tool-page reader-page" id="sublime-page-statement" role="tabpanel" aria-labelledby="sublime-tab-statement" hidden={shell.sublimeToolPage !== "statement"}>
    {#if ProblemReader}<ProblemReader sourcePath={workspace.activeTab?.path} sourceTitle={workspace.activeTab?.title} width={shell.problemReaderWidth} dock="right" setWidth={(width) => shell.setProblemReaderWidth(width)} toggleDock={() => {}} close={() => { shell.sublimeToolsVisible = false; }} {importSample} {ux} embedded />{:else}<p class="tools-loading">正在加载题面…</p>{/if}
  </div>
</aside>

<style>
  .sublime-tools { position: relative; min-width: 300px; max-width: min(760px, 58%); flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border-strong); background: var(--sidebar-background); color: var(--text-primary); }
  .sublime-tools.tools-hidden { display: none; }
  header { height: 33px; flex: 0 0 33px; display: flex; justify-content: space-between; align-items: stretch; background: var(--tab-background); border-bottom: 1px solid var(--border-subtle); }
  [role="tablist"] { display: flex; min-width: 0; }
  header button { border: 0; border-radius: 0; padding: 0 15px; color: var(--text-muted); background: transparent; font-size: 12px; cursor: pointer; transition: color 90ms ease, background-color 90ms ease; }
  header button:hover { background: var(--surface-hover); color: var(--text-primary); } header button.active { color: var(--text-primary); background: var(--sidebar-background); box-shadow: inset 0 -2px var(--accent); }
  header .tools-close { padding: 0 10px; display: grid; place-items: center; }
  button:focus-visible, .tools-resize:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }
  .tool-page { flex: 1; min-height: 0; min-width: 0; overflow: hidden; } .tool-page[hidden] { display: none; } .reader-page { display: flex; }
  .tools-resize { position: absolute; z-index: 5; top: 0; bottom: 0; left: -4px; width: 8px; cursor: ew-resize; touch-action: none; }
  .tools-resize:hover { background: color-mix(in srgb, var(--accent) 40%, transparent); }
  .tools-loading { color: var(--text-muted); font-size: 12px; padding: 16px; }
  @media (prefers-reduced-motion: reduce) { header button { transition: none; } }
</style>
