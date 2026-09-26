<script lang="ts">
  import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
  import {
    drawReaderAnnotationStroke,
    type ReaderAnnotationPoint,
    type ReaderAnnotationStroke,
  } from "../../readerAnnotations";

  interface Props {
    pdf: PDFDocumentProxy;
    pageNumber: number;
    targetWidth: number;
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
    pdf,
    pageNumber,
    targetWidth,
    annotationEnabled,
    annotationTool,
    annotationColor,
    annotationWidth,
    strokes,
    onstroke,
    onundo,
    onredo,
  }: Props = $props();

  let rootElement: HTMLDivElement;
  let pageCanvas: HTMLCanvasElement;
  let annotationCanvas: HTMLCanvasElement;
  let pageWidth = $state(320);
  let pageHeight = $state(452);
  let visible = $state(false);
  let rendered = $state(false);
  let failed = $state(false);
  let activeStroke: ReaderAnnotationStroke | undefined;
  let renderTask: RenderTask | undefined;
  let renderSequence = 0;

  $effect(() => {
    const nextPdf = pdf;
    const nextWidth = targetWidth;
    const shouldRender = visible;
    void preparePage(nextPdf, nextWidth, shouldRender);
    return () => {
      renderSequence += 1;
      renderTask?.cancel();
      renderTask = undefined;
    };
  });

  $effect(() => {
    strokes;
    pageWidth;
    pageHeight;
    requestAnimationFrame(redrawAnnotations);
  });

  function observePage(node: HTMLDivElement): { destroy: () => void } {
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    }, { rootMargin: "900px 0px" });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  async function preparePage(document: PDFDocumentProxy, width: number, shouldRender: boolean): Promise<void> {
    const sequence = ++renderSequence;
    try {
      const page = await document.getPage(pageNumber);
      if (sequence !== renderSequence) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const cssScale = Math.max(0.1, width / baseViewport.width);
      const viewport = page.getViewport({ scale: cssScale });
      pageWidth = Math.max(1, Math.round(viewport.width));
      pageHeight = Math.max(1, Math.round(viewport.height));
      failed = false;
      if (!shouldRender) return;

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (sequence !== renderSequence || !pageCanvas) return;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const renderViewport = page.getViewport({ scale: cssScale * ratio });
      pageCanvas.width = Math.ceil(renderViewport.width);
      pageCanvas.height = Math.ceil(renderViewport.height);
      pageCanvas.style.width = `${pageWidth}px`;
      pageCanvas.style.height = `${pageHeight}px`;
      renderTask?.cancel();
      renderTask = page.render({ canvas: pageCanvas, viewport: renderViewport });
      await renderTask.promise;
      if (sequence === renderSequence) rendered = true;
    } catch (error) {
      if (sequence !== renderSequence || isRenderCancellation(error)) return;
      failed = true;
    }
  }

  function resizeAnnotationCanvas(): CanvasRenderingContext2D | undefined {
    if (!annotationCanvas) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.ceil(pageWidth * ratio);
    const pixelHeight = Math.ceil(pageHeight * ratio);
    if (annotationCanvas.width !== pixelWidth) annotationCanvas.width = pixelWidth;
    if (annotationCanvas.height !== pixelHeight) annotationCanvas.height = pixelHeight;
    annotationCanvas.style.width = `${pageWidth}px`;
    annotationCanvas.style.height = `${pageHeight}px`;
    const context = annotationCanvas.getContext("2d") ?? undefined;
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    return context;
  }

  function redrawAnnotations(): void {
    const context = resizeAnnotationCanvas();
    if (!context) return;
    context.clearRect(0, 0, pageWidth, pageHeight);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokes) drawReaderAnnotationStroke(context, stroke, pageWidth, pageHeight);
    if (activeStroke) drawReaderAnnotationStroke(context, activeStroke, pageWidth, pageHeight);
    context.globalCompositeOperation = "source-over";
  }

  function beginStroke(event: PointerEvent): void {
    if (!annotationEnabled || event.button !== 0) return;
    event.preventDefault();
    annotationCanvas.setPointerCapture(event.pointerId);
    activeStroke = {
      tool: annotationTool,
      color: annotationColor,
      width: annotationWidth,
      page: pageNumber,
      points: [annotationPoint(event)],
    };
    redrawAnnotations();
  }

  function continueStroke(event: PointerEvent): void {
    if (!activeStroke || !annotationCanvas.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    const samples = event.getCoalescedEvents?.() ?? [event];
    for (const sample of samples) {
      const point = annotationPoint(sample);
      const previous = activeStroke.points.at(-1);
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.00035) {
        activeStroke.points.push(point);
      }
    }
    redrawAnnotations();
  }

  function finishStroke(event: PointerEvent): void {
    if (!activeStroke) return;
    if (annotationCanvas.hasPointerCapture(event.pointerId)) {
      annotationCanvas.releasePointerCapture(event.pointerId);
    }
    const completed = activeStroke;
    activeStroke = undefined;
    onstroke(completed);
  }

  function annotationPoint(event: PointerEvent): ReaderAnnotationPoint {
    const rect = annotationCanvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    event.preventDefault();
    if (event.shiftKey) onredo();
    else onundo();
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function isRenderCancellation(error: unknown): boolean {
    return error instanceof Error && error.name === "RenderingCancelledException";
  }
</script>

<div
  bind:this={rootElement}
  use:observePage
  class="pdf-page"
  data-pdf-page={pageNumber}
  style:width={`${pageWidth}px`}
  style:height={`${pageHeight}px`}
  aria-label={`PDF 第 ${pageNumber} 页`}
>
  <canvas bind:this={pageCanvas} class:ready={rendered} class="pdf-page-canvas"></canvas>
  {#if failed}<div class="pdf-page-error">第 {pageNumber} 页渲染失败</div>{/if}
  <canvas
    bind:this={annotationCanvas}
    class:active={annotationEnabled}
    class:eraser={annotationTool === "eraser"}
    class="pdf-annotation-canvas"
    aria-label={`PDF 第 ${pageNumber} 页批注画布`}
    tabindex={annotationEnabled ? 0 : -1}
    onpointerdown={beginStroke}
    onpointermove={continueStroke}
    onpointerup={finishStroke}
    onpointercancel={finishStroke}
    onkeydown={handleKeydown}
  ></canvas>
  <span class="pdf-page-number">{pageNumber}</span>
</div>

<style>
  .pdf-page {
    position: relative;
    flex: 0 0 auto;
    overflow: hidden;
    background: white;
    box-shadow: 0 2px 12px rgb(0 0 0 / 24%);
  }

  .pdf-page-canvas,
  .pdf-annotation-canvas {
    position: absolute;
    inset: 0;
    display: block;
  }

  .pdf-page-canvas {
    opacity: 0;
  }

  .pdf-page-canvas.ready {
    opacity: 1;
  }

  .pdf-annotation-canvas {
    z-index: 2;
    outline: 0;
    pointer-events: none;
    touch-action: none;
  }

  .pdf-annotation-canvas.active {
    cursor: crosshair;
    pointer-events: auto;
  }

  .pdf-annotation-canvas.active.eraser {
    cursor: cell;
  }

  .pdf-annotation-canvas:focus-visible {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 75%, transparent);
  }

  .pdf-page-number {
    position: absolute;
    z-index: 3;
    right: 7px;
    bottom: 6px;
    min-width: 22px;
    padding: 2px 5px;
    border-radius: 3px;
    color: #4b5563;
    background: rgb(255 255 255 / 82%);
    font: 10px/1.4 var(--utility-font);
    text-align: center;
    pointer-events: none;
  }

  .pdf-page-error {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #991b1b;
    font: 12px/1.4 var(--ui-font);
  }
</style>
