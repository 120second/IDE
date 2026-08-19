<script lang="ts">
  import type { GeneratedCase } from "../../../types/generator";

  interface Props {
    cases: GeneratedCase[];
    selectedIndex: number;
    select: (index: number) => void;
    copy: () => void;
    save: () => void;
    canSave: boolean;
  }

  let { cases, selectedIndex, select, copy, save, canSave }: Props = $props();
  let selected = $derived(cases[selectedIndex]);
  const previewLimit = 200_000;
  let preview = $derived(selected?.input.length > previewLimit ? `${selected.input.slice(0, previewLimit)}\n\n……预览已截断……` : selected?.input ?? "");

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
  <header>
    <div><strong>生成预览</strong>{#if selected}<span>种子 {selected.seed}</span>{/if}</div>
    {#if cases.length > 1}<select aria-label="选择生成结果" value={selectedIndex} onchange={(event) => select(Number(event.currentTarget.value))}>{#each cases as _, index}<option value={index}>第 {index + 1} 组</option>{/each}</select>{/if}
  </header>
  {#if selected}
    <div class="preview-meta"><span>大小 {sizeLabel(selected.sizeBytes)}</span><span>生成耗时 {timeLabel(selected.generationTimeMicros)}</span>{#if selected.input.length > previewLimit}<em>仅显示前 {sizeLabel(previewLimit)}</em>{/if}</div>
    <textarea aria-label="生成结果预览" readonly value={preview}></textarea>
    <footer><button class="secondary-button" onclick={copy}>复制</button><button class="primary-button" onclick={save} disabled={!canSave}>保存为测试点</button></footer>
  {:else}
    <div class="visual-preview-empty">规则有效后点击“生成”，结果会显示在这里。</div>
  {/if}
</section>
