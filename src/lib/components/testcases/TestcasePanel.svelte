<script lang="ts">
  import { untrack } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ExecutionStore } from "../../stores/execution.svelte";
  import type { GeneratorStore } from "../../stores/generator.svelte";
  import type { Testcase, TestcaseInput, TestcaseKind } from "../../types/execution";
  import Icon from "../shell/Icon.svelte";
  import RandomGenerator from "./random/RandomGenerator.svelte";

  interface Props {
    workspace: EditorWorkspace;
    execution: ExecutionStore;
    generator: GeneratorStore;
  }

  let { workspace, execution, generator }: Props = $props();
  let activeTab = $state<"fixed" | "random">("fixed");
  let editingId = $state<number>();
  let formOpen = $state(false);
  let saving = $state(false);
  let draft = $state<TestcaseInput>(emptyDraft(""));
  let observedSource = "";

  $effect(() => {
    if (!generator.editorRequested) return;
    untrack(() => {
      generator.consumeEditorRequest();
      activeTab = "random";
    });
  });

  $effect(() => {
    const sourcePath = workspace.activeTab?.path;
    if ((sourcePath ?? "") === observedSource) return;
    observedSource = sourcePath ?? "";
    untrack(() => {
      formOpen = false;
      editingId = undefined;
      draft = emptyDraft(sourcePath ?? "");
      void execution.syncActiveSource(sourcePath, true);
      void generator.syncSource(sourcePath);
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

  function beginDrag(event: DragEvent, testcase: Testcase): void {
    event.dataTransfer?.setData("application/x-lightcp-testcase", String(testcase.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function dropBefore(event: DragEvent, index: number): void {
    event.preventDefault();
    const id = Number(event.dataTransfer?.getData("application/x-lightcp-testcase"));
    if (id) void execution.move(id, index);
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
  <form class="testcase-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <header><strong>{editingId ? "编辑测试点" : "新建测试点"}</strong><button type="button" aria-label="关闭编辑器" onclick={() => (formOpen = false)}>×</button></header>
    <div class="testcase-form-grid">
      <label><span>名称</span><input required bind:value={draft.name} /></label>
      <label><span>类型</span><select bind:value={draft.kind}><option value="sample">样例</option><option value="custom">自定义</option><option value="hack">Hack 数据</option></select></label>
    </div>
    <label><span>输入</span><textarea spellcheck="false" bind:value={draft.input}></textarea></label>
    <label><span>预期输出</span><textarea spellcheck="false" bind:value={draft.expectedOutput}></textarea></label>
    <footer><label class="testcase-enabled"><input type="checkbox" bind:checked={draft.enabled} /> 启用</label><button class="primary-button" disabled={saving}>{saving ? "正在保存…" : "保存"}</button></footer>
  </form>
{/snippet}

<div class="testcase-panel">
  <div class="sidebar-tabs">
    <button class:active={activeTab === "fixed"} onclick={() => (activeTab = "fixed")}>固定测试点</button>
    <button class:active={activeTab === "random"} onclick={() => (activeTab = "random")}>随机生成</button>
    <button disabled title="将在第 7 批次中提供">对拍</button>
  </div>

  {#if activeTab === "random"}
    <RandomGenerator {workspace} {execution} {generator} />
  {:else if !workspace.activeTab?.path}
    <div class="empty-state compact">
      <Icon name="testcases" size={28} />
      <p>当前不是工作区文件</p>
      <span>请从当前工作区打开一个 .cpp 文件。</span>
    </div>
  {:else}
    <div class="testcase-actions">
      <button class="primary-button" onclick={() => void execution.runAll()} disabled={execution.running || execution.compiling}>全部运行 <kbd>F6</kbd></button>
      {#if execution.running}
        <button class="danger-button" onclick={() => void execution.stop()} disabled={execution.stopping}>{execution.stopping ? "正在停止…" : "停止"}</button>
      {:else}
        <button class="secondary-button" onclick={() => beginCreate()}><Icon name="plus" size={13} /> 新建</button>
      {/if}
    </div>

    <div class="testcase-list" role="list" aria-label="固定测试点">
      {#if formOpen && editingId === undefined}
        {@render testcaseEditor()}
      {/if}
      {#each execution.testcases as testcase, index (testcase.id)}
        <div class="testcase-item" role="listitem">
          <div
            class="testcase-row"
            role="group"
            class:disabled={!testcase.enabled}
            draggable="true"
            ondragstart={(event) => beginDrag(event, testcase)}
            ondragover={(event) => event.preventDefault()}
            ondrop={(event) => dropBefore(event, index)}
          >
            <input
              type="checkbox"
              aria-label={`启用 ${testcase.name}`}
              checked={testcase.enabled}
              onchange={(event) => void toggleEnabled(testcase, event.currentTarget.checked)}
            />
            <button class="testcase-main" onclick={() => beginEdit(testcase)}>
              <span><strong>{testcase.name}</strong><small>{kindLabel(testcase.kind)}</small></span>
              {#if resultStatus(testcase.id)}<em class={`result-${resultStatus(testcase.id)?.toLowerCase()}`}>{statusLabel(resultStatus(testcase.id))}</em>{/if}
            </button>
            <button title="运行测试点" aria-label={`运行 ${testcase.name}`} disabled={execution.running || execution.compiling} onclick={() => void execution.runOne(testcase)}>▶</button>
            <button title="复制" aria-label={`复制 ${testcase.name}`} onclick={() => void execution.duplicate(testcase.id)}>⧉</button>
            <button title="删除" aria-label={`删除 ${testcase.name}`} onclick={() => { if (window.confirm(`确定删除“${testcase.name}”吗？`)) void execution.remove(testcase.id); }}>×</button>
          </div>
          {#if formOpen && editingId === testcase.id}
            {@render testcaseEditor()}
          {/if}
        </div>
      {/each}
      {#if !execution.loadingTestcases && execution.testcases.length === 0}
        <div class="testcase-empty"><span>当前文件还没有固定测试点。</span><button onclick={() => beginCreate("sample")}>添加样例</button></div>
      {/if}
    </div>

    {#if execution.error}<p class="testcase-error" role="alert">{execution.error}</p>{/if}
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
