<script lang="ts">
  import { onMount } from "svelte";
  import type { SettingsStore } from "../../stores/settings.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import Icon from "../shell/Icon.svelte";
  import SettingsNavigation from "./SettingsNavigation.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";

  interface Props {
    settings: SettingsStore;
    shell: ShellStore;
    ux: UxStore;
  }

  type Interaction = "drag" | "resize";

  const EDGE_GAP = 12;
  const MIN_WIDTH = 420;
  const MIN_HEIGHT = 360;

  let { settings, shell, ux }: Props = $props();
  let layer = $state<HTMLDivElement>();
  let left = $state(EDGE_GAP);
  let top = $state(EDGE_GAP);
  let width = $state(700);
  let height = $state(590);
  let ready = $state(false);
  let interaction = $state<Interaction>();
  let pointerStartX = 0;
  let pointerStartY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startWidth = 0;
  let startHeight = 0;
  let sizePreset = 1;

  function limits(): { maxWidth: number; maxHeight: number } {
    return {
      maxWidth: Math.max(300, (layer?.clientWidth ?? window.innerWidth) - EDGE_GAP * 2),
      maxHeight: Math.max(280, (layer?.clientHeight ?? window.innerHeight) - EDGE_GAP * 2),
    };
  }

  function clampLayout(): void {
    if (!layer) return;
    const { maxWidth, maxHeight } = limits();
    width = Math.min(maxWidth, Math.max(Math.min(MIN_WIDTH, maxWidth), width));
    height = Math.min(maxHeight, Math.max(Math.min(MIN_HEIGHT, maxHeight), height));
    left = Math.min(Math.max(EDGE_GAP, left), Math.max(EDGE_GAP, layer.clientWidth - width - EDGE_GAP));
    top = Math.min(Math.max(EDGE_GAP, top), Math.max(EDGE_GAP, layer.clientHeight - height - EDGE_GAP));
  }

  function centerWindow(): void {
    if (!layer) return;
    clampLayout();
    left = Math.max(EDGE_GAP, Math.round((layer.clientWidth - width) / 2));
    top = Math.max(EDGE_GAP, Math.round((layer.clientHeight - height) / 2));
  }

  function cycleWindowSize(): void {
    if (!layer) return;
    const { maxWidth, maxHeight } = limits();
    const presets = [
      { width: 500, height: 430 },
      { width: 700, height: 590 },
      { width: maxWidth, height: maxHeight },
    ];
    sizePreset = (sizePreset + 1) % presets.length;
    width = Math.min(maxWidth, presets[sizePreset].width);
    height = Math.min(maxHeight, presets[sizePreset].height);
    centerWindow();
  }

  function beginInteraction(event: PointerEvent, next: Interaction): void {
    if (event.button !== 0) return;
    if (next === "drag" && event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    interaction = next;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    startLeft = left;
    startTop = top;
    startWidth = width;
    startHeight = height;
  }

  function movePointer(event: PointerEvent): void {
    if (!interaction || !layer) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    if (interaction === "drag") {
      left = Math.min(
        Math.max(EDGE_GAP, startLeft + deltaX),
        Math.max(EDGE_GAP, layer.clientWidth - width - EDGE_GAP),
      );
      top = Math.min(
        Math.max(EDGE_GAP, startTop + deltaY),
        Math.max(EDGE_GAP, layer.clientHeight - height - EDGE_GAP),
      );
      return;
    }

    const maxWidth = Math.max(280, layer.clientWidth - left - EDGE_GAP);
    const maxHeight = Math.max(260, layer.clientHeight - top - EDGE_GAP);
    width = Math.min(maxWidth, Math.max(Math.min(MIN_WIDTH, maxWidth), startWidth + deltaX));
    height = Math.min(maxHeight, Math.max(Math.min(MIN_HEIGHT, maxHeight), startHeight + deltaY));
  }

  function endInteraction(): void {
    interaction = undefined;
  }

  function moveWithKeyboard(event: KeyboardEvent): void {
    const direction = event.key;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(direction)) return;
    event.preventDefault();
    const distance = event.shiftKey ? 24 : 8;
    if (direction === "ArrowLeft") left -= distance;
    if (direction === "ArrowRight") left += distance;
    if (direction === "ArrowUp") top -= distance;
    if (direction === "ArrowDown") top += distance;
    clampLayout();
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    const direction = event.key;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(direction)) return;
    event.preventDefault();
    const distance = event.shiftKey ? 24 : 8;
    if (direction === "ArrowLeft") width -= distance;
    if (direction === "ArrowRight") width += distance;
    if (direction === "ArrowUp") height -= distance;
    if (direction === "ArrowDown") height += distance;
    clampLayout();
  }

  function closeWindow(): void {
    shell.closeSettingsWindow();
  }

  onMount(() => {
    if (!layer) return;
    const { maxWidth, maxHeight } = limits();
    width = Math.min(700, maxWidth);
    height = Math.min(590, maxHeight);
    centerWindow();
    ready = true;

    const observer = new ResizeObserver(clampLayout);
    observer.observe(layer);
    window.addEventListener("pointermove", movePointer);
    window.addEventListener("pointerup", endInteraction);
    window.addEventListener("pointercancel", endInteraction);
    window.addEventListener("blur", endInteraction);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerup", endInteraction);
      window.removeEventListener("pointercancel", endInteraction);
      window.removeEventListener("blur", endInteraction);
    };
  });
</script>

<div class="settings-window-layer" bind:this={layer}>
  <div
    class:dragging={interaction === "drag"}
    class:resizing={interaction === "resize"}
    class:ready
    class="settings-window"
    role="dialog"
    aria-label="设置详情"
    style:left={`${left}px`}
    style:top={`${top}px`}
    style:width={`${width}px`}
    style:height={`${height}px`}
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <header
      class="settings-window-titlebar"
      role="toolbar"
      aria-label="设置窗口控制；方向键移动窗口"
      tabindex="0"
      title="拖动可移动窗口；聚焦后使用方向键也可移动"
      onpointerdown={(event) => beginInteraction(event, "drag")}
      onkeydown={moveWithKeyboard}
    >
      <div>
        <strong>设置</strong>
        <small>外观</small>
      </div>
      <div class="settings-window-actions">
        <button aria-label="窗口居中" title="窗口居中" onclick={centerWindow}>
          <Icon name="refresh" size={14} />
        </button>
        <button aria-label="切换窗口大小" title="切换小、中、最大尺寸" onclick={cycleWindowSize}>
          <Icon name="panel" size={14} />
        </button>
        <button aria-label="关闭设置" title="关闭设置" onclick={closeWindow}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>

    <div class="settings-window-body">
      <aside class="settings-window-navigation">
        <SettingsNavigation {shell} />
      </aside>
      <div class="settings-window-content">
        <SettingsPanel {settings} {shell} {ux} />
      </div>
    </div>

    <button
      class="settings-window-resize-handle"
      aria-label="调整设置窗口大小；方向键调整，按住 Shift 加速"
      title="拖动调整大小；聚焦后使用方向键调整"
      onpointerdown={(event) => beginInteraction(event, "resize")}
      onkeydown={resizeWithKeyboard}
    ><span aria-hidden="true"></span></button>
  </div>
</div>
