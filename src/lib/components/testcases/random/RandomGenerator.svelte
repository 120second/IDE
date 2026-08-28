<script lang="ts">
  import type { EditorWorkspace } from "../../../editor/workspace.svelte";
  import { containsTree, STRATEGIES, TREE_SHAPES } from "../../../generator/visualRules";
  import type { ExecutionStore } from "../../../stores/execution.svelte";
  import type { GeneratorStore } from "../../../stores/generator.svelte";
  import type { GeneratorStrategy, TreeShape } from "../../../types/generator";
  import Icon from "../../shell/Icon.svelte";
  import PreviewPanel from "./PreviewPanel.svelte";
  import RuleBuilder from "./RuleBuilder.svelte";
  import type { UxStore } from "../../../stores/ux.svelte";

  interface Props {
    workspace: EditorWorkspace;
    execution: ExecutionStore;
    generator: GeneratorStore;
    ux: UxStore;
  }

  let { workspace, execution, generator, ux }: Props = $props();
  let notice = $state("");
  let settingsOpen = $state(false);
  let previewAnchor = $state<HTMLDivElement>();
  let canUseSource = $derived(Boolean(workspace.activeTab?.path?.toLowerCase().endsWith(".cpp")));
  let hasTree = $derived(containsTree(generator.nodes));
  let strategyLabel = $derived(STRATEGIES.find((option) => option.value === generator.strategy)?.label ?? "混合");
  let seedSummary = $derived(generator.seed.length > 13 ? `${generator.seed.slice(0, 7)}…${generator.seed.slice(-5)}` : generator.seed);

  function revealPreview(): void {
    requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      previewAnchor?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    });
  }

  async function generateOne(): Promise<void> {
    notice = "";
    const generated = await generator.generate(1);
    if (generated) revealPreview();
  }

  async function generateMany(): Promise<void> {
    notice = "";
    const amount = Math.max(1, Math.min(100, Math.trunc(generator.count || 1)));
    generator.count = amount;
    const generated = await generator.generate(amount);
    if (generated) revealPreview();
  }

  async function generateAndRun(): Promise<void> {
    notice = "";
    const generated = await generator.generate(1);
    if (generated) {
      revealPreview();
      await execution.runInput(generated.input, `随机数据 · 种子 ${generated.seed}`);
    }
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

  <RuleBuilder nodes={generator.nodes} diagnostics={generator.diagnostics} change={(nodes) => generator.setNodes(nodes)} {ux} />

  <section class="visual-generator-settings generator-step">
    <header class="generator-step-header">
      <span class="generator-step-index" aria-hidden="true">2</span>
      <div class="generator-step-copy"><strong>生成数据</strong><span>使用当前输入格式生成一组数据，或直接运行程序。</span></div>
      <button type="button" class="settings-toggle" aria-expanded={settingsOpen} onclick={() => (settingsOpen = !settingsOpen)}>{settingsOpen ? "收起设置" : "调整设置"}</button>
    </header>

    <div class="settings-glance" aria-label="当前生成设置">
      <span><small>数值分布</small><strong>{strategyLabel}</strong></span>
      <span><small>随机种子</small><code title={generator.seed}>{seedSummary}</code></span>
    </div>

    {#if settingsOpen}
      <div class="generator-settings-fields">
        <label><span>数值分布</span><select value={generator.strategy} onchange={(event) => generator.setStrategy(event.currentTarget.value as GeneratorStrategy)}>{#each STRATEGIES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
        {#if hasTree}<label><span>默认树形</span><select value={generator.treeShape} onchange={(event) => generator.setTreeShape(event.currentTarget.value as TreeShape)}>{#each TREE_SHAPES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>{/if}
        <label class="visual-seed"><span>随机种子</span><div><input name="generator-seed" autocomplete="off" aria-describedby="generator-seed-hint" inputmode="numeric" value={generator.seed} oninput={(event) => generator.setSeed(event.currentTarget.value)} /><button type="button" class="secondary-button seed-refresh" title="换一个随机种子" aria-label="换一个随机种子" onclick={() => generator.randomizeSeed()}><Icon name="refresh" size={14} /></button></div></label>
        <p id="generator-seed-hint" class="generator-hint">使用相同的种子可以再次生成完全相同的数据。</p>
        <details class="batch-options"><summary>批量生成</summary><div><input name="generator-count" autocomplete="off" aria-label="批量生成数量" type="number" min="1" max="100" bind:value={generator.count} /><button type="button" class="secondary-button" onclick={() => void generateMany()} disabled={!generator.valid || generator.generating}>生成多组</button></div></details>
      </div>
    {/if}

    {#if generator.diagnostics.length}<p class="visual-validation-summary" role="alert">当前有 {generator.diagnostics.length} 处配置问题，请修复标红内容后再生成。</p>{/if}
    <div class="visual-generator-actions">
      <button type="button" class="primary-button" onclick={() => void generateOne()} disabled={!generator.valid || generator.generating}>{generator.generating ? "正在生成…" : "生成预览"}</button>
      <button type="button" class="secondary-button" onclick={() => void generateAndRun()} disabled={!generator.valid || generator.generating || execution.running || execution.compiling || !canUseSource}>生成并运行</button>
    </div>
    {#if !canUseSource}<p class="generator-hint">打开工作区中的 .cpp 文件后，可以运行或保存生成结果。</p>{/if}
    <small class="profile-status" aria-live="polite">{generator.saving ? "正在保存输入格式…" : generator.sourcePath ? "输入格式已自动保存" : "当前未关联源文件"}</small>
  </section>

  <div class="preview-anchor" bind:this={previewAnchor}>
    <PreviewPanel
      cases={generator.cases}
      selectedIndex={generator.selectedIndex}
      select={(index) => (generator.selectedIndex = index)}
      copy={() => void copyPreview()}
      save={() => void saveAsTestcase()}
      canSave={canUseSource}
    />
  </div>

  {#if generator.error}<p class="testcase-error" role="alert">{generator.error}</p>{/if}
  {#if notice}<p class="generator-notice" aria-live="polite">{notice}</p>{/if}
</div>
