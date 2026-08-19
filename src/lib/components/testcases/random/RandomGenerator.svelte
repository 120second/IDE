<script lang="ts">
  import type { EditorWorkspace } from "../../../editor/workspace.svelte";
  import { containsTree, STRATEGIES, TREE_SHAPES } from "../../../generator/visualRules";
  import type { ExecutionStore } from "../../../stores/execution.svelte";
  import type { GeneratorStore } from "../../../stores/generator.svelte";
  import type { GeneratorStrategy, TreeShape } from "../../../types/generator";
  import PreviewPanel from "./PreviewPanel.svelte";
  import RuleBuilder from "./RuleBuilder.svelte";

  interface Props {
    workspace: EditorWorkspace;
    execution: ExecutionStore;
    generator: GeneratorStore;
  }

  let { workspace, execution, generator }: Props = $props();
  let notice = $state("");
  let canUseSource = $derived(Boolean(workspace.activeTab?.path?.toLowerCase().endsWith(".cpp")));
  let hasTree = $derived(containsTree(generator.nodes));

  async function generateOne(): Promise<void> {
    notice = "";
    await generator.generate(1);
  }

  async function generateMany(): Promise<void> {
    notice = "";
    const amount = Math.max(1, Math.min(100, Math.trunc(generator.count || 1)));
    generator.count = amount;
    await generator.generate(amount);
  }

  async function generateAndRun(): Promise<void> {
    notice = "";
    const generated = await generator.generate(1);
    if (generated) await execution.runInput(generated.input, `随机数据 · 种子 ${generated.seed}`);
  }

  async function saveAsTestcase(): Promise<void> {
    const sourcePath = workspace.activeTab?.path;
    const selected = generator.selectedCase;
    if (!sourcePath || !selected) return;
    const saved = await execution.saveTestcase({
      sourcePath,
      kind: "custom",
      name: `随机数据 · 种子 ${selected.seed}`,
      input: selected.input,
      expectedOutput: "",
      enabled: true,
    });
    notice = saved ? "已保存到固定测试点。" : "";
  }

  async function copyPreview(): Promise<void> {
    const selected = generator.selectedCase;
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.input);
      notice = "已复制生成结果。";
    } catch {
      notice = "复制失败，请在预览框中手动复制。";
    }
  }
</script>

<div class="visual-generator">
  {#if generator.loading}<div class="generator-loading">正在加载已保存的生成规则…</div>{/if}

  <RuleBuilder nodes={generator.nodes} diagnostics={generator.diagnostics} change={(nodes) => generator.setNodes(nodes)} />

  <section class="visual-generator-settings">
    <label><span>数据策略</span><select value={generator.strategy} onchange={(event) => generator.setStrategy(event.currentTarget.value as GeneratorStrategy)}>{#each STRATEGIES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
    {#if hasTree}<label><span>树形默认值</span><select value={generator.treeShape} onchange={(event) => generator.setTreeShape(event.currentTarget.value as TreeShape)}>{#each TREE_SHAPES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>{/if}
    <label class="visual-seed"><span>uint64 种子</span><div><input inputmode="numeric" value={generator.seed} oninput={(event) => generator.setSeed(event.currentTarget.value)} /><button class="secondary-button seed-refresh" title="随机种子" aria-label="随机种子" onclick={() => generator.randomizeSeed()}>↻</button></div></label>
    <div class="visual-generator-actions">
      <button class="primary-button" onclick={() => void generateOne()} disabled={!generator.valid || generator.generating}>{generator.generating ? "正在生成…" : "生成"}</button>
      <button class="secondary-button" onclick={() => void generateAndRun()} disabled={!generator.valid || generator.generating || execution.running || execution.compiling || !canUseSource}>生成并运行</button>
    </div>
    <details class="batch-options"><summary>批量生成</summary><div><input aria-label="批量生成数量" type="number" min="1" max="100" bind:value={generator.count} /><button class="secondary-button" onclick={() => void generateMany()} disabled={!generator.valid || generator.generating}>生成多组</button></div></details>
    {#if generator.diagnostics.length}<p class="visual-validation-summary" role="alert">当前有 {generator.diagnostics.length} 处配置问题，请修复标红规则后再生成。</p>{/if}
    {#if !canUseSource}<p class="generator-hint">打开工作区中的 .cpp 文件后，可以运行或保存生成结果。</p>{/if}
    <small class="profile-status">{generator.saving ? "正在保存规则…" : generator.sourcePath ? "规则会自动保存" : "未关联源文件"}</small>
  </section>

  <PreviewPanel
    cases={generator.cases}
    selectedIndex={generator.selectedIndex}
    select={(index) => (generator.selectedIndex = index)}
    copy={() => void copyPreview()}
    save={() => void saveAsTestcase()}
    canSave={canUseSource}
  />

  {#if generator.error}<p class="testcase-error" role="alert">{generator.error}</p>{/if}
  {#if notice}<p class="generator-notice" aria-live="polite">{notice}</p>{/if}
</div>
