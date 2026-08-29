<script lang="ts">
  import type { HandbookPlacedBlock } from "../../templatePrint";
  import TemplatePrintCard from "./TemplatePrintCard.svelte";

  interface Props {
    block: HandbookPlacedBlock;
    showDescription: boolean;
    showMetadata: boolean;
    showLineNumbers: boolean;
  }

  let { block, showDescription, showMetadata, showLineNumbers }: Props = $props();
</script>

{#if block.kind === "chapter"}
  <header class="template-print-chapter-heading"><h2>{block.label}</h2></header>
{:else if block.kind === "section"}
  <header class="template-print-section-heading"><h3>{block.label}</h3></header>
{:else}
  <TemplatePrintCard slice={block.slice} {showDescription} {showMetadata} {showLineNumbers} />
{/if}
