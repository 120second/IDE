<script lang="ts">
  import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
  import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
  import type { ReaderAnnotationStroke } from "../../readerAnnotations";
  import PdfAnnotationPage from "./PdfAnnotationPage.svelte";

  interface Props {
    source: Blob;
    title: string;
    annotationEnabled: boolean;
    annotationTool: "pen" | "eraser";
    annotationColor: string;
    annotationWidth: number;
    strokes: ReaderAnnotationStroke[];
    onstroke: (stroke: ReaderAnnotationStroke) => void;
    onundo: () => void;
    onredo: () => void;
  }

  let {
    source,
    title,
    annotationEnabled,
    annotationTool,
    annotationColor,
    annotationWidth,
    strokes,
    onstroke,
    onundo,
    onredo,
  }: Props = $props();

  let viewerElement: HTMLDivElement;
  let pdf = $state<PDFDocumentProxy>();
  let loading = $state(true);
  let error = $state("");
  let surfaceWidth = $state(520);
  let zoom = $state(100);
  let currentPage = $state(1);
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let pages = $derived(pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : []);
  let pageWidth = $derived(Math.max(220, (surfaceWidth - 32) * zoom / 100));

  $effect(() => {
    const pdfSource = source;
    let cancelled = false;
    loading = true;
    error = "";
    pdf = undefined;
    currentPage = 1;
    loadingTask?.destroy();
    let task: PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const [pdfjs, buffer] = await Promise.all([
          import("pdfjs-dist"),
          pdfSource.arrayBuffer(),
        ]);
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        // Tauri's WebView cannot reliably fetch its own blob: URL (it reports
        // status 0). Hand PDF.js a fresh byte copy so no URL fetch is needed.
        task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
        loadingTask = task;
        const loaded = await task.promise;
        if (cancelled) return;
        pdf = loaded;
        loading = false;
      } catch (reason: unknown) {
        if (cancelled) return;
        loading = false;
        error = reason instanceof Error ? reason.message : String(reason);
      }
    })();
    return () => {
      cancelled = true;
      if (loadingTask === task) loadingTask = undefined;
      void task?.destroy();
    };
  });

  function observeViewer(node: HTMLDivElement): { destroy: () => void } {
    const updateWidth = () => {
      surfaceWidth = Math.max(260, node.clientWidth);
    };
    const resizeObserver = new ResizeObserver(updateWidth);
    const onScroll = () => updateCurrentPage(node);
    resizeObserver.observe(node);
    node.addEventListener("scroll", onScroll, { passive: true });
    updateWidth();
    return {
      destroy: () => {
        resizeObserver.disconnect();
        node.removeEventListener("scroll", onScroll);
      },
    };
  }

  function setZoom(next: number): void {
    zoom = Math.min(220, Math.max(50, Math.round(next / 10) * 10));
  }

  function handleWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 10 : -10));
  }

  function updateCurrentPage(node = viewerElement): void {
    const viewerTop = node.getBoundingClientRect().top + 44;
    let closestPage = currentPage;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const element of node.querySelectorAll<HTMLElement>("[data-pdf-page]")) {
      const distance = Math.abs(element.getBoundingClientRect().top - viewerTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = Number(element.dataset.pdfPage) || closestPage;
      }
    }
    currentPage = closestPage;
  }

  function goToPage(value: number): void {
    if (!pdf) return;
    const next = Math.min(pdf.numPages, Math.max(1, Math.round(value)));
    currentPage = next;
    viewerElement.querySelector<HTMLElement>(`[data-pdf-page="${next}"]`)?.scrollIntoView({ block: "start" });
  }
</script>

<section class="pdf-viewer" aria-label={`PDF：${title}`}>
  <div class="pdf-viewer-controls" aria-label="PDF 查看工具">
    <div class="pdf-page-controls">
      <button aria-label="上一页" title="上一页" disabled={!pdf || currentPage <= 1} onclick={() => goToPage(currentPage - 1)}>‹</button>
      <label><span class="sr-only">当前页</span><input type="number" min="1" max={pdf?.numPages ?? 1} value={currentPage} onchange={(event) => goToPage(Number(event.currentTarget.value))} /></label>
      <span>/ {pdf?.numPages ?? "—"}</span>
      <button aria-label="下一页" title="下一页" disabled={!pdf || currentPage >= pdf.numPages} onclick={() => goToPage(currentPage + 1)}>›</button>
    </div>
    <div class="pdf-zoom-controls">
      <button aria-label="缩小 PDF" title="缩小" onclick={() => setZoom(zoom - 10)}>−</button>
      <button class="zoom-value" title="恢复 100%" onclick={() => setZoom(100)}>{zoom}%</button>
      <button aria-label="放大 PDF" title="放大" onclick={() => setZoom(zoom + 10)}>+</button>
    </div>
  </div>

  <div bind:this={viewerElement} use:observeViewer class="pdf-pages" onwheel={handleWheel}>
    {#if loading}
      <div class="pdf-status" aria-live="polite"><span></span><p>正在解析 PDF…</p></div>
    {:else if error}
      <div class="pdf-status error"><strong>PDF 渲染失败</strong><p>{error}</p></div>
    {:else if pdf}
      {#each pages as pageNumber (pageNumber)}
        <PdfAnnotationPage
          {pdf}
          {pageNumber}
          targetWidth={pageWidth}
          {annotationEnabled}
          {annotationTool}
          {annotationColor}
          {annotationWidth}
          strokes={strokes.filter((stroke) => stroke.page === pageNumber)}
          {onstroke}
          {onundo}
          {onredo}
        />
      {/each}
    {/if}
  </div>
</section>

<style>
  .pdf-viewer {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    background: #2f3338;
  }

  .pdf-viewer-controls {
    display: flex;
    min-height: 39px;
    flex: 0 0 39px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 9px;
    border-bottom: 1px solid rgb(255 255 255 / 14%);
    color: #e5e7eb;
    background: #24272b;
  }

  .pdf-page-controls,
  .pdf-zoom-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  button,
  input {
    min-width: 28px;
    min-height: 28px;
    border: 1px solid rgb(255 255 255 / 15%);
    border-radius: 4px;
    color: inherit;
    background: rgb(255 255 255 / 6%);
    font: 12px/1 var(--utility-font);
  }

  button:hover:not(:disabled) {
    border-color: rgb(255 255 255 / 28%);
    background: rgb(255 255 255 / 12%);
  }

  button:disabled {
    opacity: 0.35;
  }

  input {
    width: 43px;
    padding: 0 4px;
    text-align: center;
  }

  .zoom-value {
    min-width: 48px;
  }

  .pdf-pages {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    align-items: center;
    flex-direction: column;
    gap: 14px;
    overflow: auto;
    padding: 14px 16px 28px;
    overscroll-behavior: contain;
  }

  .pdf-status {
    display: flex;
    min-height: 220px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 10px;
    color: #d1d5db;
    text-align: center;
  }

  .pdf-status span {
    width: 22px;
    height: 22px;
    border: 2px solid rgb(255 255 255 / 20%);
    border-top-color: #5eead4;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .pdf-status p {
    max-width: 420px;
    margin: 0;
    color: #9ca3af;
    font-size: 12px;
  }

  .pdf-status.error strong {
    color: #fca5a5;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .pdf-status span {
      animation: none;
    }
  }
</style>
