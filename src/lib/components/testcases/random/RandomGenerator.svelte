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
    close: () => void;
  }

  let { workspace, execution, generator, ux, close }: Props = $props();
  let notice = $state("");
  let previewAnchor = $state<HTMLDivElement>();
  let canUseSource = $derived(Boolean(workspace.activeTab?.path?.toLowerCase().endsWith(".cpp") && !workspace.activeTab.deleted && !workspace.activeTab.loading));
  let hasTree = $derived(containsTree(generator.nodes));

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
      close();
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

<section class="generator-workspace" aria-label="随机数据生成器">
  <header class="generator-workspace-header">
    <div><h1>随机数据</h1><p>{canUseSource ? `用于 ${workspace.activeTab?.title}` : "先搭建输入格式，再生成数据检查程序。"}</p></div>
    <button type="button" class="secondary-button" onclick={close}>返回代码</button>
  </header>
  <div class="generator-workspace-toolbar">
    <div class="visual-generator-actions">
      <button type="button" class="primary-button" onclick={() => void generateOne()} disabled={generator.loading || !generator.valid || generator.generating}><Icon name="play" size={14} />{generator.generating ? "正在生成…" : "生成预览"}</button>
      <button type="button" class="secondary-button" onclick={() => void generateAndRun()} disabled={generator.loading || !generator.valid || generator.generating || execution.running || execution.compiling || !canUseSource}>生成并运行</button>
    </div>
    <small class="profile-status" aria-live="polite">{generator.loading ? "正在加载输入格式…" : generator.saving ? "正在保存…" : generator.sourcePath ? "输入格式自动保存" : "打开 C++ 文件后可保存格式"}</small>
  </div>
  {#if generator.diagnostics.length}<p class="visual-validation-summary" role="alert">还有 {generator.diagnostics.length} 处配置需要修改，请查看标红的规则。</p>{/if}
  <div class="visual-generator">
    <RuleBuilder nodes={generator.nodes} diagnostics={generator.diagnostics} change={(nodes) => generator.setNodes(nodes)} busy={generator.loading || generator.generating} {ux} />
    <div class="generator-preview-column">
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
      <details class="visual-generator-settings">
        <summary>生成设置<span>种子、数值分布与批量生成</span></summary>
        <div class="generator-settings-fields">
          <label><span>数值分布</span><select value={generator.strategy} onchange={(event) => generator.setStrategy(event.currentTarget.value as GeneratorStrategy)}>{#each STRATEGIES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
          {#if hasTree}<label><span>默认树形</span><select value={generator.treeShape} onchange={(event) => generator.setTreeShape(event.currentTarget.value as TreeShape)}>{#each TREE_SHAPES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>{/if}
          <label class="visual-seed"><span>随机种子</span><div><input name="generator-seed" autocomplete="off" aria-describedby="generator-seed-hint" inputmode="numeric" value={generator.seed} oninput={(event) => generator.setSeed(event.currentTarget.value)} /><button type="button" class="secondary-button seed-refresh" title="换一个随机种子" aria-label="换一个随机种子" onclick={() => generator.randomizeSeed()}><Icon name="refresh" size={14} /></button></div></label>
          <p id="generator-seed-hint" class="generator-hint">相同的格式和种子会生成相同的数据，方便复现问题。</p>
          <div class="batch-options"><label><span>生成组数</span><input name="generator-count" autocomplete="off" type="number" min="1" max="100" bind:value={generator.count} /></label><button type="button" class="secondary-button" onclick={() => void generateMany()} disabled={generator.loading || !generator.valid || generator.generating}>批量生成</button></div>
        </div>
      </details>
    </div>
  </div>
  {#if generator.error}<p class="testcase-error" role="alert">{generator.error}</p>{/if}
  {#if notice}<p class="generator-notice" aria-live="polite">{notice}</p>{/if}
</section>
