<script lang="ts">
  export type IconName =
    | "explorer"
    | "testcases"
    | "search"
    | "templates"
    | "debug"
    | "judge"
    | "settings"
    | "close"
    | "plus"
    | "panel"
    | "zen"
    | "file"
    | "folder"
    | "cpp"
    | "check"
    | "terminal"
    | "warning"
    | "database"
    | "command"
    | "chevron-right"
    | "folder-plus"
    | "refresh";

  interface Props {
    name: IconName;
    size?: number;
  }

  let { name, size = 18 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "explorer"}
    <path d="M4 3.5h6l2 2H20v15H4z" /><path d="M4 8h16" />
  {:else if name === "testcases"}
    <rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="m8 9 1.6 1.6L13 7.5M8 15h8" />
  {:else if name === "search"}
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" />
  {:else if name === "templates"}
    <path d="M5 3.5h10l4 4v13H5z" /><path d="M14.5 3.5V8H19M8 12h8M8 16h5" />
  {:else if name === "debug"}
    <path d="M8 9h8M9 5l1.5 2M15 5l-1.5 2M7 13H4M20 13h-3M8 17l-2 2M16 17l2 2" />
    <rect x="7" y="7" width="10" height="12" rx="5" />
  {:else if name === "judge"}
    <path d="M12 3v17M6 6h12M6 6l-3 6h6zM18 6l-3 6h6zM7 21h10" />
  {:else if name === "settings"}
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1z" />
  {:else if name === "close"}
    <path d="m6 6 12 12M18 6 6 18" />
  {:else if name === "plus"}
    <path d="M12 5v14M5 12h14" />
  {:else if name === "panel"}
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 14h18" />
  {:else if name === "zen"}
    <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
  {:else if name === "file"}
    <path d="M6 3.5h8l4 4v13H6zM14 3.5V8h4" />
  {:else if name === "folder"}
    <path d="M3.5 5.5h6l2 2h9v11h-17z" />
  {:else if name === "cpp"}
    <path d="M8.5 7.5a5 5 0 1 0 0 9M14 9v6M11 12h6M20 9v6M17 12h6" />
  {:else if name === "check"}
    <path d="m5 12 4 4L19 6" />
  {:else if name === "terminal"}
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 16h4" />
  {:else if name === "warning"}
    <path d="M12 3 2.5 20h19zM12 9v4M12 17h.01" />
  {:else if name === "database"}
    <ellipse cx="12" cy="5.5" rx="7" ry="3" /><path d="M5 5.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6M5 11.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  {:else if name === "command"}
    <path d="M9 6H6a3 3 0 1 0 3 3zm0 0v12H6a3 3 0 1 1 3-3M15 6h3a3 3 0 1 1-3 3zm0 0v12h3a3 3 0 1 0-3-3" />
  {:else if name === "chevron-right"}
    <path d="m9 5 7 7-7 7" />
  {:else if name === "folder-plus"}
    <path d="M3.5 6h6l2 2h9v10.5h-17zM15.5 11v5M13 13.5h5" />
  {:else if name === "refresh"}
    <path d="M19 7v5h-5M5 17v-5h5M18 12a6.5 6.5 0 0 0-11-4.5L5 10M6 12a6.5 6.5 0 0 0 11 4.5l2-2.5" />
  {/if}
</svg>
