<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { searchWorkspace } from "../../api/workspace";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import type { WorkspaceSearchMatch, WorkspaceSearchResponse } from "../../types/workspace";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    fileWorkspace: WorkspaceStore;
    editor: EditorWorkspace;
  }

  interface SearchGroup {
    path: string;
    relativePath: string;
    matches: WorkspaceSearchMatch[];
  }

  let { fileWorkspace, editor }: Props = $props();
  let input: HTMLInputElement;
  let query = $state("");
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let loading = $state(false);
  let error = $state("");
  let response = $state<WorkspaceSearchResponse>();
  let groups = $derived(groupResults(response?.results ?? []));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  $effect(() => {
    fileWorkspace.info?.path;
    query = "";
    response = undefined;
    error = "";
    loading = false;
    requestId += 1;
  });

  onMount(() => {
    const focus = () => input?.focus();
    window.addEventListener("lightcp-focus-search", focus);
    queueMicrotask(focus);
    return () => window.removeEventListener("lightcp-focus-search", focus);
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
    requestId += 1;
  });

  function scheduleSearch(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runSearch(), 240);
  }

  async function runSearch(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const text = query.trim();
    const current = ++requestId;
    error = "";
    if (!fileWorkspace.info || !text) {
      response = undefined;
      loading = false;
      return;
    }
    loading = true;
    try {
      const result = await searchWorkspace(text, caseSensitive, wholeWord);
      if (current !== requestId) return;
      response = result;
    } catch (reason) {
      if (current !== requestId) return;
      response = undefined;
      error = errorMessage(reason);
    } finally {
      if (current === requestId) loading = false;
    }
  }

  function toggleCase(): void {
    caseSensitive = !caseSensitive;
    void runSearch();
  }

  function toggleWholeWord(): void {
    wholeWord = !wholeWord;
    void runSearch();
  }

  function groupResults(results: readonly WorkspaceSearchMatch[]): SearchGroup[] {
    const byPath = new Map<string, SearchGroup>();
    for (const match of results) {
      let group = byPath.get(match.path);
      if (!group) {
        group = { path: match.path, relativePath: match.relativePath, matches: [] };
        byPath.set(match.path, group);
      }
      group.matches.push(match);
    }
    return [...byPath.values()];
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

<section class="workspace-search" aria-label="工作区搜索">
  <div class="search-box workspace-search-box">
    <Icon name="search" size={15} />
    <input
      bind:this={input}
      bind:value={query}
      aria-label="搜索工作区"
      placeholder="搜索工作区"
      oninput={scheduleSearch}
      onkeydown={(event) => {
        if (event.key === "Enter") void runSearch();
        if (event.key === "Escape") {
          query = "";
          response = undefined;
          error = "";
        }
      }}
    />
    {#if loading}<span class="tab-loading" aria-label="正在搜索"></span>{/if}
    {#if query}
      <button class="search-clear" aria-label="清除搜索" title="清除" onclick={() => { query = ""; response = undefined; error = ""; input.focus(); }}>×</button>
    {/if}
    <button
      class:active={caseSensitive}
      class="search-case-toggle"
      aria-label="区分大小写"
      aria-pressed={caseSensitive}
      title="区分大小写"
      onclick={toggleCase}
    >Aa</button>
    <button
      class:active={wholeWord}
      class="search-word-toggle"
      aria-label="全字匹配"
      aria-pressed={wholeWord}
      title="全字匹配"
      onclick={toggleWholeWord}
    >ab</button>
  </div>

  {#if !fileWorkspace.info}
    <div class="empty-state"><Icon name="folder" size={26} /><p>尚未打开文件夹</p><span>打开工作区后即可跨文件搜索。</span></div>
  {:else if error}
    <div class="workspace-search-message error" role="alert"><Icon name="warning" size={15} /><span>{error}</span></div>
  {:else if !query.trim()}
    <div class="empty-state"><Icon name="search" size={26} /><p>在文件中搜索</p><span>可切换大小写和全字匹配；默认忽略常见构建目录。</span></div>
  {:else if response && response.results.length === 0}
    <div class="empty-state"><Icon name="search" size={26} /><p>未找到结果</p><span>已检查 {response.filesScanned} 个文件。</span></div>
  {:else if response}
    <div class="workspace-search-summary" role="status">
      <span>{response.results.length} 个结果 · {groups.length} 个文件</span>
      <small>{response.filesScanned} 个文件 · {response.durationMs}ms{response.limitHit ? " · 已达到结果上限" : ""}</small>
    </div>
    <div class="workspace-search-results">
      {#each groups as group (group.path)}
        <section class="workspace-search-group">
          <header title={group.path}>
            <Icon name="file" size={13} />
            <strong>{group.relativePath}</strong>
            <span>{group.matches.length}</span>
          </header>
          {#each group.matches as match, index (`${match.line}:${match.column}:${index}`)}
            <button
              title={`${match.relativePath}:${match.line}:${match.column}`}
              onclick={() => void editor.openSearchMatch(match.path, match.line, match.column)}
            >
              <span class="workspace-search-location">{match.line}:{match.column}</span>
              <code>{match.preview || "（空行）"}</code>
            </button>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</section>
