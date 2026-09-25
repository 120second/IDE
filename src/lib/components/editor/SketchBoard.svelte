<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { nextFloatingZIndex } from "../../floatingLayer";
  import {
    loadSketchDocument,
    saveSketchDocument,
    sketchDocumentKey,
    type SketchPoint,
    type SketchStroke,
  } from "../../sketchBoard";
  import type { UxStore } from "../../stores/ux.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    sourcePath?: string;
    sourceTitle?: string;
    close: () => void;
    ux: UxStore;
  }

  interface MoveState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  }

  interface ResizeState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startHeight: number;
  }

  interface CanvasResizeState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startHeight: number;
  }

  interface PanState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }

  const CANVAS_MIN = 160;
  const CANVAS_MAX = 4_096;
  const PALETTE = [
    "#111827",
    "#ffffff",
    "#64748b",
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#0ea5e9",
    "#6366f1",
    "#a855f7",
    "#52c7b2",
  ] as const;

  let { sourcePath, sourceTitle, close, ux }: Props = $props();
  let windowElement: HTMLElement;
  let workspace: HTMLDivElement;
  let paper: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let activeKey = "";
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let boardWidth = $state(900);
  let boardHeight = $state(650);
  let canvasWidth = $state(960);
  let canvasHeight = $state(640);
  let canvasWidthDraft = $state(960);
  let canvasHeightDraft = $state(640);
  let zoom = $state(1);
  let x = $state(80);
  let y = $state(64);
  let zIndex = $state(nextFloatingZIndex());
  let tool = $state<"pen" | "eraser">("pen");
  let color = $state("#52c7b2");
  let strokeWidth = $state(3);
  let strokes = $state.raw<SketchStroke[]>([]);
  let redoStrokes = $state.raw<SketchStroke[]>([]);
  let activeStroke: SketchStroke | undefined;
  let moveState = $state<MoveState>();
  let resizeState = $state<ResizeState>();
  let canvasResizeState = $state<CanvasResizeState>();
  let panState = $state<PanState>();
  let sourceLabel = $derived(sourceTitle ? sourceTitle.replace(/\.[^.]+$/, "") : "临时草稿");
  let displayedCanvasWidth = $derived(Math.round(canvasWidth * zoom));
  let displayedCanvasHeight = $derived(Math.round(canvasHeight * zoom));
  let zoomPercentage = $derived(Math.round(zoom * 100));

  $effect(() => {
    const nextKey = sketchDocumentKey(sourcePath);
    if (nextKey === activeKey) return;
    untrack(() => loadDocument(nextKey));
  });

  onMount(() => {
    const observer = new ResizeObserver(() => resizeBackingStore());
    observer.observe(canvas);
    const onResize = () => {
      fitToViewport();
      resizeBackingStore();
    };
    const bringForward = () => bringToFront();
    window.addEventListener("resize", onResize);
    windowElement.addEventListener("pointerdown", bringForward, true);
    fitToViewport();
    centerWindow();
    resizeBackingStore();
    return () => {
      flushSave();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      windowElement.removeEventListener("pointerdown", bringForward, true);
    };
  });

  function loadDocument(key: string): void {
    flushSave();
    activeKey = key;
    const stored = loadSketchDocument(key);
    strokes = stored?.strokes ?? [];
    redoStrokes = [];
    canvasWidth = stored?.canvasWidth ?? 960;
    canvasHeight = stored?.canvasHeight ?? 640;
    syncCanvasSizeDrafts();
    requestAnimationFrame(() => {
      fitToViewport();
      resizeBackingStore();
    });
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      persist();
    }, 140);
  }

  function flushSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    if (activeKey) persist();
  }

  function persist(): void {
    if (!activeKey) return;
    saveSketchDocument(activeKey, {
      version: 2,
      canvasWidth,
      canvasHeight,
      strokes,
      updatedAt: Date.now(),
    });
  }

  function bringToFront(): void {
    zIndex = nextFloatingZIndex();
  }

  function viewportLimits(width = boardWidth, height = boardHeight): { maxX: number; maxY: number } {
    return {
      maxX: Math.max(0, window.innerWidth - width),
      maxY: Math.max(0, window.innerHeight - height),
    };
  }

  function centerWindow(): void {
    const limits = viewportLimits();
    x = Math.round(limits.maxX / 2);
    y = Math.round(limits.maxY / 2);
  }

  function fitToViewport(): void {
    boardWidth = Math.min(Math.max(620, boardWidth), Math.max(620, window.innerWidth - 8));
    boardHeight = Math.min(Math.max(420, boardHeight), Math.max(420, window.innerHeight - 8));
    const limits = viewportLimits();
    x = Math.min(limits.maxX, Math.max(0, x));
    y = Math.min(limits.maxY, Math.max(0, y));
  }

  function beginMove(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    bringToFront();
    moveState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: x,
      startY: y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveWindow(event: PointerEvent): void {
    if (!moveState || moveState.pointerId !== event.pointerId) return;
    const limits = viewportLimits();
    x = Math.min(limits.maxX, Math.max(0, moveState.startX + event.clientX - moveState.startClientX));
    y = Math.min(limits.maxY, Math.max(0, moveState.startY + event.clientY - moveState.startClientY));
  }

  function finishMove(event: PointerEvent): void {
    if (!moveState || moveState.pointerId !== event.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    moveState = undefined;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }

  function moveWithKeyboard(event: KeyboardEvent): void {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const distance = event.shiftKey ? 48 : 12;
    const limits = viewportLimits();
    x = Math.min(limits.maxX, Math.max(0, x + direction[0] * distance));
    y = Math.min(limits.maxY, Math.max(0, y + direction[1] * distance));
  }

  function beginResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    bringToFront();
    resizeState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: boardWidth,
      startHeight: boardHeight,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function resizeWindow(event: PointerEvent): void {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    setBoardSize(
      resizeState.startWidth + event.clientX - resizeState.startClientX,
      resizeState.startHeight + event.clientY - resizeState.startClientY,
      false,
    );
  }

  function finishResize(event: PointerEvent): void {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    resizeState = undefined;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    scheduleSave();
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 48 : 16;
    setBoardSize(
      boardWidth + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0),
      boardHeight + (event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0),
    );
  }

  function applyCanvasPreset(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!value) return;
    const [width, height] = value.split("x").map(Number);
    setCanvasSize(width, height);
    (event.currentTarget as HTMLSelectElement).value = "";
  }

  function applyCanvasDimensions(): void {
    setCanvasSize(Number(canvasWidthDraft), Number(canvasHeightDraft));
  }

  function handleDimensionKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyCanvasDimensions();
  }

  function setCanvasSize(width: number, height: number, save = true): void {
    canvasWidth = clampCanvasDimension(width, canvasWidth);
    canvasHeight = clampCanvasDimension(height, canvasHeight);
    syncCanvasSizeDrafts();
    requestAnimationFrame(resizeBackingStore);
    if (save) scheduleSave();
  }

  function clampCanvasDimension(value: number, fallback: number): number {
    return Number.isFinite(value)
      ? Math.round(Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, value)))
      : fallback;
  }

  function syncCanvasSizeDrafts(): void {
    canvasWidthDraft = Math.round(canvasWidth);
    canvasHeightDraft = Math.round(canvasHeight);
  }

  function beginCanvasResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    bringToFront();
    canvasResizeState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: canvasWidth,
      startHeight: canvasHeight,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function resizeCanvas(event: PointerEvent): void {
    if (!canvasResizeState || canvasResizeState.pointerId !== event.pointerId) return;
    setCanvasSize(
      canvasResizeState.startWidth + (event.clientX - canvasResizeState.startClientX) / zoom,
      canvasResizeState.startHeight + (event.clientY - canvasResizeState.startClientY) / zoom,
      false,
    );
  }

  function finishCanvasResize(event: PointerEvent): void {
    if (!canvasResizeState || canvasResizeState.pointerId !== event.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    canvasResizeState = undefined;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    scheduleSave();
  }

  function resizeCanvasWithKeyboard(event: KeyboardEvent): void {
    if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 64 : 16;
    setCanvasSize(
      canvasWidth + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0),
      canvasHeight + (event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0),
    );
  }

  function setBoardSize(width: number, height: number, save = true): void {
    boardWidth = Math.min(Math.max(620, width), Math.max(620, window.innerWidth - x));
    boardHeight = Math.min(Math.max(420, height), Math.max(420, window.innerHeight - y));
    requestAnimationFrame(resizeBackingStore);
    if (save) scheduleSave();
  }

  function beginPan(event: PointerEvent): void {
    if (event.button !== 2) return;
    event.preventDefault();
    bringToFront();
    panState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: workspace.scrollLeft,
      startScrollTop: workspace.scrollTop,
    };
    workspace.setPointerCapture(event.pointerId);
  }

  function panWorkspace(event: PointerEvent): void {
    if (!panState || panState.pointerId !== event.pointerId) return;
    event.preventDefault();
    workspace.scrollLeft = panState.startScrollLeft - (event.clientX - panState.startClientX);
    workspace.scrollTop = panState.startScrollTop - (event.clientY - panState.startClientY);
  }

  function finishPan(event: PointerEvent): void {
    if (!panState || panState.pointerId !== event.pointerId) return;
    panState = undefined;
    if (workspace.hasPointerCapture(event.pointerId)) workspace.releasePointerCapture(event.pointerId);
  }

  function preventWorkspaceContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  function handleWorkspaceWheel(event: WheelEvent): void {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY);
  }

  function setZoom(value: number, anchorClientX?: number, anchorClientY?: number): void {
    const nextZoom = Math.round(Math.min(4, Math.max(0.25, value)) * 20) / 20;
    if (nextZoom === zoom) return;

    const workspaceRect = workspace.getBoundingClientRect();
    const anchorX = anchorClientX ?? workspaceRect.left + workspaceRect.width / 2;
    const anchorY = anchorClientY ?? workspaceRect.top + workspaceRect.height / 2;
    const paperRect = paper.getBoundingClientRect();
    const logicalX = (anchorX - paperRect.left) / zoom;
    const logicalY = (anchorY - paperRect.top) / zoom;

    zoom = nextZoom;
    requestAnimationFrame(() => {
      const nextPaperRect = paper.getBoundingClientRect();
      workspace.scrollLeft += nextPaperRect.left + logicalX * zoom - anchorX;
      workspace.scrollTop += nextPaperRect.top + logicalY * zoom - anchorY;
      resizeBackingStore();
    });
  }

  function resizeBackingStore(): void {
    if (!canvas) return;
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvasWidth * scale));
    const height = Math.max(1, Math.round(canvasHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    redraw();
  }

  function redraw(): void {
    const context = canvas?.getContext("2d");
    if (!context) return;
    const scale = Math.max(1, window.devicePixelRatio || 1);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    for (const stroke of strokes) drawStroke(context, stroke);
    if (activeStroke) drawStroke(context, activeStroke);
  }

  function drawStroke(context: CanvasRenderingContext2D, stroke: SketchStroke): void {
    const [first] = stroke.points;
    if (!first) return;
    context.save();
    context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.tool === "eraser" ? stroke.width * 4 : stroke.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(first.x, first.y);
    if (stroke.points.length === 1) {
      context.lineTo(first.x + 0.01, first.y + 0.01);
    } else {
      for (let index = 1; index < stroke.points.length - 1; index += 1) {
        const point = stroke.points[index];
        const next = stroke.points[index + 1];
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      const last = stroke.points.at(-1);
      if (last) context.lineTo(last.x, last.y);
    }
    context.stroke();
    context.restore();
  }

  function canvasPoint(event: PointerEvent): SketchPoint {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvasWidth / rect.width,
      y: (event.clientY - rect.top) * canvasHeight / rect.height,
    };
  }

  function beginStroke(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType !== "pen") return;
    event.preventDefault();
    bringToFront();
    activeStroke = {
      tool,
      color,
      width: strokeWidth,
      points: [canvasPoint(event)],
    };
    canvas.setPointerCapture(event.pointerId);
    redraw();
  }

  function continueStroke(event: PointerEvent): void {
    if (!activeStroke || !canvas.hasPointerCapture(event.pointerId)) return;
    const samples = event.getCoalescedEvents?.() ?? [event];
    for (const sample of samples) activeStroke.points.push(canvasPoint(sample));
    redraw();
  }

  function finishStroke(event: PointerEvent): void {
    if (!activeStroke) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    strokes = [...strokes, activeStroke];
    activeStroke = undefined;
    redoStrokes = [];
    redraw();
    scheduleSave();
  }

  function undo(): void {
    const stroke = strokes.at(-1);
    if (!stroke) return;
    strokes = strokes.slice(0, -1);
    redoStrokes = [...redoStrokes, stroke];
    redraw();
    scheduleSave();
  }

  function redo(): void {
    const stroke = redoStrokes.at(-1);
    if (!stroke) return;
    redoStrokes = redoStrokes.slice(0, -1);
    strokes = [...strokes, stroke];
    redraw();
    scheduleSave();
  }

  async function clearCanvas(): Promise<void> {
    if (strokes.length === 0) return;
    zIndex = 1_000;
    const confirmed = await ux.confirm({
      title: "清空画板",
      message: "确定清空当前代码文件的全部画板内容吗？",
      confirmLabel: "清空画板",
      danger: true,
    });
    bringToFront();
    if (!confirmed) return;
    strokes = [];
    redoStrokes = [];
    redraw();
    scheduleSave();
  }

  function handleCanvasKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }

  function portal(node: HTMLElement): { destroy: () => void } {
    window.document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<aside
  use:portal
  bind:this={windowElement}
  class:moving={Boolean(moveState)}
  class:resizing={Boolean(resizeState)}
  class:canvas-resizing={Boolean(canvasResizeState)}
  class="sketch-board"
  aria-label={`思路画板：${sourceLabel}`}
  style:width={`${boardWidth}px`}
  style:height={`${boardHeight}px`}
  style:transform={`translate3d(${x}px, ${y}px, 0)`}
  style:z-index={zIndex}
>
  <header>
    <button
      type="button"
      class="sketch-drag-handle"
      aria-label="移动思路画板；拖动或使用方向键移动"
      title="拖动移动 · 方向键微调 · Shift+方向键快速移动"
      onpointerdown={beginMove}
      onpointermove={moveWindow}
      onpointerup={finishMove}
      onpointercancel={finishMove}
      onkeydown={moveWithKeyboard}
    >
      <span class="sketch-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <strong>思路画板</strong>
      <small>{sourceLabel} · 自动保存</small>
    </button>
    <button type="button" class="sketch-close" aria-label="关闭思路画板" title="关闭画板" onclick={close}><Icon name="close" size={14} /></button>
  </header>

  <div class="sketch-toolbar" aria-label="画板工具栏">
    <div class="sketch-tool-section" aria-label="绘图工具">
      <span class="section-label">工具</span>
      <div class="sketch-tool-group">
        <button class:active={tool === "pen"} aria-pressed={tool === "pen"} title="画笔" onclick={() => (tool = "pen")}><Icon name="pencil" size={15} /><span>画笔</span></button>
        <button class:active={tool === "eraser"} aria-pressed={tool === "eraser"} title="橡皮" onclick={() => (tool = "eraser")}><Icon name="eraser" size={15} /><span>橡皮</span></button>
      </div>
    </div>

    <div class="sketch-tool-section sketch-stroke-settings">
      <span class="section-label">笔触</span>
      <label class="sketch-width"><span class="sr-only">粗细</span><input type="range" min="1" max="12" step="1" bind:value={strokeWidth} aria-label="画笔粗细" /><output>{strokeWidth}px</output></label>
    </div>

    <div class="sketch-tool-section sketch-palette-section">
      <span class="section-label">颜色</span>
      <div class="sketch-palette" aria-label="常用颜色">
        {#each PALETTE as swatch}
          <button
            type="button"
            class:active-color={color.toLowerCase() === swatch.toLowerCase()}
            class="color-swatch"
            aria-label={`选择颜色 ${swatch}`}
            title={swatch}
            style:--swatch={swatch}
            onclick={() => (color = swatch)}
          ><span></span></button>
        {/each}
        <label class="sketch-color" title="自定义颜色"><input type="color" bind:value={color} aria-label="自定义画笔颜色" /></label>
      </div>
    </div>

    <div class="sketch-tool-section sketch-history" aria-label="历史记录">
      <span class="section-label">编辑</span>
      <div class="sketch-tool-group">
        <button aria-label="撤销" title="撤销 · Ctrl+Z" disabled={strokes.length === 0} onclick={undo}><Icon name="undo" size={15} /></button>
        <button aria-label="重做" title="重做 · Ctrl+Shift+Z" disabled={redoStrokes.length === 0} onclick={redo}><Icon name="redo" size={15} /></button>
        <button class="danger" aria-label="清空画板" title="清空画板" disabled={strokes.length === 0} onclick={() => void clearCanvas()}><Icon name="trash" size={15} /></button>
      </div>
    </div>

    <div class="sketch-tool-section sketch-size-editor">
      <span class="section-label">画布</span>
      <div class="size-fields">
        <label><span>宽</span><input type="number" min={CANVAS_MIN} max={CANVAS_MAX} step="1" bind:value={canvasWidthDraft} onkeydown={handleDimensionKeydown} aria-label="画布宽度" /></label>
        <span class="size-cross" aria-hidden="true">×</span>
        <label><span>高</span><input type="number" min={CANVAS_MIN} max={CANVAS_MAX} step="1" bind:value={canvasHeightDraft} onkeydown={handleDimensionKeydown} aria-label="画布高度" /></label>
        <span class="size-unit">px</span>
        <button class="apply-size" title="应用画布尺寸" onclick={applyCanvasDimensions}>应用</button>
        <select aria-label="选择画布预设尺寸" title="预设尺寸" onchange={applyCanvasPreset}>
          <option value="">预设</option>
          <option value="560x380">560×380</option>
          <option value="960x640">960×640</option>
          <option value="1280x720">1280×720</option>
          <option value="1920x1080">1920×1080</option>
        </select>
      </div>
    </div>
  </div>

  <div
    bind:this={workspace}
    class:panning={Boolean(panState)}
    class="sketch-canvas-workspace"
    role="region"
    aria-label="画布工作区，可用右键拖动，按 Ctrl 加滚轮缩放"
    title="右键拖动 · Ctrl+滚轮缩放"
    onpointerdown={beginPan}
    onpointermove={panWorkspace}
    onpointerup={finishPan}
    onpointercancel={finishPan}
    oncontextmenu={preventWorkspaceContextMenu}
    onwheel={handleWorkspaceWheel}
  >
    <div
      class="sketch-canvas-stage"
      style:--canvas-width={`${displayedCanvasWidth}px`}
      style:--canvas-height={`${displayedCanvasHeight}px`}
    >
      <div bind:this={paper} class="sketch-paper" style:width={`${displayedCanvasWidth}px`} style:height={`${displayedCanvasHeight}px`}>
        <canvas
          bind:this={canvas}
          class:eraser={tool === "eraser"}
          aria-label={`思路绘画画布，${canvasWidth} × ${canvasHeight} 像素`}
          tabindex="0"
          onpointerdown={beginStroke}
          onpointermove={continueStroke}
          onpointerup={finishStroke}
          onpointercancel={finishStroke}
          onkeydown={handleCanvasKeydown}
        ></canvas>
        <button
          type="button"
          class="canvas-resize-handle"
          aria-label={`调整内部画布大小，当前 ${canvasWidth} × ${canvasHeight}；按 Alt 加方向键调整`}
          title="拖动调整内部画布 · Alt+方向键微调"
          onpointerdown={beginCanvasResize}
          onpointermove={resizeCanvas}
          onpointerup={finishCanvasResize}
          onpointercancel={finishCanvasResize}
          onkeydown={resizeCanvasWithKeyboard}
        ><span></span></button>
      </div>
    </div>
  </div>

  <footer>
    <span>画布 {canvasWidth} × {canvasHeight} px</span>
    <span>{strokes.length} 笔</span>
    <span class="navigation-hint">右键拖动 · Ctrl+滚轮缩放</span>
    <span class="autosave-state">自动保存</span>
    <div class="zoom-controls" aria-label="画布缩放">
      <button type="button" aria-label="缩小画布" title="缩小" disabled={zoom <= 0.25} onclick={() => setZoom(zoom / 1.2)}>−</button>
      <button type="button" class="zoom-value" aria-label={`当前缩放 ${zoomPercentage}%，点击恢复 100%`} title="恢复 100%" onclick={() => setZoom(1)}>{zoomPercentage}%</button>
      <button type="button" aria-label="放大画布" title="放大" disabled={zoom >= 4} onclick={() => setZoom(zoom * 1.2)}>+</button>
    </div>
  </footer>

  <button
    type="button"
    class="sketch-window-resize-handle"
    aria-label={`调整画板窗口大小，当前 ${Math.round(boardWidth)} × ${Math.round(boardHeight)}；按 Alt 加方向键调整`}
    title="拖动调整窗口大小 · Alt+方向键微调"
    onpointerdown={beginResize}
    onpointermove={resizeWindow}
    onpointerup={finishResize}
    onpointercancel={finishResize}
    onkeydown={resizeWithKeyboard}
  ><span></span></button>
</aside>

<style>
  .sketch-board {
    position: fixed;
    inset: 0 auto auto 0;
    display: grid;
    min-width: 620px;
    min-height: 420px;
    grid-template-rows: 36px 82px minmax(0, 1fr) 25px;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-large);
    color: var(--text-primary);
    background: var(--panel-background);
    box-shadow: 0 24px 68px color-mix(in srgb, var(--shadow) 92%, transparent), 0 0 0 1px color-mix(in srgb, var(--text-primary) 4%, transparent);
  }

  .sketch-board.moving,
  .sketch-board.resizing,
  .sketch-board.canvas-resizing {
    border-color: var(--accent);
    box-shadow: 0 28px 78px var(--shadow), 0 0 0 1px var(--accent);
    user-select: none;
  }

  header {
    display: flex;
    min-width: 0;
    border-bottom: 1px solid var(--border-strong);
    background: var(--background-elevated);
  }

  .sketch-drag-handle {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 11px;
    color: var(--text-secondary);
    background: transparent;
    cursor: grab;
    touch-action: none;
    text-align: left;
  }

  .sketch-drag-handle:active { cursor: grabbing; }
  .sketch-drag-handle:hover { color: var(--text-primary); background: var(--hover-background); }

  .sketch-drag-handle strong {
    flex: 0 0 auto;
    font-family: var(--display-font);
    font-size: var(--ui-font-small);
    font-weight: 680;
  }

  .sketch-drag-handle small {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--ui-font-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sketch-grip {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: repeat(3, 2px);
    gap: 2px;
  }

  .sketch-grip i {
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: var(--text-muted);
  }

  .sketch-close {
    display: grid;
    width: 35px;
    flex: 0 0 35px;
    place-items: center;
    color: var(--text-muted);
    background: transparent;
  }

  .sketch-close:hover { color: var(--text-primary); background: var(--hover-background); }

  .sketch-toolbar {
    display: flex;
    min-width: 0;
    align-items: stretch;
    gap: 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 6px 4px 4px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 86%, var(--panel-background));
    scrollbar-width: thin;
  }

  .sketch-tool-section {
    display: flex;
    min-width: max-content;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 3px;
    padding: 0 9px;
    border-right: 1px solid var(--border);
  }

  .sketch-tool-section:last-child { border-right: 0; }

  .section-label {
    order: 2;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 12px;
    letter-spacing: 0.02em;
  }

  .sketch-tool-group { display: flex; align-items: center; gap: 3px; }
  .sketch-toolbar button {
    display: inline-flex;
    min-width: 30px;
    height: 42px;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-secondary);
    background: transparent;
    font-size: var(--ui-font-caption);
  }

  .sketch-toolbar button:hover:not(:disabled),
  .sketch-toolbar button.active {
    border-color: var(--border-strong);
    color: var(--text-primary);
    background: var(--active-background);
  }

  .sketch-toolbar button.active { box-shadow: inset 0 -2px var(--accent); }
  .sketch-toolbar button:disabled { cursor: default; opacity: 0.35; }
  .sketch-toolbar button.danger:hover:not(:disabled) { color: var(--danger); }

  .sketch-width {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: var(--ui-font-caption);
  }

  .sketch-stroke-settings { min-width: 118px; }
  .sketch-width { height: 42px; }
  .sketch-width input { width: 72px; accent-color: var(--accent); }
  .sketch-width output {
    width: 30px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .sketch-palette-section { min-width: 154px; }
  .sketch-palette {
    display: grid;
    height: 42px;
    align-content: center;
    grid-template-columns: repeat(6, 20px);
    gap: 2px;
  }

  .sketch-toolbar button.color-swatch {
    width: 20px;
    min-width: 20px;
    height: 20px;
    padding: 2px;
    border-color: var(--border-strong);
    border-radius: 3px;
    background: var(--surface-sunken);
  }

  .color-swatch span {
    width: 100%;
    height: 100%;
    border: 1px solid color-mix(in srgb, var(--text-primary) 18%, transparent);
    border-radius: 1px;
    background: var(--swatch);
  }

  .sketch-toolbar button.color-swatch.active-color {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .sketch-color {
    display: block;
    width: 20px;
    height: 20px;
  }

  .sketch-color input {
    width: 20px;
    height: 20px;
    padding: 1px;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    background: var(--surface-sunken);
    cursor: pointer;
  }

  .sketch-history { min-width: 112px; }
  .sketch-history button { width: 32px; padding: 0; }

  .sketch-size-editor { min-width: 300px; flex: 1 0 300px; }
  .size-fields {
    display: flex;
    height: 42px;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .size-fields label {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .size-fields input {
    width: 58px;
    height: 28px;
    padding: 0 5px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text-primary);
    background: var(--surface-sunken);
    font: 11px/1 var(--mono-font);
    font-variant-numeric: tabular-nums;
  }

  .size-cross,
  .size-unit { color: var(--text-muted); font-size: 10px; }

  .sketch-toolbar button.apply-size {
    min-width: 42px;
    height: 28px;
    padding: 0 7px;
    border-color: var(--border-strong);
    background: var(--surface-sunken);
  }

  .sketch-toolbar select {
    width: 60px;
    height: 28px;
    padding: 0 17px 0 5px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text-secondary);
    background: var(--surface-sunken);
    font-size: 10px;
  }

  .sketch-canvas-workspace {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    background-color: color-mix(in srgb, var(--editor-background) 72%, var(--surface));
    background-image:
      linear-gradient(45deg, color-mix(in srgb, var(--text-muted) 3%, transparent) 25%, transparent 25%),
      linear-gradient(-45deg, color-mix(in srgb, var(--text-muted) 3%, transparent) 25%, transparent 25%);
    background-position: 0 0, 8px 8px;
    background-size: 16px 16px;
    scrollbar-color: var(--border-strong) var(--surface-sunken);
  }

  .sketch-canvas-workspace.panning,
  .sketch-canvas-workspace.panning canvas {
    cursor: grabbing;
    user-select: none;
  }

  .sketch-canvas-stage {
    display: grid;
    width: max(100%, calc(var(--canvas-width) + 96px));
    height: max(100%, calc(var(--canvas-height) + 96px));
    min-width: max-content;
    min-height: max-content;
    place-items: center;
  }

  .sketch-paper {
    position: relative;
    flex: 0 0 auto;
    border: 1px solid #99a1ad;
    background: #ffffff;
    box-shadow: 0 2px 12px color-mix(in srgb, #000000 30%, transparent);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
    touch-action: none;
  }

  canvas.eraser { cursor: cell; }
  canvas:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }

  .canvas-resize-handle {
    position: absolute;
    z-index: 4;
    right: -10px;
    bottom: -10px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--accent);
    border-radius: 2px;
    background: var(--panel-background);
    box-shadow: 0 1px 5px var(--shadow);
    cursor: nwse-resize;
    touch-action: none;
  }

  .canvas-resize-handle span {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--accent);
    border-bottom: 2px solid var(--accent);
  }

  footer {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 28px 0 10px;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--background-elevated);
    font: 10px/1 var(--mono-font);
    font-variant-numeric: tabular-nums;
  }

  footer .autosave-state { margin-left: auto; }

  .navigation-hint {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .zoom-controls {
    display: flex;
    height: 22px;
    align-items: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--surface-sunken);
  }

  .zoom-controls button {
    display: grid;
    min-width: 24px;
    height: 22px;
    padding: 0 4px;
    place-items: center;
    color: var(--text-secondary);
    background: transparent;
    font: 11px/1 var(--mono-font);
  }

  .zoom-controls button:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--hover-background);
  }

  .zoom-controls button:disabled { opacity: 0.35; }
  .zoom-controls .zoom-value { min-width: 48px; border-inline: 1px solid var(--border); }

  .sketch-window-resize-handle {
    position: absolute;
    z-index: 3;
    right: 0;
    bottom: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    cursor: nwse-resize;
    touch-action: none;
  }

  .sketch-window-resize-handle span,
  .sketch-window-resize-handle::before,
  .sketch-window-resize-handle::after {
    position: absolute;
    right: 4px;
    bottom: 4px;
    height: 1px;
    background: var(--text-muted);
    content: "";
    transform: rotate(-45deg);
    transform-origin: right center;
  }

  .sketch-window-resize-handle span { width: 13px; }
  .sketch-window-resize-handle::before { width: 9px; bottom: 7px; }
  .sketch-window-resize-handle::after { width: 5px; bottom: 10px; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    clip-path: inset(50%);
  }

  .sketch-drag-handle:focus-visible,
  .sketch-close:focus-visible,
  .sketch-toolbar button:focus-visible,
  .sketch-toolbar select:focus-visible,
  .sketch-toolbar input:focus-visible,
  .zoom-controls button:focus-visible,
  .canvas-resize-handle:focus-visible,
  .sketch-window-resize-handle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  @media (max-width: 800px) {
    .sketch-toolbar button span { display: none; }
    .sketch-tool-section { padding-inline: 6px; }
    .navigation-hint { display: none; }
  }
</style>
