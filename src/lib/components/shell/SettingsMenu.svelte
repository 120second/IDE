<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { SettingsPage } from "../../stores/shell.svelte";
  import { fitAnchoredMenu } from "./menuPlacement";

  interface Props {
    anchor: HTMLButtonElement;
    commandShortcut: string;
    close: (restoreFocus?: boolean) => void;
    openCommandPalette: () => void;
    openSettings: (page: SettingsPage) => void;
    openSnippets: () => void;
    openTasks: () => void;
  }

  let {
    anchor,
    commandShortcut,
    close,
    openCommandPalette,
    openSettings,
    openSnippets,
    openTasks,
  }: Props = $props();
  let menu: HTMLDivElement;
  let menuX = $state(50);
  let menuY = $state(0);
  let menuMaxHeight = $state("calc(100vh - 12px)");
  let placed = $state(false);

  onMount(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.contains(target) && !anchor.contains(target)) close(false);
    };
    const closeOnBlur = () => close(false);
    const placeAndFocus = async () => {
      await tick();
      const margin = 6;
      const anchorBounds = anchor.getBoundingClientRect();
      const menuBounds = menu.getBoundingClientRect();
      const titlebarBottom = document.querySelector<HTMLElement>(".window-titlebar")
        ?.getBoundingClientRect().bottom ?? 0;
      const statusTop = document.querySelector<HTMLElement>(".status-bar")
        ?.getBoundingClientRect().top ?? window.innerHeight;
      const placement = fitAnchoredMenu({
        viewportWidth: window.innerWidth,
        anchorRight: anchorBounds.right,
        anchorBottom: anchorBounds.bottom,
        menuWidth: menuBounds.width,
        menuHeight: menu.scrollHeight,
        contentTop: Math.max(margin, titlebarBottom + margin),
        contentBottom: Math.min(window.innerHeight - margin, statusTop - margin),
        margin,
      });
      menuX = placement.left;
      menuY = placement.top;
      menuMaxHeight = `${placement.maxHeight}px`;
      placed = true;
      menu.querySelector<HTMLButtonElement>("[data-main-item]")?.focus();
    };
    void placeAndFocus();
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("resize", closeOnBlur);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("resize", closeOnBlur);
      window.removeEventListener("blur", closeOnBlur);
    };
  });

  function choose(action: () => void): void {
    close(false);
    queueMicrotask(action);
  }

  function moveFocus(event: KeyboardEvent): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.children]
      .filter((element): element is HTMLButtonElement => element instanceof HTMLButtonElement && !element.disabled);
    if (buttons.length === 0) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowDown" ? (current + 1) % buttons.length
      : (current - 1 + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
    buttons[next].scrollIntoView({ block: "nearest" });
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    moveFocus(event);
  }
</script>

<div
  class:placed
  class="settings-menu"
  role="menu"
  aria-label="管理与设置"
  tabindex="-1"
  style:left={`${menuX}px`}
  style:top={`${menuY}px`}
  style:max-height={menuMaxHeight}
  bind:this={menu}
  onkeydown={handleKey}
>
  <button data-main-item role="menuitem" onclick={() => choose(openCommandPalette)}>
    <span>命令面板…</span><kbd>{commandShortcut}</kbd>
  </button>

  <span class="settings-menu-separator" role="separator"></span>

  <button data-main-item role="menuitem" onclick={() => choose(() => openSettings("theme"))}>
    <span>设置</span><kbd>Ctrl+,</kbd>
  </button>

  <span class="settings-menu-separator" role="separator"></span>

  <button data-main-item role="menuitem" onclick={() => choose(openSnippets)}><span>代码片段</span></button>
  <button data-main-item role="menuitem" onclick={() => choose(openTasks)}><span>测试与任务</span></button>
</div>
