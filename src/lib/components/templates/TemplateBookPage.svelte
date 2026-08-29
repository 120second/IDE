<script lang="ts">
  import type { TemplateHandbookPage } from "../../templatePrint";
  import TemplatePrintPlacedBlock from "./TemplatePrintPlacedBlock.svelte";

  interface Props {
    page: TemplateHandbookPage;
    totalPages: number;
    templateCount: number;
    compactCount: number;
    visible: boolean;
    showDescription: boolean;
    showMetadata: boolean;
    showLineNumbers: boolean;
    jumpToPage: (pageNumber: number) => void;
  }

  let {
    page,
    totalPages,
    templateCount,
    compactCount,
    visible,
    showDescription,
    showMetadata,
    showLineNumbers,
    jumpToPage,
  }: Props = $props();
</script>

<article
  id={`template-print-page-${page.number}`}
  class="template-book-page"
  class:is-visible={visible}
  class:is-left-page={page.number % 2 === 0}
  class:is-right-page={page.number % 2 === 1}
  class:is-toc-page={page.kind === "toc"}
  aria-hidden={!visible}
  aria-label={`讲义第 ${page.number} 页，共 ${totalPages} 页`}
>
  <header class="template-book-running-header">
    <span>LIGHTCP · 算法模板讲义</span>
    <span>{page.kind === "toc" ? "目录" : page.runningTitle}</span>
  </header>

  <div class="template-book-page-body">
    {#if page.kind === "toc"}
      {#if page.number === 1}
        <div class="template-book-title">
          <span>LIGHTCP HANDBOOK</span>
          <h1>算法模板讲义</h1>
          <p>{templateCount} 个模板 · {compactCount} 个双栏模板 · A4 纸张</p>
        </div>
      {/if}
      <div class="template-book-toc-heading">
        <div><span>{String(page.number).padStart(2, "0")}</span><h2>{page.number === 1 ? "目录" : "目录（续）"}</h2></div>
        <small>点击条目可在预览中跳转</small>
      </div>
      <div class="template-book-toc-columns">
        {#each page.columns as column}
          <div class="template-book-toc-column">
            {#each column as item (item.entry.templateId)}
              {#if item.showMajorHeading}
                <h3 class="template-book-toc-major"><span>{item.entry.majorSection}</span><small>{item.entry.chapterPageNumber}</small></h3>
              {/if}
              {#if item.showMinorHeading}
                <h4 class="template-book-toc-minor"><span>{item.entry.minorSection}</span><small>{item.entry.sectionPageNumber}</small></h4>
              {/if}
              <a
                href={`#template-print-page-${item.entry.pageNumber}`}
                onclick={(event) => {
                  event.preventDefault();
                  jumpToPage(item.entry.pageNumber);
                }}
              >
                <span class="template-book-toc-copy"><strong>{item.entry.name}</strong></span>
                <span class="template-book-toc-leader" aria-hidden="true"></span>
                <span class="template-book-toc-page-number">{item.entry.pageNumber}</span>
              </a>
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      {#each page.bands as band, bandIndex (`${page.number}:${bandIndex}`)}
        {#if band.kind === "columns"}
          <div class="template-print-band-columns">
            {#each band.columns as column, columnIndex (`${page.number}:${bandIndex}:${columnIndex}`)}
              <div class="template-print-flow-column">
                {#each column.blocks as block, blockIndex (`${block.blockId}:${blockIndex}`)}
                  <TemplatePrintPlacedBlock {block} {showDescription} {showMetadata} {showLineNumbers} />
                {/each}
              </div>
            {/each}
          </div>
        {:else}
          <div class="template-print-band-full">
            <TemplatePrintPlacedBlock block={band.block} {showDescription} {showMetadata} {showLineNumbers} />
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <footer class="template-book-page-footer">
    <span>{page.kind === "toc" ? "CONTENTS" : page.runningTitle}</span>
    <strong>{page.number}</strong>
    <span>{page.number} / {totalPages}</span>
  </footer>
</article>
