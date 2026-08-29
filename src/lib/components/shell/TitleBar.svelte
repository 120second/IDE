<script lang="ts">
  import { isTauri } from "@tauri-apps/api/core";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";

  const appWindow = isTauri() ? getCurrentWindow() : undefined;
  let maximized = $state(false);
  let focused = $state(true);

  onMount(() => {
    if (!appWindow) return;

    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    void refreshMaximized();
    void appWindow.isFocused()
      .then((value) => {
        if (!disposed) focused = value;
      })
      .catch(reportWindowError);

    void Promise.all([
      appWindow.onResized(() => void refreshMaximized()),
      appWindow.onFocusChanged(({ payload }) => {
        if (!disposed) focused = payload;
      }),
    ])
      .then((listeners) => {
        if (disposed) listeners.forEach((unlisten) => unlisten());
        else unlisteners.push(...listeners);
      })
      .catch(reportWindowError);

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  });

  async function refreshMaximized(): Promise<void> {
    if (!appWindow) return;
    try {
      maximized = await appWindow.isMaximized();
    } catch (error) {
      reportWindowError(error);
    }
  }

  async function minimize(): Promise<void> {
    if (!appWindow) return;
    try {
      await appWindow.minimize();
    } catch (error) {
      reportWindowError(error);
    }
  }

  async function toggleMaximize(): Promise<void> {
    if (!appWindow) return;
    try {
      await appWindow.toggleMaximize();
      maximized = await appWindow.isMaximized();
    } catch (error) {
      reportWindowError(error);
    }
  }

  async function close(): Promise<void> {
    if (!appWindow) return;
    try {
      await appWindow.close();
    } catch (error) {
      reportWindowError(error);
    }
  }

  function handleDoubleClick(event: MouseEvent): void {
    if ((event.target as Element).closest("button")) return;
    void toggleMaximize();
  }

  function reportWindowError(error: unknown): void {
    console.error("Window control failed", error);
  }
</script>

{#if appWindow}
  <header
    class:focused
    class="window-titlebar"
    data-tauri-drag-region
    role="toolbar"
    aria-label="LightCP 窗口控制"
    tabindex="-1"
    ondblclick={handleDoubleClick}
  >
    <div class="window-titlebar-brand" data-tauri-drag-region>
      <span class="window-titlebar-mark" data-tauri-drag-region aria-hidden="true">L</span>
      <span class="window-titlebar-title" data-tauri-drag-region>LightCP</span>
    </div>

    <div class="window-titlebar-controls" aria-label="窗口控制">
      <button type="button" aria-label="最小化窗口" title="最小化" onclick={() => void minimize()}>
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2 6.5h8" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? "还原窗口" : "最大化窗口"}
        title={maximized ? "还原" : "最大化"}
        onclick={() => void toggleMaximize()}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          {#if maximized}
            <path d="M3.5 3.5V2h6.5v6.5H8.5M2 3.5h6.5V10H2z" />
          {:else}
            <rect x="2" y="2" width="8" height="8" />
          {/if}
        </svg>
      </button>
      <button class="window-titlebar-close" type="button" aria-label="关闭窗口" title="关闭" onclick={() => void close()}>
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="m2.5 2.5 7 7m0-7-7 7" />
        </svg>
      </button>
    </div>
  </header>
{/if}
