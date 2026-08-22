<script lang="ts">
  import { onMount, tick } from "svelte";

  interface MenuItem {
    label: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
  }

  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    close: () => void;
  }

  let { x, y, items, close }: Props = $props();
  let menu: HTMLDivElement;

  onMount(() => {
    void tick().then(() => menu.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus());
  });

  function handleKey(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key === "Tab") {
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    if (buttons.length === 0) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowDown" ? (current + 1) % buttons.length
      : (current - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  }
</script>

<div
  class="context-menu"
  role="menu"
  aria-label="上下文菜单"
  style:left={`${x}px`}
  style:top={`${y}px`}
  bind:this={menu}
  tabindex="-1"
  onkeydown={handleKey}
>
  {#each items as item}
    {#if item.separatorBefore}<span class="menu-separator" role="separator"></span>{/if}
    <button
      class:danger={item.danger}
      role="menuitem"
      disabled={item.disabled}
      onclick={() => { item.action(); close(); }}
    >{item.label}</button>
  {/each}
</div>
