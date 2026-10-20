<script lang="ts">
  import { recognizeSample, SAMPLE_EXAMPLES, sampleRanges, updateSampleRange, type SampleFormat } from "../../../generator/sampleFormat";
  import { formatOutline } from "../../../generator/formatPresets";
  import type { VisualDiagnostic, VisualNode } from "../../../types/generator";
  import ValueExpressionInput from "./ValueExpressionInput.svelte";
  import Icon from "../../shell/Icon.svelte";

  interface Props {
    nodes: VisualNode[];
    diagnostics: VisualDiagnostic[];
    change: (nodes: VisualNode[]) => void;
    pending: (value: boolean) => void;
    busy: boolean;
  }
  let { nodes, diagnostics, change, pending, busy }: Props = $props();
  let sample = $state("");
  let candidates = $state.raw<SampleFormat[]>([]);
  let selectedId = $state("");
  let error = $state("");
  let unapplied = $state(false);
  let sampleOpen = $state(true);
  let previous = $state.raw<VisualNode[]>();
  let selected = $derived(candidates.find((item) => item.id === selectedId));
  let ranges = $derived(sampleRanges(nodes));
  let outline = $derived(formatOutline(nodes));

  function editSample(value: string): void {
    sample = value;
    unapplied = true;
    error = "";
    pending(true);
  }
  function recognize(): void {
    if (busy) return;
    try {
      const recognized = recognizeSample(sample);
      previous = nodes;
      candidates = recognized;
      choose(recognized[0].id);
      error = "";
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }
  function choose(id: string): void {
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate || busy) return;
    selectedId = id;
    change(structuredClone(candidate.nodes));
    sampleOpen = false;
    unapplied = false;
    pending(false);
  }
  function restore(): void {
    if (!previous || busy) return;
    change(previous);
    previous = undefined;
    candidates = [];
    sampleOpen = true;
    selectedId = "";
    unapplied = false;
    error = "";
    pending(false);
  }
  function errors(id: string, nodeId: string): string[] {
    return diagnostics.filter((item) => item.fieldId === id || item.nodeId === nodeId && !item.fieldId).map((item) => item.message);
  }
</script>

<section class="sample-builder" aria-label="从输入样例生成随机数据">
  <header class="sample-heading"><div><strong>{sampleOpen ? "粘贴样例，直接改范围" : `已识别：${selected?.label ?? "当前格式"}`}</strong><p>{sampleOpen ? "只粘贴输入部分，数组长度和重复行数会自动关联。" : selected?.description ?? "修改下方范围，即可生成。"}</p></div><span class="sample-local">本机识别</span></header>
  <fieldset disabled={busy}>
    {#if sampleOpen}
    <label class="sample-input-label" for="random-input-sample">输入样例</label>
    <textarea id="random-input-sample" class="sample-input" value={sample} oninput={(event) => editSample(event.currentTarget.value)} spellcheck="false" maxlength="65536" placeholder={"5\n3 1 4 1 5"} aria-describedby="sample-help"></textarea>
    <div class="sample-input-actions"><button type="button" class="primary-button" onclick={recognize} disabled={!sample.trim() || busy}><Icon name="search" size={14} />识别格式</button>{#if previous}<button type="button" class="text-button" onclick={restore}><Icon name="undo" size={13} />恢复之前的格式</button>{/if}</div>
    <div class="sample-examples"><span>试一下</span>{#each SAMPLE_EXAMPLES as example}<button type="button" onclick={() => { editSample(example.input); recognize(); }}>{example.label}</button>{/each}</div>
    {:else}
      <div class="sample-source-summary"><span>已读取 {sample.trim().split(/\r?\n/).length} 行输入</span><button type="button" class="text-button" onclick={() => { sampleOpen = true; }}>查看 / 更换样例</button>{#if previous}<button type="button" class="text-button" onclick={restore}>恢复之前的格式</button>{/if}</div>
    {/if}
    {#if error}<p class="sample-error" role="alert">{error}</p>{/if}
    {#if unapplied}<p class="sample-pending" role="status">新样例尚未应用。点击“识别格式”后再生成；原来的格式和范围仍然保留。</p>{/if}
    {#if candidates.length > 1 && !unapplied}
      <label class="sample-interpretation"><span>样例有 {candidates.length} 种可能的解释，请按题意选择</span><select value={selectedId} onchange={(event) => choose(event.currentTarget.value)}>{#each candidates as candidate}<option value={candidate.id}>{candidate.label}</option>{/each}</select></label>
    {/if}
    {#if sampleOpen}<div class="sample-range-heading"><div><strong>{selected && !unapplied ? `已识别：${selected.label}` : "当前格式的参数"}</strong><p>{selected && !unapplied ? selected.description : "已保存的格式可以直接修改，不必重新粘贴样例。"}</p></div></div>{/if}
    {#if selected?.warning && !unapplied}<p class="sample-assumption"><Icon name="warning" size={14} /><span>{selected.warning}</span></p>{/if}
    <p id="sample-help" class="sample-help">初始规模和范围取自样例，请按题目约束修改。支持 <code>n</code>、<code>n-1</code>、<code>1e9</code>。</p>
    <div class="sample-range-table" role="group" aria-label="参数取值范围">
      <div class="sample-range-columns" aria-hidden="true"><span>参数</span><span>最小值</span><span>最大值</span></div>
      {#each ranges as row (row.id)}
        <div class:invalid={errors(row.id, row.nodeId).length > 0} class="sample-range-row">
          <div class="sample-range-name"><strong>{row.label}</strong><small>{row.detail}</small></div>
          <ValueExpressionInput label={`${row.label}最小值`} value={row.minimum} variables={row.variables} change={(value) => change(updateSampleRange(nodes, row.id, "minimum", value))} />
          <ValueExpressionInput label={`${row.label}最大值`} value={row.maximum} variables={row.variables} change={(value) => change(updateSampleRange(nodes, row.id, "maximum", value))} />
          {#each errors(row.id, row.nodeId) as message}<p class="sample-error">{message}</p>{/each}
        </div>
      {/each}
      {#if !ranges.length}<p class="sample-help">此格式没有可调整的数值范围，可在高级编辑中修改结构。</p>{/if}
    </div>
    <details class="sample-outline"><summary>查看完整输入格式 <span>{outline.length} 行结构说明</span></summary><pre>{outline.join("\n")}</pre></details>
  </fieldset>
</section>
