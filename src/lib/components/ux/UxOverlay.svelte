<script lang="ts">
  import { tick } from "svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props { ux: UxStore }
  let { ux }: Props = $props();
  let dialog = $state<HTMLDivElement>();
  let cancelButton = $state<HTMLButtonElement>();
  let previousFocus: HTMLElement | null = null;
  let previousConfirmationId: number | undefined;
  let dragX = $state(0);
  let dragY = $state(0);

  interface DragState {
    pointerId: number;
    pointerX: number;
    pointerY: number;
    dialogLeft: number;
    dialogTop: number;
    dialogWidth: number;
    dialogHeight: number;
    offsetX: number;
    offsetY: number;
  }

  let dragState = $state<DragState>();

  $effect(() => {
    const id = ux.confirmation?.id;
    if (id && id !== previousConfirmationId) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousConfirmationId = id;
      dragX = 0;
      dragY = 0;
      dragState = undefined;
      void tick().then(() => cancelButton?.focus());
    } else if (!id && previousConfirmationId) {
      previousConfirmationId = undefined;
      previousFocus?.focus();
      previousFocus = null;
    }
  });

  function handleDialogKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      ux.cancelConfirmation();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function beginDrag(event: PointerEvent): void {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
    event.preventDefault();
    if (!dialog) return;
    const bounds = dialog.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      dialogLeft: bounds.left,
      dialogTop: bounds.top,
      dialogWidth: bounds.width,
      dialogHeight: bounds.height,
      offsetX: dragX,
      offsetY: dragY,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function drag(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const margin = 8;
    const desiredLeft = dragState.dialogLeft + event.clientX - dragState.pointerX;
    const desiredTop = dragState.dialogTop + event.clientY - dragState.pointerY;
    const maxLeft = Math.max(margin, window.innerWidth - dragState.dialogWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - dragState.dialogHeight - margin);
    const left = Math.max(margin, Math.min(desiredLeft, maxLeft));
    const top = Math.max(margin, Math.min(desiredTop, maxTop));
    dragX = dragState.offsetX + left - dragState.dialogLeft;
    dragY = dragState.offsetY + top - dragState.dialogTop;
  }

  function endDrag(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    dragState = undefined;
  }
</script>

<div class="toast-region" aria-live="polite" aria-label="通知">
  {#each ux.toasts as toast (toast.id)}
    <div class:error={toast.kind === "error"} class:success={toast.kind === "success"} class="toast" role={toast.kind === "error" ? "alert" : "status"}>
      <span>{toast.message}</span>
      <button aria-label="关闭通知" onclick={() => ux.dismissToast(toast.id)}>×</button>
    </div>
  {/each}
</div>

{#if ux.confirmation}
  <div class="modal-backdrop confirmation-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) ux.cancelConfirmation(); }}>
    <div
      class="confirmation-dialog"
      class:dragging={Boolean(dragState)}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-message"
      tabindex="-1"
      style:transform={`translate3d(${dragX}px, ${dragY}px, 0)`}
      bind:this={dialog}
      onkeydown={handleDialogKey}
    >
      <header
        class="dialog-drag-handle"
        role="group"
        aria-label="确认对话框标题栏，可拖动"
        onpointerdown={beginDrag}
        onpointermove={drag}
        onpointerup={endDrag}
        onpointercancel={endDrag}
      >
        <div><strong id="confirmation-title">{ux.confirmation.title}</strong><span>请确认接下来的操作</span></div>
        <button aria-label="关闭" onclick={() => ux.cancelConfirmation()}><Icon name="close" size={14} /></button>
      </header>
      <div class="confirmation-content"><p id="confirmation-message">{ux.confirmation.message}</p></div>
      <footer class="confirmation-actions">
        <button class="secondary-button" bind:this={cancelButton} onclick={() => ux.cancelConfirmation()}>取消</button>
        {#if ux.confirmation.secondaryLabel}
          <button
            class:danger-button={ux.confirmation.secondaryDanger}
            class:secondary-button={!ux.confirmation.secondaryDanger}
            onclick={() => ux.acceptSecondaryConfirmation()}
          >{ux.confirmation.secondaryLabel}</button>
        {/if}
        <button class:danger-button={ux.confirmation.danger} class:primary-button={!ux.confirmation.danger} onclick={() => ux.acceptConfirmation()}>{ux.confirmation.confirmLabel}</button>
      </footer>
    </div>
  </div>
{/if}
