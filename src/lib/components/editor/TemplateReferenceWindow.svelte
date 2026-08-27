<script lang="ts">
  import { cpp } from "@codemirror/lang-cpp";
  import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    insertNewlineAndIndent,
  } from "@codemirror/commands";
  import { bracketMatching, indentOnInput } from "@codemirror/language";
  import { Compartment, EditorState } from "@codemirror/state";
  import {
    EditorView,
    highlightSpecialChars,
    keymap,
    lineNumbers,
  } from "@codemirror/view";
  import { onMount } from "svelte";
  import type { SettingsStore } from "../../stores/settings.svelte";
  import type { TemplateDetail } from "../../types/templates";
  import { createAppearanceExtension } from "../../editor/appearance";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import { templateReferenceCode } from "../../editor/templateCompletion";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    workspace: EditorWorkspace;
    settings: SettingsStore;
    reference: TemplateDetail;
  }

  interface DragState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    maxX: number;
    maxY: number;
  }

  let { workspace, settings, reference }: Props = $props();
  let windowElement: HTMLElement;
  let codeHost: HTMLDivElement;
  let previewView = $state.raw<EditorView>();
  let x = $state(16);
  let y = $state(16);
  let dragging = $state<DragState>();
  let draftDirty = $state(false);
  const appearance = new Compartment();

  onMount(() => {
    const initialCode = templateReferenceCode(reference.code);
    previewView = new EditorView({
      parent: codeHost,
      state: EditorState.create({
        doc: initialCode,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          cpp(),
          EditorView.contentAttributes.of({
            "aria-label": "模板临时副本",
            spellcheck: "false",
          }),
          keymap.of([
            { key: "Enter", run: insertDraft },
            { key: "Shift-Enter", run: insertNewlineAndIndent },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) draftDirty = update.state.doc.toString() !== initialCode;
          }),
          appearance.of(createAppearanceExtension(settings.value)),
          EditorView.theme({
            ".cm-content": { padding: "10px 0 22px" },
            ".cm-scroller": { overscrollBehavior: "contain" },
            ".cm-gutters": { minWidth: "40px" },
          }),
        ],
      }),
    });

    const parent = windowElement.parentElement;
    placeAtUpperRight();
    const observer = parent ? new ResizeObserver(() => clampPosition()) : undefined;
    if (parent) observer?.observe(parent);
    return () => {
      observer?.disconnect();
      previewView?.destroy();
      previewView = undefined;
    };
  });

  $effect(() => {
    const value = settings.value;
    if (!previewView) return;
    previewView.dispatch({
      effects: appearance.reconfigure(createAppearanceExtension(value)),
    });
  });

  function bounds(): { maxX: number; maxY: number } {
    const parent = windowElement.parentElement;
    if (!parent) return { maxX: 0, maxY: 0 };
    return {
      maxX: Math.max(0, parent.clientWidth - windowElement.offsetWidth),
      maxY: Math.max(0, parent.clientHeight - windowElement.offsetHeight),
    };
  }

  function placeAtUpperRight(): void {
    const limits = bounds();
    x = Math.max(0, limits.maxX - 18);
    y = Math.min(24, limits.maxY);
  }

  function clampPosition(): void {
    const limits = bounds();
    x = Math.min(limits.maxX, Math.max(0, x));
    y = Math.min(limits.maxY, Math.max(0, y));
  }

  function beginDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    handle.focus({ preventScroll: true });
    event.preventDefault();
    const limits = bounds();
    dragging = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: x,
      startY: y,
      ...limits,
    };
    handle.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    x = Math.min(dragging.maxX, Math.max(0, dragging.startX + event.clientX - dragging.startClientX));
    y = Math.min(dragging.maxY, Math.max(0, dragging.startY + event.clientY - dragging.startClientY));
  }

  function finishDrag(event: PointerEvent): void {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    dragging = undefined;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
  }

  function moveWithKeyboard(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      insertDraft();
      return;
    }
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const distance = event.shiftKey ? 48 : 12;
    const limits = bounds();
    x = Math.min(limits.maxX, Math.max(0, x + direction[0] * distance));
    y = Math.min(limits.maxY, Math.max(0, y + direction[1] * distance));
  }

  function close(): void {
    workspace.closeTemplateReference();
  }

  function insertDraft(): boolean {
    if (!previewView) return false;
    return workspace.insertTemplateReference(previewView.state.doc.toString(), draftDirty);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<aside
  class:dragging
  class="template-reference-window"
  aria-label={`模板对照：${reference.name}`}
  bind:this={windowElement}
  style:transform={`translate3d(${x}px, ${y}px, 0)`}
>
  <header>
    <button
      class="template-reference-drag-handle"
      type="button"
      aria-label="模板临时副本；按回车插入，可拖动或使用方向键移动"
      title="Enter 插入 · Shift+Enter 换行 · 拖动窗口 · 方向键微调"
      onpointerdown={beginDrag}
      onpointermove={moveDrag}
      onpointerup={finishDrag}
      onpointercancel={finishDrag}
      onkeydown={moveWithKeyboard}
    >
      <span class="drag-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <strong>{reference.name}</strong>
      <span class:edited={draftDirty} class="template-reference-hint" aria-live="polite">
        {draftDirty ? "临时已修改" : "临时副本"} · Enter 插入
      </span>
    </button>
    <button class="template-reference-close" type="button" aria-label="关闭模板对照窗" title="关闭 · Esc" onclick={close}>
      <Icon name="close" size={13} />
    </button>
  </header>
  <div class="template-reference-code" aria-label="可编辑模板临时副本；按回车插入，Shift 加回车换行" translate="no" bind:this={codeHost}></div>
</aside>

<style>
  .template-reference-window {
    position: absolute;
    z-index: 36;
    inset: 0 auto auto 0;
    display: grid;
    width: min(680px, calc(100% - 32px));
    height: min(560px, calc(100% - 32px));
    min-width: min(300px, calc(100% - 16px));
    min-height: min(210px, calc(100% - 16px));
    grid-template-rows: 35px minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-large);
    color: var(--text-primary);
    background: var(--editor-background);
    box-shadow: 0 18px 54px var(--shadow), inset 0 1px 0 color-mix(in srgb, var(--text-primary) 5%, transparent);
  }

  .template-reference-window.dragging {
    box-shadow: 0 22px 64px var(--shadow), 0 0 0 1px var(--accent);
    user-select: none;
  }

  .template-reference-window:focus-within {
    border-color: color-mix(in srgb, var(--accent) 70%, var(--border-strong));
  }

  header {
    display: flex;
    min-width: 0;
    align-items: stretch;
    border-bottom: 1px solid var(--border-strong);
    background: var(--background-elevated);
  }

  .template-reference-drag-handle {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 9px;
    padding: 0 9px 0 11px;
    color: var(--text-secondary);
    background: transparent;
    text-align: left;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .template-reference-drag-handle:active {
    cursor: grabbing;
  }

  .template-reference-drag-handle:hover {
    color: var(--text-primary);
    background: var(--hover-background);
  }

  .template-reference-drag-handle:focus-visible,
  .template-reference-close:focus-visible {
    position: relative;
    z-index: 1;
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .template-reference-drag-handle strong {
    overflow: hidden;
    font-family: var(--display-font);
    font-size: 11px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .template-reference-hint {
    min-width: 0;
    margin-left: auto;
    flex: none;
    color: var(--text-muted);
    font-family: var(--utility-font);
    font-size: 9px;
    font-weight: 520;
    white-space: nowrap;
  }

  .template-reference-hint.edited {
    color: var(--accent-strong);
  }

  .drag-grip {
    display: grid;
    flex: none;
    grid-template-columns: repeat(3, 2px);
    gap: 2px;
  }

  .drag-grip i {
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: var(--text-muted);
  }

  .template-reference-close {
    display: grid;
    width: 34px;
    flex: 0 0 34px;
    place-items: center;
    color: var(--text-muted);
    background: transparent;
  }

  .template-reference-close:hover {
    color: var(--text-primary);
    background: var(--hover-background);
  }

  .template-reference-code {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--editor-background);
  }

  .template-reference-code :global(.cm-editor) {
    width: 100%;
    height: 100%;
  }

  .template-reference-code :global(.cm-content) {
    cursor: text;
  }

  @media (max-width: 820px) {
    .template-reference-window {
      width: min(520px, calc(100% - 16px));
      height: min(460px, calc(100% - 16px));
    }

    .template-reference-hint {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .template-reference-window {
      scroll-behavior: auto;
    }
  }
</style>
