<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { getTemplates, listTemplates } from "../../api/templates";
  import {
    buildTemplateHandbook,
    PRINT_LAYOUT_CONFIG,
    printLayoutCssVariables,
    type TemplatePrintLayout,
  } from "../../templatePrint";
  import type {
    TemplateCategory,
    TemplateDetail,
    TemplateFilter,
    TemplateKind,
  } from "../../types/templates";
  import Icon from "../shell/Icon.svelte";
  import TemplateBookPage from "./TemplateBookPage.svelte";

  type PrintScope = "all" | "category" | "favorites";
  type PrintKind = "all" | TemplateKind;

  interface Props {
    categories: readonly TemplateCategory[];
    selectedCategoryId?: number;
    onclose: () => void;
  }

  let { categories, selectedCategoryId, onclose }: Props = $props();
  let dialogElement: HTMLDivElement;
  let previewViewport = $state<HTMLDivElement>();
  let templates = $state.raw<TemplateDetail[]>([]);
  let loading = $state(true);
  let printing = $state(false);
  let error = $state("");
  let scope = $state<PrintScope>("all");
  let kind = $state<PrintKind>("all");
  let layout = $state<TemplatePrintLayout>("auto");
  let showDescription = $state(true);
  let showMetadata = $state(true);
  let showLineNumbers = $state(false);
  let currentPage = $state(1);
  let previewScale = $state(0.82);
  let previewPanning = $state(false);
  let paginationSignature = $state("");
  let cancelPrintSession: (() => void) | undefined;
  const printLayoutVariables = printLayoutCssVariables();
  let panState: {
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | undefined;

  let visibleTemplates = $derived.by(() => {
    const categoryIds = scope === "category" && selectedCategoryId !== undefined
      ? descendantCategoryIds(selectedCategoryId, categories)
      : undefined;
    return templates.filter((template) => {
      if (kind !== "all" && template.kind !== kind) return false;
      if (scope === "favorites" && !template.favorite) return false;
      if (categoryIds && (template.categoryId === undefined || !categoryIds.has(template.categoryId))) {
        return false;
      }
      return true;
    });
  });
  let handbook = $derived(buildTemplateHandbook(
    visibleTemplates,
    categories,
    layout,
    { showDescription, showMetadata, showLineNumbers },
  ));
  let totalPages = $derived(handbook.pages.length);
  let spreadStart = $derived(currentPage <= 1
    ? 1
    : currentPage % 2 === 0 ? currentPage : currentPage - 1);
  let spreadEnd = $derived(spreadStart === 1
    ? 1
    : Math.min(totalPages, spreadStart + 1));

  onMount(() => {
    dialogElement.focus();
    void loadTemplatesForPrint();
  });

  onDestroy(() => {
    cancelPrintSession?.();
  });

  $effect(() => {
    const signature = [
      scope,
      kind,
      layout,
      showDescription,
      showMetadata,
      showLineNumbers,
      visibleTemplates.map((template) => template.id).join(","),
    ].join(":");
    if (paginationSignature !== signature) {
      paginationSignature = signature;
      currentPage = 1;
    } else if (currentPage > totalPages) {
      currentPage = Math.max(1, totalPages);
    }
  });

  $effect(() => {
    if (!import.meta.env.DEV) return;
    const metrics = handbook.pages
      .filter((page) => page.kind === "content")
      .map((page) => ({
        page: page.number,
        utilization: `${Math.round(page.metrics.utilization * 100)}%`,
        columns: page.metrics.columnUtilization.map((value) => `${Math.round(value * 100)}%`),
        reasons: page.metrics.breakReasons,
      }));
    console.debug("[template-print-layout]", metrics);
  });

  async function loadTemplatesForPrint(): Promise<void> {
    loading = true;
    error = "";
    try {
      const [snippets, files] = await Promise.all([
        listTemplates(printFilter("snippet")),
        listTemplates(printFilter("file")),
      ]);
      templates = await getTemplates([...snippets, ...files].map((template) => template.id));
    } catch (loadError) {
      error = loadError instanceof Error ? loadError.message : String(loadError);
    } finally {
      loading = false;
    }
  }

  async function printTemplates(): Promise<void> {
    if (printing || visibleTemplates.length === 0) return;
    printing = true;
    await tick();
    document.body.classList.add("template-print-active");
    const printMedia = window.matchMedia("print");
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      document.body.classList.remove("template-print-active");
      window.removeEventListener("afterprint", cleanup);
      printMedia.removeEventListener("change", handlePrintMediaChange);
      cancelPrintSession = undefined;
      printing = false;
    };
    const handlePrintMediaChange = (event: MediaQueryListEvent) => {
      if (!event.matches) cleanup();
    };
    cancelPrintSession = cleanup;
    window.addEventListener("afterprint", cleanup);
    printMedia.addEventListener("change", handlePrintMediaChange);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        window.print();
      } catch (printError) {
        cleanup();
        error = printError instanceof Error ? printError.message : String(printError);
      }
    }));
  }

  function jumpToPage(pageNumber: number): void {
    currentPage = Math.min(Math.max(1, pageNumber), Math.max(1, totalPages));
  }

  function previousSpread(): void {
    jumpToPage(spreadStart <= 2 ? 1 : spreadStart - 2);
  }

  function nextSpread(): void {
    jumpToPage(spreadStart === 1
      ? Math.min(totalPages, 2)
      : Math.min(totalPages, spreadStart + 2));
  }

  async function setPreviewScale(nextScale: number): Promise<void> {
    const viewport = previewViewport;
    const scale = Math.min(1.2, Math.max(0.5, Math.round(nextScale * 20) / 20));
    if (!viewport || scale === previewScale) {
      previewScale = scale;
      return;
    }
    const contentCenterX = (viewport.scrollLeft + viewport.clientWidth / 2) / previewScale;
    const contentCenterY = (viewport.scrollTop + viewport.clientHeight / 2) / previewScale;
    previewScale = scale;
    await tick();
    viewport.scrollLeft = contentCenterX * scale - viewport.clientWidth / 2;
    viewport.scrollTop = contentCenterY * scale - viewport.clientHeight / 2;
  }

  function fitPreview(): void {
    if (!previewViewport) return;
    const pageSpreadWidth = PRINT_LAYOUT_CONFIG.pageWidthMm * 2 * 96 / 25.4;
    const pageHeight = PRINT_LAYOUT_CONFIG.pageHeightMm * 96 / 25.4;
    const horizontalScale = (previewViewport.clientWidth - 56) / pageSpreadWidth;
    const verticalScale = (previewViewport.clientHeight - 48) / pageHeight;
    void setPreviewScale(Math.min(horizontalScale, verticalScale, 1));
  }

  function handlePreviewPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !previewViewport) return;
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea")) return;
    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: previewViewport.scrollLeft,
      scrollTop: previewViewport.scrollTop,
    };
    previewViewport.setPointerCapture(event.pointerId);
  }

  function handlePreviewPointerMove(event: PointerEvent): void {
    if (!previewViewport || !panState || event.pointerId !== panState.pointerId) return;
    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    if (!previewPanning && Math.hypot(deltaX, deltaY) < 4) return;
    previewPanning = true;
    event.preventDefault();
    previewViewport.scrollLeft = panState.scrollLeft - deltaX;
    previewViewport.scrollTop = panState.scrollTop - deltaY;
  }

  function finishPreviewPan(event: PointerEvent): void {
    if (!previewViewport || !panState || event.pointerId !== panState.pointerId) return;
    if (previewViewport.hasPointerCapture(event.pointerId)) {
      previewViewport.releasePointerCapture(event.pointerId);
    }
    panState = undefined;
    previewPanning = false;
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !printing) {
      event.preventDefault();
      onclose();
      return;
    }
    const target = event.target as HTMLElement;
    if (!target.closest("input, select")) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        previousSpread();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        nextSpread();
        return;
      }
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialogElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function categoryLabel(): string {
    if (selectedCategoryId === undefined) return "当前分类";
    return `当前分类：${categoryPath(selectedCategoryId, categories)}`;
  }

  function printFilter(templateKind: TemplateKind): TemplateFilter {
    return {
      kind: templateKind,
      search: "",
      favoriteOnly: false,
      recentOnly: false,
      sort: "manual",
    };
  }

  function descendantCategoryIds(
    categoryId: number,
    categoryList: readonly TemplateCategory[],
  ): Set<number> {
    const result = new Set<number>([categoryId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categoryList) {
        if (category.parentId !== undefined && result.has(category.parentId) && !result.has(category.id)) {
          result.add(category.id);
          changed = true;
        }
      }
    }
    return result;
  }

  function categoryPath(
    categoryId: number,
    categoryList: readonly TemplateCategory[],
  ): string {
    const byId = new Map(categoryList.map((category) => [category.id, category]));
    const names: string[] = [];
    const visited = new Set<number>();
    let current = byId.get(categoryId);
    while (current && !visited.has(current.id)) {
      names.unshift(current.name);
      visited.add(current.id);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    return names.join(" / ") || "未分类";
  }
</script>

<div class="template-print-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !printing) onclose(); }}>
  <div
    class="template-print-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="template-print-title"
    tabindex="-1"
    bind:this={dialogElement}
    onkeydown={handleDialogKeydown}
    onclick={(event) => event.stopPropagation()}
  >
    <header class="template-print-dialog-header">
      <div>
        <span class="template-print-eyebrow">A4 BOOK PREVIEW</span>
        <strong id="template-print-title">打印与导出模板讲义</strong>
        <small>顺序双栏分页、逻辑续栏与省墨打印主题。</small>
      </div>
      <div class="template-print-header-actions">
        <button class="secondary-button" type="button" onclick={onclose} disabled={printing}>取消</button>
        <button
          class="primary-button template-print-submit"
          type="button"
          onclick={() => void printTemplates()}
          disabled={loading || printing || visibleTemplates.length === 0}
        ><Icon name="printer" size={14} />{printing ? "正在打开打印…" : `打印全部 ${totalPages} 页 / 保存 PDF`}</button>
        <button class="template-print-close" type="button" aria-label="关闭打印预览" onclick={onclose} disabled={printing}><Icon name="close" size={15} /></button>
      </div>
    </header>

    <div class="template-print-dialog-body">
      <aside class="template-print-settings" aria-label="打印设置">
        <section>
          <header><span>内容范围</span><small>{visibleTemplates.length} 个模板</small></header>
          <label>
            <span>模板</span>
            <select bind:value={scope}>
              <option value="all">全部模板</option>
              <option value="category" disabled={selectedCategoryId === undefined}>{categoryLabel()}</option>
              <option value="favorites">仅收藏</option>
            </select>
          </label>
          <label>
            <span>类型</span>
            <select bind:value={kind}>
              <option value="all">代码片段与文件模板</option>
              <option value="snippet">仅代码片段</option>
              <option value="file">仅文件模板</option>
            </select>
          </label>
        </section>

        <section>
          <header><span>页面排版</span><small>{totalPages} 页</small></header>
          <div class="template-print-layout-options" role="group" aria-label="排版密度">
            <button type="button" class:active={layout === "auto"} aria-pressed={layout === "auto"} onclick={() => (layout = "auto")}>
              <strong>自动紧凑</strong><small>推荐</small>
            </button>
            <button type="button" class:active={layout === "single"} aria-pressed={layout === "single"} onclick={() => (layout = "single")}>
              <strong>统一单栏</strong><small>易阅读</small>
            </button>
            <button type="button" class:active={layout === "compact"} aria-pressed={layout === "compact"} onclick={() => (layout = "compact")}>
              <strong>极致省纸</strong><small>更多双栏</small>
            </button>
          </div>
          <p class="template-print-layout-summary"><strong>{handbook.compactCount}</strong> 个模板使用双栏；目录和内容共 <strong>{totalPages}</strong> 页。</p>
        </section>

        <section>
          <header><span>显示内容</span></header>
          <label class="template-print-check"><input type="checkbox" bind:checked={showDescription} /><span>模板说明</span></label>
          <label class="template-print-check"><input type="checkbox" bind:checked={showMetadata} /><span>触发词、别名与语言</span></label>
          <label class="template-print-check"><input type="checkbox" bind:checked={showLineNumbers} /><span>代码行号</span></label>
        </section>

        <div class="template-print-note">
          <Icon name="warning" size={14} />
          <span>保存 PDF 时将输出全部 {totalPages} 张 A4 书页，并自动切换为省墨白底打印主题；屏幕预览仍保留暗色高亮。</span>
        </div>
      </aside>

      <main class="template-print-preview" aria-label="A4 书本打印预览">
        {#if loading}
          <div class="template-print-state"><span class="template-print-spinner"></span><strong>正在整理模板…</strong><small>计算目录、页码和代码续页</small></div>
        {:else if error}
          <div class="template-print-state error" role="alert"><Icon name="warning" size={24} /><strong>无法生成预览</strong><small>{error}</small><button type="button" onclick={() => void loadTemplatesForPrint()}>重试</button></div>
        {:else if visibleTemplates.length === 0}
          <div class="template-print-state"><Icon name="templates" size={25} /><strong>当前范围没有模板</strong><small>请调整左侧的内容范围。</small></div>
        {:else}
          <nav class="template-book-toolbar" aria-label="书页导航">
            <div class="template-book-page-controls">
              <button type="button" onclick={() => jumpToPage(1)} disabled={spreadStart === 1}>目录</button>
              <button type="button" class="template-book-page-arrow previous" aria-label="上一组书页" onclick={previousSpread} disabled={spreadStart === 1}><Icon name="chevron-right" size={13} /></button>
              <span>第 <strong>{spreadStart}{#if spreadEnd > spreadStart}–{spreadEnd}{/if}</strong> 页 / 共 {totalPages} 页</span>
              <button type="button" class="template-book-page-arrow" aria-label="下一组书页" onclick={nextSpread} disabled={spreadEnd >= totalPages}><Icon name="chevron-right" size={13} /></button>
            </div>
            <div class="template-book-zoom-controls" role="group" aria-label="预览大小">
              <button type="button" aria-label="缩小预览" onclick={() => void setPreviewScale(previewScale - 0.05)} disabled={previewScale <= 0.5}>−</button>
              <label>
                <span class="sr-only">预览缩放比例</span>
                <input
                  type="range"
                  min="50"
                  max="120"
                  step="5"
                  value={Math.round(previewScale * 100)}
                  aria-valuetext={`${Math.round(previewScale * 100)}%`}
                  oninput={(event) => void setPreviewScale(Number(event.currentTarget.value) / 100)}
                />
                <output aria-live="polite">{Math.round(previewScale * 100)}%</output>
              </label>
              <button type="button" aria-label="放大预览" onclick={() => void setPreviewScale(previewScale + 0.05)} disabled={previewScale >= 1.2}>＋</button>
              <button type="button" onclick={fitPreview}>适应</button>
            </div>
          </nav>

          <div
            class="template-book-viewport"
            class:is-panning={previewPanning}
            role="region"
            aria-label="可拖动的 A4 书页画布"
            bind:this={previewViewport}
            onpointerdown={handlePreviewPointerDown}
            onpointermove={handlePreviewPointerMove}
            onpointerup={finishPreviewPan}
            onpointercancel={finishPreviewPan}
          >
            <div class="template-book-canvas" style={`${printLayoutVariables}; --template-preview-scale: ${previewScale}`}>
              <div
                class="template-print-document"
                class:single-page-right={spreadStart === 1}
                class:single-page-left={spreadStart > 1 && spreadEnd === spreadStart}
              >
                {#each handbook.pages as page (page.number)}
                  <TemplateBookPage
                    {page}
                    {totalPages}
                    templateCount={visibleTemplates.length}
                    compactCount={handbook.compactCount}
                    visible={page.number === spreadStart || (spreadStart > 1 && page.number === spreadEnd)}
                    {showDescription}
                    {showMetadata}
                    {showLineNumbers}
                    {jumpToPage}
                  />
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </main>
    </div>
  </div>
</div>
