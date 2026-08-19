<script lang="ts">
  import { onMount } from "svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    templateStore: TemplateStore;
    close: () => void;
  }

  let { templateStore, close }: Props = $props();
  let input: HTMLInputElement;
  let query = $state("");
  let selectedIndex = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    input.focus();
    void templateStore.searchQuickly("");
    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  function search(value: string): void {
    query = value;
    selectedIndex = 0;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void templateStore.searchQuickly(value), 100);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = Math.min(templateStore.quickResults.length - 1, selectedIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = Math.max(0, selectedIndex - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = templateStore.quickResults[selectedIndex];
      if (selected) {
        void templateStore.insertTemplate(selected);
        close();
      }
    }
  }
</script>

<div class="quick-search-backdrop" role="presentation" onclick={close}>
  <div class="template-quick-search" role="dialog" aria-modal="true" aria-label="搜索模板" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
    <header>
      <Icon name="search" size={17} />
      <input
        bind:this={input}
        value={query}
        placeholder="搜索名称、触发词、别名或说明"
        aria-label="模板搜索内容"
        oninput={(event) => search(event.currentTarget.value)}
        onkeydown={onKeyDown}
      />
      <kbd>Ctrl Alt T</kbd>
    </header>
    <div class="quick-result-list" role="listbox" aria-label="模板搜索结果">
      {#each templateStore.quickResults as template, index (template.id)}
        <button
          class:active={index === selectedIndex}
          role="option"
          aria-selected={index === selectedIndex}
          onmouseenter={() => (selectedIndex = index)}
          onclick={() => { void templateStore.insertTemplate(template); close(); }}
        >
          <span class="quick-result-icon">{template.favorite ? "★" : "{}"}</span>
          <span><strong>{template.name}</strong><small>{template.trigger || template.aliases.join(" · ") || template.description}</small></span>
          <em>使用 {template.useCount} 次</em>
        </button>
      {/each}
      {#if templateStore.quickResults.length === 0}
        <div class="quick-search-empty">没有匹配的代码片段</div>
      {/if}
    </div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 插入</span><span><kbd>Esc</kbd> 关闭</span></footer>
  </div>
</div>
