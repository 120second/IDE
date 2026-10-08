<script lang="ts">
  import type { GeneratedCase, VisualNode } from "../../../types/generator";
  import { formatOutline } from "../../../generator/formatPresets";
  import Icon from "../../shell/Icon.svelte";

  interface Props {
    cases: GeneratedCase[];
    selectedIndex: number;
    select: (index: number) => void;
    copy: () => void;
    save: () => void;
    canSave: boolean;
    nodes: VisualNode[];
    busy: boolean;
    notice: string;
    replay: (seed: string) => void;
  }

  let { cases, selectedIndex, select, copy, save, canSave, nodes, busy, notice, replay }: Props = $props();
  let selected = $derived(cases[selectedIndex]);
  const previewLimit = 200_000;
  let preview = $derived(selected?.input.length > previewLimit ? `${selected.input.slice(0, previewLimit)}\n\n……预览已截断……` : selected?.input ?? "");
  let outline = $derived(formatOutline(nodes));

  function sizeLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  }

  function timeLabel(micros: number): string {
    return micros < 1000 ? `${micros} μs` : `${(micros / 1000).toFixed(2)} ms`;
  }
</script>

<section class="visual-preview">
  <header class="generator-step-header">
    <div class="generator-step-copy"><strong>数据预览</strong><span>{selected ? `第 ${selectedIndex + 1} 组 / 共 ${cases.length} 组` : "生成前先检查输入结构"}</span></div>
    {#if cases.length > 1}<select aria-label="选择生成结果" value={selectedIndex} onchange={(event) => select(Number(event.currentTarget.value))}>{#each cases as _, index}<option value={index}>第 {index + 1} 组</option>{/each}</select>{/if}
  </header>
  {#if selected}
    {#if cases.length > 1 && cases.length <= 10}<div class="preview-case-tabs" role="group" aria-label="生成的数据组">{#each cases as _, index}<button type="button" class:active={index === selectedIndex} aria-pressed={index === selectedIndex} onclick={() => select(index)}>{index + 1}</button>{/each}</div>{/if}
    <div class="preview-meta"><span>大小 {sizeLabel(selected.sizeBytes)}</span><span>生成耗时 {timeLabel(selected.generationTimeMicros)}</span>{#if selected.input.length > previewLimit}<em>仅显示前 {sizeLabel(previewLimit)}</em>{/if}</div>
    <textarea aria-label="生成结果预览" readonly value={preview}></textarea>
    <div class="preview-seed"><code title={`随机种子 ${selected.seed}`}>{selected.seed}</code><button type="button" disabled={busy} onclick={() => replay(selected.seed)} title="锁定这组种子，使用相同格式再次生成即可复现">固定此种子</button></div>
    <footer><button type="button" class="secondary-button" onclick={copy}><Icon name="copy" size={13} />复制</button><button type="button" class="primary-button" onclick={save} disabled={!canSave || busy}><Icon name="plus" size={13} />存为测试点</button></footer>
  {:else}
    <div class="visual-preview-empty"><div class="format-outline" aria-label="输入格式结构">{#each outline as row, index}<div><span aria-hidden="true">{index + 1}</span><code>{row}</code></div>{/each}</div><strong>{busy ? "正在准备数据…" : "格式就绪后，点击“生成新数据”"}</strong><span>生成的数据可以复制、运行或保存为固定测试点。</span></div>
  {/if}
  {#if notice}<p class="generator-notice" role="status">{notice}</p>{/if}
</section>
