<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { Testcase, TestcaseInput, TestcaseKind } from "../../types/execution";
  import Icon from "../shell/Icon.svelte";
  import type { KeybindingMap } from "../../keybindings";
  import { shouldShowTestcaseEmptyState, testcaseEditorToggle } from "./testcaseEditorState";
  import type { UxStore } from "../../stores/ux.svelte";

  interface Props {
    workspace: EditorWorkspace;
    execution: ExecutionStore;
    shell: ShellStore;
    keybindings: KeybindingMap;
    ux: UxStore;
  }

  let { workspace, execution, shell, keybindings, ux }: Props = $props();
  let editingId = $state<number>();
  let formOpen = $state(false);
  let saving = $state(false);
  let draft = $state<TestcaseInput>(emptyDraft(""));
  let observedSource = "";
  let sourceTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    if (sourceTimer) clearTimeout(sourceTimer);
  });

  $effect(() => {
    const sourcePath = workspace.activeTab?.path;
    if ((sourcePath ?? "") === observedSource) return;
    observedSource = sourcePath ?? "";
    untrack(() => {
      formOpen = false;
      editingId = undefined;
      draft = emptyDraft(sourcePath ?? "");
      if (sourceTimer) clearTimeout(sourceTimer);
      sourceTimer = setTimeout(() => {
        sourceTimer = undefined;
        void execution.syncActiveSource(sourcePath, true);
      }, 80);
    });
  });

  function beginCreate(kind: TestcaseKind = "sample"): void {
    const sourcePath = workspace.activeTab?.path;
    if (!sourcePath) return;
    editingId = undefined;
    draft = { ...emptyDraft(sourcePath), kind, name: nextName(kind) };
    formOpen = true;
  }

  function beginEdit(testcase: Testcase): void {
    const action = testcaseEditorToggle(formOpen, editingId, testcase.id);
    if (action === "collapse") {
      formOpen = false;
      return;
    }
    if (action === "resume") {
      formOpen = true;
      return;
    }
    editingId = testcase.id;
    draft = inputFromTestcase(testcase);
    formOpen = true;
  }

  async function save(): Promise<void> {
    if (!draft.name.trim() || saving) return;
    saving = true;
    const saved = await execution.saveTestcase(draft, editingId);
    saving = false;
    if (saved) {
      editingId = saved.id;
      draft = inputFromTestcase(saved);
      formOpen = false;
    }
  }

  async function toggleEnabled(testcase: Testcase, enabled: boolean): Promise<void> {
    await execution.saveTestcase({ ...inputFromTestcase(testcase), enabled }, testcase.id);
  }

  async function removeTestcase(testcase: Testcase): Promise<void> {
    if (!await ux.confirm({
      title: "删除测试点",
      message: `确定删除“${testcase.name}”吗？此操作无法撤销。`,
      confirmLabel: "删除测试点",
      danger: true,
    })) return;
    await execution.remove(testcase.id);
  }

  function beginDrag(event: DragEvent, testcase: Testcase): void {
    event.dataTransfer?.setData("application/x-lightcp-testcase", String(testcase.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function dropBefore(event: DragEvent, index: number): void {
    event.preventDefault();
    const id = Number(event.dataTransfer?.getData("application/x-lightcp-testcase"));
    if (id) void execution.move(id, index);
  }

  function moveWithKeyboard(event: KeyboardEvent, testcase: Testcase, index: number): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const targetIndex = index + (event.key === "ArrowUp" ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= execution.testcases.length) return;
    event.preventDefault();
    void execution.move(testcase.id, targetIndex);
  }

  function resultStatus(id: number): string | undefined {
    return execution.results.find((result) => result.testcaseId === id)?.status;
  }

  function kindLabel(kind: TestcaseKind): string {
    if (kind === "sample") return "样例";
    if (kind === "custom") return "自定义";
    return "Hack 数据";
  }

  function statusLabel(status?: string): string {
    if (status === "Stopped") return "已停止";
    if (status === "Running") return "运行中";
    return status ?? "";
  }

  function nextName(kind: TestcaseKind): string {
    const count = execution.testcases.filter((testcase) => testcase.kind === kind).length + 1;
    return `${kindLabel(kind)} ${count}`;
  }
</script>

{#snippet testcaseEditor()}
  <form class="case-editor" aria-label={editingId ? "编辑测试点" : "新建测试点"} onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <header class="case-editor-header">
      <div>
        <strong>{editingId ? "编辑测试点" : "新建测试点"}</strong>
      </div>
      <button class="icon-button" type="button" aria-label="关闭编辑器" title="关闭" onclick={() => (formOpen = false)}><Icon name="close" size={14} /></button>
    </header>

    <div class="case-meta-grid">
      <label><span>名称</span><input required autocomplete="off" placeholder="例如：样例 1" bind:value={draft.name} /></label>
    </div>

    <div class="case-io-grid">
      <label class="case-io-field">
        <span class="case-io-heading"><strong>输入</strong><small>stdin</small></span>
        <span class="case-code-field"><textarea spellcheck="false" placeholder="在这里输入测试数据…" bind:value={draft.input}></textarea></span>
      </label>
      <label class="case-io-field">
        <span class="case-io-heading"><strong>预期输出</strong><small>stdout</small></span>
        <span class="case-code-field"><textarea spellcheck="false" placeholder="在这里输入正确答案…" bind:value={draft.expectedOutput}></textarea></span>
      </label>
    </div>

    <footer class="case-editor-footer">
      <label class="case-enabled"><input type="checkbox" bind:checked={draft.enabled} /><span><strong>启用此测试点</strong><small>运行全部时包含该用例</small></span></label>
      <div>
        <button class="secondary-button" type="button" onclick={() => (formOpen = false)}>取消</button>
        <button class="primary-button" disabled={saving || !draft.name.trim()}>{saving ? "正在保存…" : "保存测试点"}</button>
      </div>
    </footer>
  </form>
{/snippet}

<div class="testcase-panel">
  <nav class="testcase-tabs" aria-label="测试点模式">
    <button class:active={!shell.generatorOpen} aria-pressed={!shell.generatorOpen} onclick={() => (shell.generatorOpen = false)}>
      <span>测试点</span><em>{execution.testcases.length}</em>
    </button>
    <button class:active={shell.generatorOpen} aria-pressed={shell.generatorOpen} onclick={() => shell.openGenerator()}>随机数据 <Icon name="chevron-right" size={12} /></button>
  </nav>

  {#if !workspace.activeTab?.path}
    <div class="empty-state compact">
      <Icon name="testcases" size={28} />
      <p>先打开一个 C++ 文件</p>
      <span>打开后可添加输入和预期输出，检查程序是否正确。</span>
      <button class="secondary-button" onclick={() => { shell.generatorOpen = false; shell.activeActivity = "explorer"; }}>浏览文件</button>
    </div>
  {:else}
    <section class="case-toolbar" aria-label="测试点操作">
      <div class="case-file-context">
        <span>{execution.testcases.length} 个测试点</span>
        <small title={workspace.activeTab.title}>{workspace.activeTab.title}</small>
      </div>
      <div class="case-toolbar-actions">
        {#if execution.running}
          <button class="danger-button" onclick={() => void execution.stop()} disabled={execution.stopping}><Icon name="stop" size={13} />{execution.stopping ? "停止中…" : "停止"}</button>
        {:else}
          <button class="primary-button run-all" title={`运行全部 · ${keybindings.runAll}`} onclick={() => { shell.generatorOpen = false; void execution.runAll(); }} disabled={execution.compiling || execution.testcases.every((testcase) => !testcase.enabled)}><Icon name="play" size={13} /><span>运行全部</span><kbd>{keybindings.runAll}</kbd></button>
        {/if}
        <button class="secondary-button new-case" disabled={execution.running || execution.compiling} onclick={() => beginCreate()}><Icon name="plus" size={13} /><span>新建</span></button>
      </div>
    </section>

    <div class="fixed-testcase-list" role="list" aria-label="固定测试点">
      {#if formOpen && editingId === undefined}
        {@render testcaseEditor()}
      {/if}
      {#if execution.loadingTestcases}
        <div class="case-loading" aria-label="正在加载测试点"><span></span><span></span><span></span></div>
      {/if}
      {#each execution.testcases as testcase, index (testcase.id)}
        <article class="testcase-card" class:expanded={formOpen && editingId === testcase.id} role="listitem">
          <div
            class="testcase-card-row"
            role="group"
            class:disabled={!testcase.enabled}
            ondragover={(event) => event.preventDefault()}
            ondrop={(event) => dropBefore(event, index)}
          >
            <span
              class="case-drag-handle"
              role="button"
              tabindex="0"
              aria-label={`调整 ${testcase.name} 排序，按 Alt 加上方向键移动`}
              title="拖动排序 · Alt+↑/↓ 移动"
              draggable="true"
              ondragstart={(event) => beginDrag(event, testcase)}
              onkeydown={(event) => moveWithKeyboard(event, testcase, index)}
            ><Icon name="grip" size={14} /></span>
            <span class="case-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <input
              class="case-checkbox"
              type="checkbox"
              aria-label={`启用 ${testcase.name}`}
              checked={testcase.enabled}
              onchange={(event) => void toggleEnabled(testcase, event.currentTarget.checked)}
            />
            <button
              class="testcase-main"
              class:active={formOpen && editingId === testcase.id}
              aria-expanded={formOpen && editingId === testcase.id}
              title="编辑测试点 · Alt+↑/↓ 排序"
              onclick={() => beginEdit(testcase)}
              onkeydown={(event) => moveWithKeyboard(event, testcase, index)}
            >
              <span class="case-name"><strong>{testcase.name}</strong><small>{kindLabel(testcase.kind)}</small></span>
              {#if resultStatus(testcase.id)}<em class={`result-${resultStatus(testcase.id)?.toLowerCase()}`}><i></i>{statusLabel(resultStatus(testcase.id))}</em>{/if}
            </button>
            <div class="case-row-actions">
              <button class="case-action run" title="运行测试点" aria-label={`运行 ${testcase.name}`} disabled={execution.running || execution.compiling || !testcase.enabled} onclick={() => { shell.generatorOpen = false; void execution.runOne(testcase); }}><Icon name="play" size={13} /></button>
              <button class="case-action" title="复制测试点" aria-label={`复制 ${testcase.name}`} onclick={() => void execution.duplicate(testcase.id)}><Icon name="copy" size={13} /></button>
              <button class="case-action delete" title="删除测试点" aria-label={`删除 ${testcase.name}`} onclick={() => void removeTestcase(testcase)}><Icon name="trash" size={13} /></button>
            </div>
          </div>
          {#if formOpen && editingId === testcase.id}
            {@render testcaseEditor()}
          {/if}
        </article>
      {/each}
      {#if shouldShowTestcaseEmptyState(formOpen, execution.loadingTestcases, execution.testcases.length)}
        <div class="case-empty">
          <span class="case-empty-icon"><Icon name="testcases" size={22} /></span>
          <strong>还没有固定测试点</strong>
          <span>添加输入和预期输出，就可以一键校验程序。</span>
          <button class="secondary-button" onclick={() => beginCreate("sample")}><Icon name="plus" size={13} />添加第一个样例</button>
        </div>
      {/if}
    </div>

    {#if execution.error}<p class="case-error" role="alert"><Icon name="warning" size={13} />{execution.error}</p>{/if}
  {/if}
</div>

<script lang="ts" module>
  function emptyDraft(sourcePath: string): TestcaseInput {
    return {
      sourcePath,
      kind: "sample",
      name: "样例 1",
      input: "",
      expectedOutput: "",
      enabled: true,
    };
  }

  function inputFromTestcase(testcase: Testcase): TestcaseInput {
    return {
      sourcePath: testcase.sourcePath,
      kind: testcase.kind,
      name: testcase.name,
      input: testcase.input,
      expectedOutput: testcase.expectedOutput,
      enabled: testcase.enabled,
    };
  }
</script>

<style>
  .testcase-panel {
    container-type: inline-size;
    display: flex;
    min-height: 0;
    height: 100%;
    flex-direction: column;
    overflow: hidden;
    color: var(--text-primary);
    background: transparent;
  }

  .testcase-tabs {
    display: flex;
    flex: 0 0 auto;
    gap: 18px;
    height: 39px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--sidebar-background) 86%, transparent);
  }

  .testcase-tabs button {
    position: relative;
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    padding: 0 1px;
    border: 0;
    border-radius: 0;
    color: var(--text-muted);
    background: transparent;
    font-size: var(--ui-font-small);
    font-weight: 620;
  }

  .testcase-tabs button::after {
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    background: transparent;
    content: "";
  }

  .testcase-tabs button:hover {
    color: var(--text-secondary);
  }

  .testcase-tabs button.active {
    color: var(--text-primary);
  }

  .testcase-tabs button.active::after {
    background: var(--accent);
  }

  .testcase-tabs em {
    display: inline-grid;
    min-width: 17px;
    height: 17px;
    place-items: center;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 9px;
    color: var(--text-muted);
    background: var(--surface-sunken);
    font-family: var(--utility-font);
    font-size: var(--ui-font-caption);
    font-style: normal;
    font-weight: 650;
  }

  .case-toolbar {
    display: flex;
    min-height: 49px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 9px 7px 12px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 45%, transparent);
  }

  .case-file-context {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }

  .case-file-context > span {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: var(--ui-font-small);
    font-weight: 650;
    white-space: nowrap;
  }

  .case-file-context small {
    overflow: hidden;
    max-width: 126px;
    color: var(--text-muted);
    font-family: var(--utility-font);
    font-size: var(--ui-font-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .case-toolbar-actions,
  .case-editor-footer > div,
  .case-row-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .case-toolbar-actions button,
  .case-editor-footer button,
  .case-empty button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    white-space: nowrap;
  }

  .case-toolbar-actions button {
    min-height: 30px;
    padding-inline: 9px;
  }

  .case-toolbar-actions .run-all {
    box-shadow: none;
  }

  .case-toolbar-actions kbd {
    margin-left: 2px;
    padding: 1px 4px;
    border: 1px solid color-mix(in srgb, var(--accent-contrast) 25%, transparent);
    border-radius: 3px;
    color: inherit;
    background: color-mix(in srgb, var(--accent-contrast) 8%, transparent);
    font: var(--ui-font-small)/1.45 var(--utility-font);
    opacity: 0.78;
  }

  .fixed-testcase-list {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    overflow: auto;
    padding: 8px;
    scrollbar-gutter: stable;
  }

  .testcase-card {
    display: flex;
    min-width: 0;
    flex: 0 0 auto;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: color-mix(in srgb, var(--surface-sunken) 88%, transparent);
    transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
  }

  .testcase-card:hover {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  }

  .testcase-card.expanded {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: var(--background-elevated);
    box-shadow: none;
  }

  .testcase-card-row {
    position: relative;
    display: grid;
    min-height: 43px;
    grid-template-columns: 14px 16px minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px;
    padding: 3px 5px 3px 4px;
    background: transparent;
  }

  .testcase-card-row:hover {
    background: transparent;
  }

  .testcase-card-row.disabled .case-index,
  .testcase-card-row.disabled .testcase-main,
  .testcase-card-row.disabled .case-drag-handle {
    opacity: 0.45;
  }

  .case-drag-handle {
    display: grid;
    height: 28px;
    place-items: center;
    color: var(--text-muted);
    cursor: grab;
    opacity: 0.58;
  }

  .testcase-card-row:active .case-drag-handle {
    cursor: grabbing;
  }

  .case-index {
    display: none;
    color: var(--text-muted);
    font: 600 var(--ui-font-small)/1 var(--utility-font);
    text-align: center;
  }

  .case-checkbox {
    width: 13px;
    height: 13px;
    margin: 0;
    accent-color: var(--accent);
  }

  .testcase-main {
    display: flex;
    min-width: 0;
    min-height: 35px;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 3px 5px;
    border-radius: 2px;
    color: var(--text-secondary);
    background: transparent;
    text-align: left;
  }

  .testcase-main:hover,
  .testcase-main.active {
    color: var(--text-primary);
    background: transparent;
  }

  .testcase-main.active {
    padding-left: 5px;
  }

  .testcase-card.expanded > .testcase-card-row::before {
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: -1px;
    width: 4px;
    border-radius: 0 5px 5px 0;
    background: var(--accent);
    content: "";
    pointer-events: none;
  }

  .case-name {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 7px;
  }

  .case-name strong {
    overflow: hidden;
    font-size: var(--ui-font-small);
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .case-name small {
    flex: 0 0 auto;
    padding: 1px 4px;
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--surface) 75%, transparent);
    font-size: var(--ui-font-caption);
    line-height: 1.35;
  }

  .testcase-main em {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    font: 700 var(--ui-font-small)/1 var(--utility-font);
    font-style: normal;
  }

  .testcase-main em i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .result-ac { color: var(--success); }
  .result-wa,
  .result-re,
  .result-ce { color: var(--danger); }
  .result-tle,
  .result-stopped { color: var(--warning); }
  .result-running { color: var(--accent-strong); }

  .case-row-actions {
    gap: 1px;
  }

  .case-action,
  .icon-button {
    display: inline-grid;
    width: 27px;
    height: 27px;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--text-muted);
    background: transparent;
  }

  .case-action:hover:not(:disabled),
  .icon-button:hover:not(:disabled) {
    border-color: var(--border);
    color: var(--text-primary);
    background: var(--surface-raised);
  }

  .case-action.run:hover:not(:disabled) {
    color: var(--success);
  }

  .case-action.delete:hover:not(:disabled) {
    color: var(--danger);
  }

  .case-action:disabled {
    opacity: 0.3;
  }

  .case-editor {
    display: flex;
    min-width: 0;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 11px;
    padding: 12px;
    border-left: 2px solid var(--accent);
    background: color-mix(in srgb, var(--background-elevated) 96%, transparent);
  }

  .fixed-testcase-list > .case-editor {
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    border-left: 2px solid var(--accent);
    border-radius: var(--radius-small);
    box-shadow: none;
  }

  .testcase-card .case-editor {
    border-top: 1px solid var(--border);
  }

  .case-editor-header,
  .case-editor-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .case-editor-header > div {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 8px;
  }

  .case-editor-header strong {
    color: var(--text-primary);
    font-size: var(--ui-font-small);
    font-weight: 680;
  }

  .case-meta-grid,
  .case-io-grid {
    display: grid;
    min-width: 0;
    gap: 8px;
  }

  .case-meta-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .case-io-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .case-meta-grid label,
  .case-io-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 5px;
    color: var(--text-muted);
    font-size: var(--ui-font-caption);
  }

  .case-meta-grid input {
    width: 100%;
    min-height: 31px;
    padding-inline: 8px;
    border-color: var(--border-strong);
    border-radius: 3px;
    background: var(--input-background);
    font-size: var(--ui-font-small);
  }

  .case-io-field {
    gap: 0;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    background: var(--input-background);
  }

  .case-io-heading {
    display: flex;
    height: 28px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 72%, transparent);
  }

  .case-io-heading strong {
    color: var(--text-secondary);
    font-size: var(--ui-font-caption);
    font-weight: 650;
  }

  .case-io-heading small {
    color: var(--text-muted);
    font: var(--ui-font-small)/1 var(--utility-font);
  }

  .case-code-field {
    display: block;
    min-width: 0;
  }

  .case-code-field textarea {
    width: 100%;
    min-height: 116px;
    resize: vertical;
    padding: 8px 9px;
    border: 0;
    border-radius: 0;
    outline: 0;
    color: var(--text-primary);
    background: transparent;
    font: var(--ui-font-small)/1.55 var(--utility-font);
    tab-size: 2;
  }

  .case-io-field:focus-within {
    border-color: var(--accent);
  }

  .case-code-field textarea::placeholder {
    color: color-mix(in srgb, var(--text-muted) 68%, transparent);
  }

  .case-editor-footer {
    padding-top: 1px;
  }

  .case-enabled {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .case-enabled input {
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--accent);
  }

  .case-enabled > span {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }

  .case-enabled strong {
    font-size: var(--ui-font-caption);
    font-weight: 620;
  }

  .case-enabled small {
    color: var(--text-muted);
    font-size: var(--ui-font-caption);
  }

  .case-editor-footer button {
    min-height: 29px;
  }

  .case-empty {
    display: flex;
    min-height: 170px;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 24px 18px;
    color: var(--text-muted);
    text-align: center;
  }

  .case-empty-icon {
    display: grid;
    width: 42px;
    height: 42px;
    margin-bottom: 3px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  .case-empty strong {
    color: var(--text-secondary);
    font-size: var(--ui-font-small);
  }

  .case-empty > span:not(.case-empty-icon) {
    max-width: 210px;
    font-size: var(--ui-font-caption);
    line-height: 1.5;
  }

  .case-empty button {
    margin-top: 5px;
  }

  .case-loading {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .case-loading span {
    height: 43px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-small);
    background: linear-gradient(100deg, var(--surface-sunken) 25%, var(--surface) 48%, var(--surface-sunken) 72%);
    background-size: 240% 100%;
    animation: case-loading 1.4s ease-in-out infinite;
  }

  .case-error {
    display: flex;
    flex: 0 0 auto;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    padding: 8px 10px;
    border-top: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 7%, transparent);
    font-size: var(--ui-font-caption);
    line-height: 1.4;
  }

  :is(button, input, textarea, [tabindex]):focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  @keyframes case-loading {
    to { background-position: -240% 0; }
  }

  @container (max-width: 330px) {
    .case-toolbar {
      flex-direction: column;
      align-items: stretch;
      gap: 7px;
      padding: 10px;
    }

    .case-toolbar-actions .run-all {
      flex: 1;
    }

    .case-file-context small,
    .case-toolbar-actions kbd {
      display: none;
    }

    .case-toolbar-actions .new-case {
      width: auto;
      padding: 0 8px;
    }

    .testcase-card-row {
      grid-template-columns: 12px 14px minmax(0, 1fr) auto;
      gap: 2px;
    }

    .case-name small {
      display: none;
    }

    .case-action {
      width: 25px;
    }

    .case-meta-grid,
    .case-io-grid {
      grid-template-columns: 1fr;
    }

    .case-code-field textarea {
      min-height: 96px;
    }

    .case-enabled small {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .testcase-card {
      transition: none;
    }

    .case-loading span {
      animation: none;
    }
  }
</style>
