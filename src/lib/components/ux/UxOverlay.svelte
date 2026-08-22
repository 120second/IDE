<script lang="ts">
  import { tick } from "svelte";
  import type { UxStore } from "../../stores/ux.svelte";

  interface Props { ux: UxStore }
  let { ux }: Props = $props();
  let dialog = $state<HTMLDivElement>();
  let cancelButton = $state<HTMLButtonElement>();
  let previousFocus: HTMLElement | null = null;
  let previousConfirmationId: number | undefined;

  $effect(() => {
    const id = ux.confirmation?.id;
    if (id && id !== previousConfirmationId) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousConfirmationId = id;
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
  <div class="dialog-backdrop confirmation-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) ux.cancelConfirmation(); }}>
    <div
      class="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-message"
      tabindex="-1"
      bind:this={dialog}
      onkeydown={handleDialogKey}
    >
      <h3 id="confirmation-title">{ux.confirmation.title}</h3>
      <p id="confirmation-message">{ux.confirmation.message}</p>
      <div class="confirmation-actions">
        <button class="secondary-button" bind:this={cancelButton} onclick={() => ux.cancelConfirmation()}>取消</button>
        <button class:danger-button={ux.confirmation.danger} class:primary-button={!ux.confirmation.danger} onclick={() => ux.acceptConfirmation()}>{ux.confirmation.confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
