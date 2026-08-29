<script lang="ts">
  import type { TemplatePrintSlice } from "../../templatePrint";

  interface Props {
    slice: TemplatePrintSlice;
    showDescription?: boolean;
    showMetadata?: boolean;
    showLineNumbers?: boolean;
  }

  let {
    slice,
    showDescription = true,
    showMetadata = true,
    showLineNumbers = false,
  }: Props = $props();

  let metadata = $derived([
    slice.template.detail.trigger ? `触发词 ${slice.template.detail.trigger}` : "",
    slice.template.detail.aliases.length ? `别名 ${slice.template.detail.aliases.join("、")}` : "",
    slice.template.detail.language,
  ].filter(Boolean));
</script>

<article
  class="print-template-card"
  class:is-compact={slice.compact}
  class:is-full-width={slice.fullWidth}
  class:is-continuation={slice.continuation}
  aria-label={`模板 ${slice.template.detail.name}${slice.continuation ? "续页" : ""}`}
>
  <header class="print-template-heading">
    <div class="print-template-title-row">
      <h3>{slice.template.detail.name}{#if slice.continuation}<span>（续）</span>{/if}</h3>
      {#if !slice.continuation && showMetadata && metadata.length}
        <p title={metadata.join(" · ")}>{metadata.join(" · ")}</p>
      {/if}
    </div>
    {#if !slice.continuation && showDescription && slice.template.detail.description}
      <div>{slice.template.detail.description}</div>
    {/if}
  </header>
  <div class="print-code-block" class:with-line-numbers={showLineNumbers}>
    {#each slice.lines as line, index}
      <span class="print-code-line">
        {#if showLineNumbers}<span class="print-line-number" aria-hidden="true">{slice.startLine + index + 1}</span>{/if}
        <code>{@html line || "&#8203;"}</code>
      </span>
    {/each}
  </div>
</article>
