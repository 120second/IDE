<script lang="ts">
  import { onMount } from "svelte";
  import { findWorkspaceFiles } from "../../api/workspace";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { WorkspaceFileMatch, WorkspaceFileResponse } from "../../types/workspace";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    workspace: EditorWorkspace;
    shortcut: string;
    close: () => void;
  }

  let { workspace, shortcut, close }: Props = $props();
  let input: HTMLInputElement;
  let list: HTMLDivElement;
  let query = $state("");
  let selectedIndex = $state(0);
  let response = $state<WorkspaceFileResponse>();
  let loading = $state(false);
  let error = $state("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  onMount(() => {
    input.focus();
    void searchNow();
    return () => {
      if (timer) clearTimeout(timer);
      requestId += 1;
    };
  });

  function schedule(value: string): void {
    query = value;
    selectedIndex = 0;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void searchNow(), 100);
  }

  async function searchNow(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const current = ++requestId;
    loading = true;
    error = "";
    try {
      const result = await findWorkspaceFiles(query);
      if (current !== requestId) return;
      response = result;
      selectedIndex = Math.min(selectedIndex, Math.max(0, result.results.length - 1));
    } catch (reason) {
      if (current !== requestId) return;
      response = undefined;
      error = errorMessage(reason);
    } finally {
      if (current === requestId) loading = false;
    }
  }

  function moveSelection(next: number): void {
    const length = response?.results.length ?? 0;
    if (length === 0) return;
    selectedIndex = (next + length) % length;
    queueMicrotask(() => list.querySelector<HTMLElement>(`button:nth-child(${selectedIndex + 1})`)?.scrollIntoView({ block: "nearest" }));
  }

  function open(match?: WorkspaceFileMatch): void {
    if (!match) return;
    void workspace.openFile(match.path);
    close();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(selectedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(selectedIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(response?.results[selectedIndex]);
    }
  }

  function fileName(path: string): string {
    return path.split(/[\\/]/).at(-1) ?? path;
  }

  function errorMessage(reason: unknown): string {
    if (typeof reason === "object" && reason) {
      const commandError = reason as { userMessage?: unknown; technicalMessage?: unknown };
      if (typeof commandError.userMessage === "string") return commandError.userMessage;
      if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
    }
    return reason instanceof Error ? reason.message : String(reason);
  }
</script>

<div class="quick-search-backdrop" role="presentation" onclick={close}>
  <div class="template-quick-search file-quick-open" role="dialog" aria-modal="true" aria-label="快速打开文件" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
    <header>
      <Icon name="search" size={17} />
      <input
        bind:this={input}
        value={query}
        placeholder="输入文件名或路径"
        aria-label="要打开的文件"
        oninput={(event) => schedule(event.currentTarget.value)}
        onkeydown={onKeyDown}
      />
      {#if loading}<span class="tab-loading" aria-label="正在查找文件"></span>{/if}
      <kbd>{shortcut.replaceAll("+", " ")}</kbd>
    </header>
    <div class="quick-result-list" role="listbox" aria-label="文件搜索结果" bind:this={list}>
      {#each response?.results ?? [] as match, index (match.path)}
        <button
          class:active={index === selectedIndex}
          role="option"
          aria-selected={index === selectedIndex}
          onmouseenter={() => (selectedIndex = index)}
          onclick={() => open(match)}
        >
          <span class="quick-result-icon"><Icon name="file" size={15} /></span>
          <span><strong>{fileName(match.relativePath)}</strong><small>{match.relativePath}</small></span>
        </button>
      {/each}
      {#if error}
        <div class="quick-search-empty error" role="alert">{error}</div>
      {:else if !loading && response?.results.length === 0}
        <div class="quick-search-empty">没有匹配的文件</div>
      {/if}
    </div>
    <footer>
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span>
      {#if response}<span class="quick-file-stats">扫描 {response.filesScanned} 个文件 · {response.durationMs}ms{response.limitHit ? " · 结果已截断" : ""}</span>{/if}
    </footer>
  </div>
</div>
