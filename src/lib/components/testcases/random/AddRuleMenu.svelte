<script lang="ts">
  export type AddRuleKind = "integer" | "array" | "string" | "permutation" | "repeat" | "tree" | "graph" | "matrix";

  interface Props {
    depth: number;
    add: (kind: AddRuleKind) => void;
    compact?: boolean;
    label?: string;
  }

  let { depth, add, compact = false, label }: Props = $props();
  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();
  let placement = $state({ left: 8, top: 8, width: 224, maxHeight: 360 });

  function placePopover(): void {
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const desiredHeight = 360;
    const width = Math.min(236, Math.max(180, window.innerWidth - margin * 2));
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const below = window.innerHeight - rect.bottom - margin - gap;
    const above = rect.top - margin - gap;
    const openAbove = below < Math.min(desiredHeight, 240) && above > below;
    const maxHeight = Math.max(120, openAbove ? above : below);
    const top = openAbove
      ? Math.max(margin, rect.top - Math.min(desiredHeight, maxHeight) - gap)
      : rect.bottom + gap;
    placement = { left, top, width, maxHeight };
  }

  function toggle(): void {
    if (open) {
      close();
      return;
    }
    placePopover();
    open = true;
    requestAnimationFrame(placePopover);
  }

  function close(restoreFocus = false): void {
    if (!open) return;
    open = false;
    if (restoreFocus) requestAnimationFrame(() => trigger?.focus());
  }

  function choose(kind: AddRuleKind): void {
    open = false;
    add(kind);
  }

  function focusItem(direction: 1 | -1, from?: HTMLElement): void {
    const items = Array.from(popover?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (items.length === 0) return;
    const current = from ? items.indexOf(from as HTMLButtonElement) : -1;
    const next = current < 0
      ? (direction === 1 ? 0 : items.length - 1)
      : (current + direction + items.length) % items.length;
    items[next]?.focus();
  }

  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!open) {
      placePopover();
      open = true;
      requestAnimationFrame(() => {
        placePopover();
        requestAnimationFrame(() => focusItem(event.key === "ArrowDown" ? 1 : -1));
      });
      return;
    }
    focusItem(event.key === "ArrowDown" ? 1 : -1);
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(event.key === "ArrowDown" ? 1 : -1, event.target as HTMLElement);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = Array.from(popover?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  }

  function handleOutsidePointer(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node) || root?.contains(target)) return;
    close();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (open && event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  }
</script>

<svelte:window onpointerdown={handleOutsidePointer} onkeydown={handleWindowKeydown} onresize={() => open && placePopover()} />

<div class="add-rule-menu" bind:this={root}>
  <button
    type="button"
    class:compact
    class="secondary-button"
    bind:this={trigger}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}
    onkeydown={handleTriggerKeydown}
  >＋ {label ?? (compact ? "添加输入" : "添加规则")}</button>
  {#if open}
    <div
      class="add-rule-popover"
      role="menu"
      aria-label="添加生成规则"
      tabindex="-1"
      bind:this={popover}
      style={`left: ${placement.left}px; top: ${placement.top}px; width: ${placement.width}px; max-height: ${placement.maxHeight}px;`}
      onkeydown={handleMenuKeydown}
    >
      <button type="button" role="menuitem" onclick={() => choose("integer")}><strong>整数</strong><span>一个新的标量输入行</span></button>
      <button type="button" role="menuitem" onclick={() => choose("array")}><strong>数组</strong><span>独占一行的整数数组</span></button>
      <button type="button" role="menuitem" onclick={() => choose("string")}><strong>字符串</strong><span>二进制串或小写串</span></button>
      <button type="button" role="menuitem" onclick={() => choose("permutation")}><strong>排列</strong><span>1 到 n 的随机排列</span></button>
      <button type="button" role="menuitem" onclick={() => choose("repeat")} disabled={depth >= 4}><strong>重复块</strong><span>{depth >= 4 ? "已达到 4 层限制" : "按变量或常量重复"}</span></button>
      <button type="button" role="menuitem" onclick={() => choose("tree")}><strong>树</strong><span>无权或带权树</span></button>
      <button type="button" role="menuitem" onclick={() => choose("graph")}><strong>图</strong><span>简单图、连通图或有向无环图</span></button>
      <button type="button" role="menuitem" onclick={() => choose("matrix")}><strong>矩阵</strong><span>多行定长整数</span></button>
    </div>
  {/if}
</div>
