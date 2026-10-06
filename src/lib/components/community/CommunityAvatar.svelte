<script lang="ts">
  interface Props {
    username: string;
    displayName?: string;
    avatarDataUrl?: string;
    size?: "small" | "medium" | "large";
  }

  let { username, displayName = "", avatarDataUrl = "", size = "medium" }: Props = $props();
  let initial = $derived((displayName || username || "L").trim().slice(0, 1).toUpperCase());
  let label = $derived(displayName || username);
</script>

<span class:small={size === "small"} class:large={size === "large"} class="community-avatar">
  {#if avatarDataUrl}
    <img src={avatarDataUrl} alt={`${label}的头像`} />
  {:else}
    <span aria-hidden="true">{initial}</span>
  {/if}
</span>
