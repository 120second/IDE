<script lang="ts">
  import type { EditorWorkspace } from "../../../editor/workspace.svelte";
  import { containsTree, STRATEGIES, TREE_SHAPES } from "../../../generator/visualRules";
  import type { ExecutionStore } from "../../../stores/execution.svelte";
  import type { GeneratorStore } from "../../../stores/generator.svelte";
  import type { GeneratorStrategy, TreeShape } from "../../../types/generator";
  import Icon from "../../shell/Icon.svelte";
  import PreviewPanel from "./PreviewPanel.svelte";
  import RuleBuilder from "./RuleBuilder.svelte";
  import SampleBuilder from "./SampleBuilder.svelte";
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
  let mode = $state<"sample" | "advanced">("sample");
  let samplePending = $state(false);
  let formatReady = $derived(generator.valid && !(mode === "sample" && samplePending));
  let previewAnchor = $state<HTMLDivElement>();
  let canUseSource = $derived(Boolean(workspace.activeTab?.path?.toLowerCase().endsWith(".cpp") && workspace.activeTab.path === generator.sourcePath && !workspace.activeTab.deleted && !workspace.activeTab.loading));
  let hasTree = $derived(containsTree(generator.nodes));

  $effect(() => { void generator.sourcePath; samplePending = false; notice = ""; });

  function selectMode(next: typeof mode): void {
    if (mode === next) return;
    mode = next;
    samplePending = false;
  }

  function revealPreview(): void {
    requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      previewAnchor?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    });
  }

  async function generateMany(): Promise<void> {
    if (!formatReady) return;
    notice = "";
    const amount = Math.max(1, Math.min(100, Math.trunc(generator.count || 1)));
    generator.count = amount;
    const generated = await generator.generate(amount);
    if (generated) revealPreview();
  }

  async function generateAndRun(): Promise<void> {
    if (!formatReady) return;
    notice = "";
    const sourcePath = workspace.activeTab?.path;
    const generated = generator.selectedCase ?? await generator.generate(1);
    if (generated && sourcePath && sourcePath === workspace.activeTab?.path && sourcePath === generator.sourcePath) {
      close();
      await execution.runInput(generated.input, `随机数据 · 种子 ${generated.seed}`);
    }
  }

  async function saveAsTestcase(): Promise<void> {
    const sourcePath = workspace.activeTab?.path;
    const selected = generator.selectedCase;
    if (!sourcePath || sourcePath !== generator.sourcePath || !selected) return;
    const saved = await execution.saveTestcase({
      sourcePath,
      kind: "custom",
      name: `随机数据 · 种子 ${selected.seed}`,
      input: selected.input,
      expectedOutput: "",
      enabled: true,
    });
    notice = saved ? "已保存到固定测试点。" : execution.error || "保存失败，请确认当前 C++ 文件仍然可用。";
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
    <div class="generator-title"><span class="generator-title-icon"><Icon name="database" size={20} /></span><div><h1>随机数据</h1><p>{canUseSource ? workspace.activeTab?.title : "粘贴输入样例，修改范围，生成数据"}</p></div></div>
    <div class="generator-header-actions"><small class="profile-status" aria-live="polite">{generator.loading ? "正在加载…" : generator.saving ? "正在保存…" : generator.sourcePath ? "格式自动保存" : "打开 C++ 文件后可保存格式"}</small><button type="button" class="secondary-button" onclick={close}><Icon name="chevron-left" size={14} />返回代码</button></div>
  </header>
  <div class="generator-workspace-toolbar">
    <div class="visual-generator-actions">
      <button type="button" class="primary-button" onclick={() => void generateMany()} disabled={generator.loading || !formatReady || generator.generating}><Icon name="refresh" size={14} />{generator.generating ? "正在生成…" : generator.count > 1 ? `生成 ${generator.count} 组` : "生成新数据"}</button>
      <button type="button" class="secondary-button" onclick={() => void generateAndRun()} disabled={generator.loading || !formatReady || generator.generating || execution.running || execution.compiling || !canUseSource}><Icon name="play" size={14} />{generator.selectedCase ? "运行这组" : "生成并运行"}</button>
      <label class="generator-toolbar-count"><span>组数</span><input name="generator-count" aria-label="生成组数" type="number" min="1" max="100" bind:value={generator.count} disabled={generator.generating} /></label>
    </div>
    <span class="generator-seed-status"><Icon name={generator.seedLocked ? "pause" : "refresh"} size={12} />{generator.seedLocked ? "种子已固定 · 可复现" : "每次生成新数据"}</span>
  </div>
  <div class="generator-entry-modes" role="group" aria-label="格式编辑方式"><button class:active={mode === "sample"} aria-pressed={mode === "sample"} disabled={generator.loading || generator.generating} onclick={() => selectMode("sample")}>粘贴样例</button><button class:active={mode === "advanced"} aria-pressed={mode === "advanced"} disabled={generator.loading || generator.generating} onclick={() => selectMode("advanced")}>高级编辑</button><span>先用小样例识别，再按题目约束扩大范围</span></div>
  {#if generator.diagnostics.length}<div class="visual-validation-summary" role="alert"><Icon name="warning" size={15} /><div>{#each [...new Set(generator.diagnostics.map((item) => item.message))].slice(0, 8) as message}<p>{message}</p>{/each}</div></div>{/if}
  {#if generator.error}<p class="testcase-error" role="alert">{generator.error}</p>{/if}
  <div class="visual-generator">
    {#key generator.sourcePath}{#if mode === "sample"}<SampleBuilder nodes={generator.nodes} diagnostics={generator.diagnostics} change={(nodes) => generator.setNodes(nodes)} pending={(value) => { samplePending = value; }} busy={generator.loading || generator.generating} />{:else}<RuleBuilder nodes={generator.nodes} diagnostics={generator.diagnostics} change={(nodes) => generator.setNodes(nodes)} busy={generator.loading || generator.generating} {ux} />{/if}{/key}
    <div class="generator-preview-column">
      <div class="preview-anchor" bind:this={previewAnchor}>
        <PreviewPanel
          cases={generator.cases}
          selectedIndex={generator.selectedIndex}
          select={(index) => (generator.selectedIndex = index)}
          copy={() => void copyPreview()}
          save={() => void saveAsTestcase()}
          canSave={canUseSource && !samplePending}
          nodes={generator.nodes}
          busy={generator.loading || generator.generating}
          {notice}
          replay={(seed) => generator.useSeed(seed)}
        />
      </div>
      <details class="visual-generator-settings" aria-label="生成设置">
        <summary>更多设置：边界数据与随机种子</summary>
        <div class="generator-settings-fields">
          <label><span>数据分布</span><select disabled={generator.generating} value={generator.strategy} onchange={(event) => generator.setStrategy(event.currentTarget.value as GeneratorStrategy)}>{#each STRATEGIES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
          {#if hasTree}<label><span>默认树形</span><select value={generator.treeShape} onchange={(event) => generator.setTreeShape(event.currentTarget.value as TreeShape)}>{#each TREE_SHAPES as option}<option value={option.value}>{option.label}</option>{/each}</select></label>{/if}
          <label class="generator-lock-seed"><input type="checkbox" checked={generator.seedLocked} disabled={generator.generating} onchange={(event) => generator.setSeedLocked(event.currentTarget.checked)} />固定种子，复现相同数据</label>
          <label class="visual-seed"><span>{generator.seedLocked ? "固定种子" : "最近使用的种子"}</span><div><input name="generator-seed" disabled={generator.generating} autocomplete="off" inputmode="numeric" value={generator.seed} oninput={(event) => generator.setSeed(event.currentTarget.value)} /><button type="button" class="secondary-button seed-refresh" disabled={generator.generating} title="换一个随机种子" aria-label="换一个随机种子" onclick={() => generator.randomizeSeed()}><Icon name="refresh" size={14} /></button></div></label>
          <p class="generator-hint">修改种子会自动锁定。预览中的种子可直接用于复现。</p>
        </div>
      </details>
    </div>
  </div>
</section>
