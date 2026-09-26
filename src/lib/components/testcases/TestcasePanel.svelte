<script lang="ts">
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { onDestroy, untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { Testcase, TestcaseInput, TestcaseKind } from "../../types/execution";
  import type { TestcaseResult } from "../../types/execution";
  import type { SettingsStore } from "../../stores/settings.svelte";
  import Icon from "../shell/Icon.svelte";
  import type { KeybindingMap } from "../../keybindings";
  import { shouldShowTestcaseEmptyState, testcaseEditorToggle } from "./testcaseEditorState";
  import type { UxStore } from "../../stores/ux.svelte";

  interface Props {
    workspace: EditorWorkspace;
    execution: ExecutionStore;
    shell: ShellStore;
    settings: SettingsStore;
    keybindings: KeybindingMap;
    ux: UxStore;
  }

  let { workspace, execution, shell, settings, keybindings, ux }: Props = $props();
  let editingId = $state<number>();
  let formOpen = $state(false);
  let saving = $state(false);
  let draft = $state<TestcaseInput>(emptyDraft(""));
  let observedSource = "";
  let sourceTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    if (sourceTimer) clearTimeout(sourceTimer);
  });

  $effect(() => execution.setBeforeTestRun(prepareTestcaseForRun));

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

  async function persistDraft(closeAfterSave: boolean): Promise<Testcase | undefined> {
    if (!draft.name.trim() || saving) return;
    saving = true;
    const saved = await execution.saveTestcase(draft, editingId);
    saving = false;
    if (saved) {
      editingId = saved.id;
      draft = inputFromTestcase(saved);
      if (closeAfterSave) formOpen = false;
    }
    return saved;
  }

  async function save(): Promise<void> {
    await persistDraft(true);
  }

  async function prepareTestcaseForRun(testcaseId?: number): Promise<Testcase | false | undefined> {
    if (saving) return false;
    if (editingId === undefined || (testcaseId !== undefined && testcaseId !== editingId)) return;
    return await persistDraft(false) ?? false;
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

  function resultFor(id: number): TestcaseResult | undefined {
    return execution.results.find((result) => result.testcaseId === id);
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

  async function readFromFile(field: "input" | "expectedOutput"): Promise<void> {
    try {
      const content = isTauri()
        ? await readNativeTextFile()
        : await readBrowserTextFile();
      if (content === undefined) return;
      draft[field] = content;
    } catch (error) {
      execution.error = errorMessage(error);
    }
  }

  async function exportOutput(testcase: Testcase, result?: TestcaseResult): Promise<void> {
    const content = result
      ? `${result.actualOutput}${result.stderr ? `\n${result.stderr}` : ""}`
      : "";
    try {
      const fileName = `${safeFileName(testcase.name)}-output.txt`;
      if (isTauri()) {
        const selected = await saveDialog({
          title: "导出程序输出",
          defaultPath: fileName,
          filters: [{ name: "文本文件", extensions: ["txt", "out", "log"] }],
        });
        if (!selected) return;
        await invoke("write_testcase_output_file", { path: selected, content });
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      ux.success("程序输出已导出。");
    } catch (error) {
      execution.error = errorMessage(error);
    }
  }

  function nextName(kind: TestcaseKind): string {
    const count = execution.testcases.filter((testcase) => testcase.kind === kind).length + 1;
    return `${kindLabel(kind)} ${count}`;
  }

  async function readNativeTextFile(): Promise<string | undefined> {
    const selected = await open({
      title: "读取测试数据",
      directory: false,
      multiple: false,
      filters: [{ name: "测试数据", extensions: ["txt", "in", "out", "dat"] }],
    });
    return typeof selected === "string"
      ? invoke<string>("read_testcase_data_file", { path: selected })
      : undefined;
  }

  function readBrowserTextFile(): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".txt,.in,.out,.dat,text/plain";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) resolve(undefined);
        else file.text().then(resolve, reject);
      };
      input.click();
    });
  }

  function safeFileName(value: string): string {
    return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/[. ]+$/g, "").slice(0, 64)
      || "testcase";
  }

  function errorMessage(error: unknown): string {
    if (typeof error === "object" && error) {
      const commandError = error as { userMessage?: unknown; technicalMessage?: unknown };
      if (typeof commandError.userMessage === "string") return commandError.userMessage;
      if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
    }
    return error instanceof Error ? error.message : String(error);
  }

  function autoSizeTextarea(node: HTMLTextAreaElement, value: string) {
    let frame = 0;
    let lastWidth = node.clientWidth;

    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.style.height = "auto";
        const minHeight = 64;
        const maxHeight = 220;
        const contentHeight = node.scrollHeight;
        node.style.height = `${Math.min(maxHeight, Math.max(minHeight, contentHeight))}px`;
        node.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
      });
    };

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (Math.abs(width - lastWidth) < 0.5) return;
      lastWidth = width;
      resize();
    });

    node.addEventListener("input", resize);
    observer.observe(node);
    resize();

    return {
      update(nextValue: string) {
        value = nextValue;
        void value;
        resize();
      },
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
        node.removeEventListener("input", resize);
      },
    };
  }
</script>

{#snippet testcaseEditor()}
  <form class="case-editor" aria-label={editingId ? "编辑测试点" : "新建测试点"} onsubmit={(event) => { event.preventDefault(); void save(); }}>
    {#if editingId === undefined}
      <header class="case-editor-header">
        <strong>新建测试点</strong>
        <button class="icon-button" type="button" aria-label="关闭编辑器" title="关闭" onclick={() => (formOpen = false)}><Icon name="close" size={15} /></button>
      </header>

      <label class="case-name-field"><span>名称</span><input required autocomplete="off" placeholder="例如：样例 1" bind:value={draft.name} /></label>
    {/if}

    <div class="case-io-grid">
      <label class="case-io-field">
        <span class="case-io-heading">
          <strong>输入</strong>
          <button type="button" onclick={() => void readFromFile("input")}><Icon name="file" size={13} />从文件读取</button>
        </span>
        <span class="case-code-field"><textarea use:autoSizeTextarea={draft.input} spellcheck="false" aria-label="测试点输入" placeholder="在这里输入测试数据…" bind:value={draft.input}></textarea></span>
      </label>
      <label class="case-io-field">
        <span class="case-io-heading">
          <strong>期望输出</strong>
          <button type="button" onclick={() => void readFromFile("expectedOutput")}><Icon name="file" size={13} />从文件读取</button>
        </span>
        <span class="case-code-field"><textarea use:autoSizeTextarea={draft.expectedOutput} spellcheck="false" aria-label="测试点期望输出" placeholder="在这里输入正确答案…" bind:value={draft.expectedOutput}></textarea></span>
      </label>
    </div>

    {#if editingId !== undefined}
      {@const testcase = execution.testcases.find((candidate) => candidate.id === editingId)}
      {@const result = resultFor(editingId)}
      {#if testcase}
        <section class="case-output-section" aria-label="程序输出">
          <header>
            <strong>程序输出</strong>
            <button class="case-export-button" type="button" onclick={() => void exportOutput(testcase, result)} disabled={!result} title={result ? "导出程序输出" : "运行后可导出输出"}>
              <Icon name="download" size={15} />导出
            </button>
          </header>
          <pre class:empty={!result}>{result ? `${result.actualOutput}${result.stderr ? `\n${result.stderr}` : ""}` : "运行此测试点后显示输出"}</pre>
        </section>

        <div class="case-limit-row">
          <span>时限:</span>
          <strong>{settings.value.runTimeoutMs}</strong>
          <em>ms</em>
        </div>
      {/if}
    {/if}

    <footer class="case-editor-footer">
      <label class="case-enabled"><input type="checkbox" bind:checked={draft.enabled} /><span><strong>启用此测试点</strong><small>运行全部时包含该用例</small></span></label>
      <div>
        {#if editingId !== undefined}
          <button class="secondary-button" type="button" onclick={() => editingId && void execution.duplicate(editingId)}><Icon name="copy" size={13} />复制</button>
        {/if}
        <button class="secondary-button" type="button" onclick={() => (formOpen = false)}>取消</button>
        <button class="primary-button" disabled={saving || !draft.name.trim()}>{saving ? "保存中…" : editingId ? "保存" : "创建"}</button>
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
          <button class="primary-button run-all" title={`运行全部 · ${keybindings.runAll}`} onclick={() => { shell.generatorOpen = false; void execution.runAll(); }} disabled={saving || execution.compiling || execution.testcases.every((testcase) => !testcase.enabled)}><Icon name="play" size={13} /><span>运行全部</span><kbd>{keybindings.runAll}</kbd></button>
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
        {@const result = resultFor(testcase.id)}
        <article class="testcase-card" class:expanded={formOpen && editingId === testcase.id} role="listitem">
          <div
            class="testcase-card-row"
            role="group"
            class:disabled={!testcase.enabled}
            draggable="true"
            ondragstart={(event) => beginDrag(event, testcase)}
            ondragover={(event) => event.preventDefault()}
            ondrop={(event) => dropBefore(event, index)}
          >
            <button
              class="testcase-main"
              class:active={formOpen && editingId === testcase.id}
              aria-expanded={formOpen && editingId === testcase.id}
              title="展开测试点 · 拖动排序 · Alt+↑/↓ 排序"
              onclick={() => beginEdit(testcase)}
              onkeydown={(event) => moveWithKeyboard(event, testcase, index)}
            >
              <strong>{testcase.name}</strong>
            </button>
            {#if result}
              <span class={`case-status result-${result.status.toLowerCase()}`}>{statusLabel(result.status)}</span>
              {#if result.status !== "Running"}<span class="case-duration">{result.durationMs}ms</span>{/if}
            {:else}
              <span class="case-status pending">待运行</span>
            {/if}
            <button class="case-run-button" title={`运行 ${testcase.name}`} disabled={saving || execution.running || execution.compiling || !testcase.enabled} onclick={() => { shell.generatorOpen = false; void execution.runOne(testcase); }}><Icon name="play" size={13} /><span>{result?.status === "Running" ? "运行中" : "运行"}</span></button>
            <button class="case-delete-button" title="删除测试点" aria-label={`删除 ${testcase.name}`} onclick={() => void removeTestcase(testcase)}><Icon name="close" size={17} /></button>
            <button class="case-expand-button" title={formOpen && editingId === testcase.id ? "收起" : "展开"} aria-label={`${formOpen && editingId === testcase.id ? "收起" : "展开"} ${testcase.name}`} aria-expanded={formOpen && editingId === testcase.id} onclick={() => beginEdit(testcase)}><Icon name="chevron-right" size={16} /></button>
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

  .case-editor-header strong {
    color: var(--text-primary);
    font-size: var(--ui-font-small);
    font-weight: 680;
  }

  .case-io-grid {
    display: grid;
    min-width: 0;
    gap: 8px;
  }

  .case-io-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .case-io-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 5px;
    color: var(--text-muted);
    font-size: var(--ui-font-caption);
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

  .case-code-field {
    display: block;
    min-width: 0;
  }

  .case-code-field textarea {
    width: 100%;
    min-height: 64px;
    max-height: 220px;
    resize: none;
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

  :is(button, input, textarea):focus-visible {
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

    .case-action {
      width: 25px;
    }

    .case-io-grid {
      grid-template-columns: 1fr;
    }

    .case-code-field textarea {
      min-height: 64px;
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

  /* Reference-style testcase cards */
  .fixed-testcase-list {
    gap: 9px;
    padding: 10px;
  }

  .testcase-card {
    border-color: color-mix(in srgb, var(--border-strong) 84%, transparent);
    border-radius: 9px;
    background: color-mix(in srgb, var(--background-elevated) 94%, transparent);
  }

  .testcase-card:hover {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
  }

  .testcase-card.expanded {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--background-elevated) 98%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 7%, transparent);
  }

  .testcase-card-row {
    display: flex;
    min-height: 54px;
    align-items: center;
    gap: 6px;
    padding: 7px 8px 7px 14px;
    border-bottom: 0;
    background: color-mix(in srgb, var(--surface) 64%, transparent);
    cursor: grab;
  }

  .testcase-card-row:active {
    cursor: grabbing;
  }

  .testcase-card.expanded > .testcase-card-row {
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface-raised) 78%, transparent);
  }

  .testcase-card.expanded > .testcase-card-row::before {
    display: none;
  }

  .testcase-card-row.disabled .testcase-main {
    opacity: 0.5;
  }

  .testcase-main {
    min-width: 54px;
    min-height: 36px;
    flex: 1 1 auto;
    justify-content: flex-start;
    overflow: hidden;
    padding: 0;
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
  }

  .testcase-main:hover,
  .testcase-main.active,
  .testcase-main.active {
    padding-left: 0;
    color: var(--text-primary);
    background: transparent;
  }

  .testcase-main strong {
    overflow: hidden;
    font-size: 15px;
    font-weight: 690;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .case-status {
    display: inline-flex;
    height: 29px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    border: 1px solid currentColor;
    border-radius: 5px;
    font: 700 14px/1 var(--utility-font);
  }

  .case-status.pending {
    border-color: var(--border-strong);
    color: var(--text-muted);
    background: color-mix(in srgb, var(--surface-sunken) 72%, transparent);
    font-family: inherit;
    font-size: var(--ui-font-caption);
    font-weight: 620;
  }

  .case-status.result-ac {
    color: color-mix(in srgb, var(--success) 88%, white);
    background: color-mix(in srgb, var(--success) 20%, transparent);
  }

  .case-status.result-wa,
  .case-status.result-re,
  .case-status.result-ce {
    color: color-mix(in srgb, var(--danger) 88%, white);
    background: color-mix(in srgb, var(--danger) 18%, transparent);
  }

  .case-status.result-tle,
  .case-status.result-stopped {
    color: color-mix(in srgb, var(--warning) 90%, white);
    background: color-mix(in srgb, var(--warning) 18%, transparent);
  }

  .case-status.result-running {
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  .case-duration {
    flex: 0 0 auto;
    color: var(--text-muted);
    font: 13px/1 var(--utility-font);
    white-space: nowrap;
  }

  .case-run-button,
  .case-delete-button,
  .case-expand-button,
  .case-io-heading button,
  .case-export-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
  }

  .case-run-button {
    height: 36px;
    gap: 5px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 74%, var(--border));
    border-radius: 5px;
    color: var(--accent-contrast);
    background: var(--accent);
    font-size: var(--ui-font-small);
    font-weight: 680;
  }

  .case-run-button:hover:not(:disabled) {
    border-color: var(--accent-strong);
    background: var(--accent-strong);
  }

  .case-run-button:disabled {
    opacity: 0.45;
  }

  .case-delete-button {
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--danger) 32%, transparent);
    border-radius: 5px;
    color: color-mix(in srgb, var(--danger) 88%, white);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }

  .case-delete-button:hover {
    border-color: color-mix(in srgb, var(--danger) 62%, var(--border));
    background: color-mix(in srgb, var(--danger) 24%, transparent);
  }

  .case-expand-button {
    width: 24px;
    height: 36px;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    transition: color 150ms ease, transform 150ms ease;
  }

  .testcase-card.expanded .case-expand-button {
    color: var(--text-secondary);
    transform: rotate(90deg);
  }

  .case-editor,
  .testcase-card .case-editor {
    gap: 14px;
    padding: 14px 16px 16px;
    border: 0;
    border-top: 0;
    background: transparent;
  }

  .fixed-testcase-list > .case-editor {
    border: 1px solid var(--accent);
    border-radius: 9px;
    background: color-mix(in srgb, var(--background-elevated) 98%, transparent);
  }

  .case-editor-header {
    min-height: 30px;
  }

  .case-editor-header strong {
    font-size: 15px;
  }

  .case-name-field {
    display: grid;
    gap: 6px;
    color: var(--text-secondary);
    font-size: var(--ui-font-small);
    font-weight: 620;
  }

  .case-name-field input {
    width: 100%;
    height: 34px;
    padding: 0 9px;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    background: var(--input-background);
  }

  .case-io-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .case-io-field {
    gap: 7px;
    overflow: visible;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .case-io-heading {
    height: 34px;
    gap: 8px;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .case-io-heading strong,
  .case-output-section > header strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 680;
    white-space: nowrap;
  }

  .case-io-heading button {
    min-width: 0;
    height: 30px;
    gap: 5px;
    padding: 0 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--surface-raised) 86%, transparent);
    font-size: var(--ui-font-caption);
    font-weight: 620;
    white-space: nowrap;
  }

  .case-io-heading button:hover {
    border-color: color-mix(in srgb, var(--accent) 44%, var(--border-strong));
    color: var(--text-primary);
  }

  .case-code-field textarea {
    min-height: 64px;
    max-height: 220px;
    resize: none;
    padding: 12px 13px;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--surface-raised) 86%, transparent);
    font: 13px/1.7 var(--utility-font);
  }

  .case-io-field:focus-within {
    border-color: transparent;
  }

  .case-code-field textarea:focus {
    border-color: var(--accent);
  }

  .case-output-section {
    display: grid;
    gap: 7px;
    min-width: 0;
  }

  .case-output-section > header {
    display: flex;
    height: 34px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .case-export-button {
    height: 31px;
    gap: 5px;
    padding: 0 9px;
    border: 1px solid color-mix(in srgb, var(--accent) 74%, var(--border));
    border-radius: 5px;
    color: var(--accent-contrast);
    background: var(--accent);
    font-size: var(--ui-font-small);
    font-weight: 680;
  }

  .case-export-button:disabled {
    opacity: 0.45;
  }

  .case-output-section pre {
    min-height: 64px;
    max-height: 220px;
    overflow: auto;
    margin: 0;
    padding: 12px 13px;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--surface-raised) 86%, transparent);
    font: 13px/1.7 var(--utility-font);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .case-output-section pre.empty {
    color: var(--text-muted);
  }

  .case-limit-row {
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: var(--ui-font-small);
  }

  .case-limit-row strong {
    min-width: 72px;
    padding: 7px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: color-mix(in srgb, var(--surface-raised) 82%, transparent);
    font: 600 13px/1 var(--utility-font);
    text-align: center;
  }

  .case-limit-row em {
    color: var(--text-muted);
    font: 13px/1 var(--utility-font);
    font-style: normal;
  }

  .case-editor-footer {
    min-height: 42px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .case-editor-footer button {
    gap: 5px;
  }

  @container (max-width: 340px) {
    .fixed-testcase-list {
      padding: 8px;
    }

    .testcase-card-row {
      gap: 4px;
      padding-left: 10px;
    }

    .case-duration {
      display: none;
    }

    .case-run-button {
      padding-inline: 8px;
    }

    .case-delete-button {
      width: 32px;
    }

    .case-editor,
    .testcase-card .case-editor {
      padding: 12px;
    }

    .case-io-grid {
      grid-template-columns: 1fr;
    }

    .case-code-field textarea {
      min-height: 64px;
    }

    .case-editor-footer {
      align-items: flex-end;
      flex-direction: column;
    }
  }

  @container (max-width: 275px) {
    .case-status.pending,
    .case-run-button :global(svg) {
      display: none;
    }

    .case-run-button {
      padding-inline: 7px;
    }

    .case-delete-button {
      width: 30px;
    }
  }
</style>
