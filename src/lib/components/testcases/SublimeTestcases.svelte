<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import type { LspStore } from "../../stores/lsp.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { Testcase, TestcaseInput } from "../../types/execution";

  let { workspace, execution, drafts, ux, lsp, shell, openGenerator }: {
    lsp: LspStore; shell: ShellStore;
    workspace: EditorWorkspace; execution: ExecutionStore; ux: UxStore; openGenerator: () => void;
    drafts: Record<number, TestcaseInput>;
  } = $props();
  let editing = $state<number>();
  let saving = $state(false);
  let root = $state<HTMLElement>();
  let source = $derived(workspace.activeTab?.path);
  let busy = $derived(execution.busy || execution.compiling || execution.running || saving || execution.loadingTestcases);
  $effect(() => {
    const path = source;
    untrack(() => void execution.syncActiveSource(path));
  });
  $effect(() => execution.setBeforeTestRun(prepareRun));

  function draftFor(test: Testcase): TestcaseInput {
    return { sourcePath: test.sourcePath, kind: test.kind, name: test.name, input: test.input, expectedOutput: test.expectedOutput, enabled: test.enabled };
  }
  function edit(test: Testcase): void {
    drafts[test.id] ??= draftFor(test);
    editing = editing === test.id ? undefined : test.id;
  }
  async function saveDraft(id: number): Promise<Testcase | undefined> {
    const draft = drafts[id];
    if (!draft) return execution.testcases.find((item) => item.id === id);
    const submitted = { ...draft };
    const existing = execution.testcases.find((item) => item.id === id);
    if (existing && JSON.stringify(draftFor(existing)) === JSON.stringify(submitted)) {
      delete drafts[id];
      if (editing === id) editing = undefined;
      return existing;
    }
    const saved = await execution.saveTestcase(submitted, id);
    if (saved && JSON.stringify(drafts[id]) === JSON.stringify(submitted)) {
      delete drafts[id];
      if (editing === id) editing = undefined;
    }
    return saved;
  }
  async function save(id: number): Promise<void> {
    if (saving) return;
    saving = true;
    try { if (await saveDraft(id)) editing = undefined; }
    finally { saving = false; }
  }
  async function prepareRun(id?: number): Promise<Testcase | false | undefined> {
    if (saving) return false;
    const path = source;
    saving = true;
    try {
      let selected: Testcase | undefined;
      for (const test of [...execution.testcases]) {
        if (test.sourcePath !== path || id !== undefined && test.id !== id) continue;
        const saved = await saveDraft(test.id);
        if (!saved || source !== path) return false;
        if (test.id === id) selected = saved;
      }
      return selected;
    } finally { saving = false; }
  }
  async function create(): Promise<void> {
    if (!source || busy) return;
    const path = source;
    // Save edited tests before adding another one so a failed save stays visible.
    if (await prepareRun() === false) return;
    saving = true;
    try {
      const names = new Set(execution.testcases.map((test) => test.name));
      let index = 1;
      while (names.has(`样例 ${index}`)) index++;
      const saved = await execution.saveTestcase({ sourcePath: path, kind: "custom", name: `样例 ${index}`, input: "", expectedOutput: "", enabled: true });
      if (!saved || source !== path) return;
      drafts[saved.id] = draftFor(saved);
      editing = saved.id;
      await tick();
      root?.querySelector<HTMLTextAreaElement>(`[data-test-id="${saved.id}"] textarea`)?.focus();
    } finally { saving = false; }
  }
  async function remove(test: Testcase): Promise<void> {
    if (!await ux.confirm({ title: "删除测试点", message: `确定删除“${test.name}”吗？`, confirmLabel: "删除", danger: true })) return;
    await execution.remove(test.id);
    if (!execution.testcases.some((item) => item.id === test.id)) { delete drafts[test.id]; if (editing === test.id) editing = undefined; }
  }
  async function next(index: number): Promise<void> {
    const test = execution.testcases[index + 1];
    if (!test) { await create(); return; }
    drafts[test.id] ??= draftFor(test);
    editing = test.id;
    await tick();
    root?.querySelector<HTMLTextAreaElement>(`[data-test-id="${test.id}"] textarea`)?.focus();
  }
  function keys(event: KeyboardEvent): void {
    if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); void create(); }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="sublime-tests" aria-label="Sublime 测试点" bind:this={root} onkeydown={keys}>
  <div class="cph-toolbar">
    <button disabled={!source || busy} onclick={() => void execution.compileCurrent()} title="保存并重新编译当前文件">build</button>
    <button disabled={!source || busy || !execution.testcases.length} onclick={() => void execution.runAll()}>run all</button>
    <button disabled={!source || busy} onclick={() => void create()} title="新建测试点 · Ctrl+Enter">+ test</button>
    <button disabled={!source || busy} onclick={openGenerator} title="打开随机数据生成器">随机数据</button>
    {#if execution.busy}<button onclick={() => void execution.stop()}>stop</button>{/if}
  </div>
  <div class="cph-source" title={source}>{workspace.activeTab?.title ?? "请先打开 C++ 文件"}</div>
  <div class="cph-diagnostics" aria-live="polite">
    <button class:failed={lsp.errorCount > 0} onclick={() => shell.showBottomPanel("problems")} title="查看编译与实时诊断">{lsp.errorCount} 错误 · {lsp.warningCount} 警告</button>
    <span>{execution.compiling ? "正在编译…" : execution.running ? "正在运行…" : lsp.checkStatus(source)}</span>
    <button disabled={!source} onclick={() => lsp.recheck(source)} title="重新检查当前文件">重查</button>
  </div>
  {#if execution.error}<p class="cph-error" role="alert">{execution.error}</p>{/if}
  {#if execution.loadingTestcases}<p class="cph-hint">正在读取测试点…</p>
  {:else if execution.testcases.length === 0}<div class="cph-empty"><p>还没有测试点</p><button disabled={!source || busy} onclick={() => void create()}>next test</button><p class="cph-hint">添加输入与期望输出，或从题面导入样例。</p></div>{/if}
  {#each execution.testcases as test, index (test.id)}
    {@const result = execution.results.find((item) => item.testcaseId === test.id)}
    {@const draft = drafts[test.id]}
    {@const changed = draft && JSON.stringify(draft) !== JSON.stringify(draftFor(test))}
    <article class="cph-test" data-test-id={test.id}>
      <header>
        <strong class="cph-test-number" title={test.name}>test {index}</strong>
        <button class:active={editing === test.id} disabled={busy} onclick={() => edit(test)} aria-expanded={editing === test.id} aria-label={`编辑 ${test.name}`}>edit{changed ? " *" : ""}</button>
        <button disabled={busy} onclick={() => void remove(test)} aria-label={`删除 ${test.name}`} title="删除测试点">×</button>
      </header>
      <div class="cph-run-row">
        <button class="cph-run" disabled={busy} onclick={() => void execution.runOne(test)} aria-label={`运行 ${test.name}`}>run</button>
        <span class="cph-time">time: {result ? `${result.durationMs} ms` : "—"}</span>
        {#if result}<strong class="cph-verdict" title={result.status === "OK" ? "运行成功；未填写期望输出，未比较答案" : result.status} class:passed={result.status === "AC" || result.status === "OK"} class:failed={!["AC", "OK", "Running", "Stopped"].includes(result.status)}>{result.status === "OK" ? "已运行" : result.status}</strong>{/if}
      </div>
      {#if editing === test.id && draft}
        <form class="cph-edit" onsubmit={(event) => { event.preventDefault(); void save(test.id); }}>
          <label>名称<input bind:value={draft.name} required disabled={busy} /></label>
          <label>input<textarea aria-label={`${test.name} 输入`} bind:value={draft.input} spellcheck="false" disabled={busy}></textarea></label>
          <label>expected<textarea aria-label={`${test.name} 期望输出`} bind:value={draft.expectedOutput} spellcheck="false" disabled={busy} placeholder="留空时只运行，不比较答案"></textarea></label>
          <div class="cph-edit-actions"><label class="cph-enabled"><input type="checkbox" bind:checked={draft.enabled} disabled={busy}/>参与 run all</label><button type="submit" disabled={busy || !draft.name.trim()}>save</button><button type="button" disabled={busy} onclick={() => { delete drafts[test.id]; editing = undefined; }}>cancel</button></div>
        </form>
      {:else}
        <div class="cph-data"><span>input</span><pre>{(draft?.input ?? test.input) || "（空）"}</pre></div>
        {#if draft?.expectedOutput || test.expectedOutput}<div class="cph-data"><span>expected</span><pre>{draft?.expectedOutput ?? test.expectedOutput}</pre></div>{/if}
      {/if}
      {#if result}<div class="cph-data cph-output"><span>output</span><pre>{result.actualOutput || "（无输出）"}</pre>{#if result.stderr}<pre class="cph-error">{result.stderr}</pre>{/if}</div>{/if}
      <button class="cph-next" disabled={busy} onclick={() => void next(index)}>next test</button>
    </article>
  {/each}
</section>

<style>
  .sublime-tests { height: 100%; overflow: auto; padding: 14px 16px 28px; font: 13px/1.55 var(--editor-font-family, Consolas, monospace); }
  button { border: 1px solid transparent; border-radius: 0; background: color-mix(in srgb, var(--surface-raised) 80%, transparent); color: var(--text-primary); font: inherit; min-height: 25px; padding: 0 12px; cursor: pointer; transition: background-color 90ms ease; }
  button:hover:not(:disabled), button.active { background: var(--active-background); }
  button:active:not(:disabled) { background: var(--active-background); }
  button:disabled { opacity: .45; cursor: default; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
  .cph-toolbar { display: flex; flex-wrap: wrap; gap: 2px; }
  .cph-source { color: var(--text-muted); font-size: 11px; margin: 7px 0 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cph-diagnostics { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: -10px 0 18px; font-size: 11px; color: var(--text-secondary); }
  .cph-diagnostics button { padding-inline: 6px; font-size: 11px; }
  .cph-diagnostics .failed { color: var(--danger); background: var(--panel-background); border-color: var(--danger); font-weight: 600; }
  .cph-test { margin-bottom: 28px; padding-bottom: 6px; }
  header, .cph-run-row { display: flex; align-items: stretch; gap: 0; }
  .cph-test-number { display: flex; align-items: center; min-height: 25px; padding: 0 12px; font-weight: 400; color: var(--text-primary); background: color-mix(in srgb, #626f49 80%, transparent); }
  .cph-run { background: color-mix(in srgb, #477780 84%, transparent); }
  .cph-run-row { margin-top: 0; }
  .cph-time { display: flex; align-items: center; min-height: 25px; background: color-mix(in srgb, var(--surface-raised) 72%, transparent); padding: 0 12px; color: var(--text-secondary); }
  .cph-verdict { color: var(--text-secondary); font-size: 12px; padding-inline: 5px; }
  .cph-verdict.passed { color: var(--success); } .cph-verdict.failed, .cph-error { color: var(--danger); }
  .cph-data { margin-top: 12px; } .cph-data > span, .cph-edit > label { color: var(--text-muted); font-size: 11px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 2px 0 0; font: inherit; }
  .cph-output { border-left: 2px solid var(--border-strong); padding-left: 10px; }
  .cph-next { margin-top: 8px; min-width: 120px; } .cph-hint { color: var(--text-muted); font-size: 12px; }
  .cph-edit { display: grid; gap: 9px; margin-top: 14px; } .cph-edit > label { display: grid; gap: 3px; }
  input, textarea { width: 100%; min-width: 0; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 0; color: var(--text-primary); background: var(--editor-background); font: 13px/1.55 var(--editor-font-family, Consolas, monospace); }
  textarea { min-height: 80px; resize: vertical; tab-size: 4; }
  .cph-edit-actions { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; } .cph-enabled { display: flex; gap: 5px; align-items: center; color: var(--text-secondary); font-size: 11px; margin-right: auto; } .cph-enabled input { width: auto; }
  .cph-error { white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
