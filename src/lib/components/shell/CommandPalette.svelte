<script lang="ts">
  import { onMount } from "svelte";
  import { rankWorkbenchCommands, type WorkbenchCommand } from "../../types/commands";
  import Icon from "./Icon.svelte";

  interface Props {
    commands: WorkbenchCommand[];
    shortcut: string;
    close: () => void;
  }

  let { commands, shortcut, close }: Props = $props();
  let input: HTMLInputElement;
  let list: HTMLDivElement;
  let query = $state("");
  let selectedIndex = $state(0);
  let filtered = $derived.by(() => rankWorkbenchCommands(commands, query).slice(0, 80));

  onMount(() => input.focus());

  function choose(command?: WorkbenchCommand): void {
    if (!command || command.enabled === false) return;
    close();
    queueMicrotask(command.run);
  }

  function moveSelection(next: number): void {
    if (filtered.length === 0) return;
    const direction = next >= selectedIndex ? 1 : -1;
    let candidate = (next + filtered.length) % filtered.length;
    for (let visited = 0; visited < filtered.length; visited += 1) {
      if (filtered[candidate].enabled !== false) {
        selectedIndex = candidate;
        break;
      }
      candidate = (candidate + direction + filtered.length) % filtered.length;
    }
    queueMicrotask(() => list.querySelector<HTMLElement>(`button:nth-child(${selectedIndex + 1})`)?.scrollIntoView({ block: "nearest" }));
  }

  function onInput(value: string): void {
    query = value;
    selectedIndex = Math.max(0, filtered.findIndex((command) => command.enabled !== false));
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
      choose(filtered[selectedIndex]);
    }
  }

</script>

<div class="quick-search-backdrop" role="presentation" onclick={close}>
  <div class="template-quick-search command-palette" role="dialog" aria-modal="true" aria-label="命令面板" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
    <header>
      <Icon name="search" size={17} />
      <input
        bind:this={input}
        value={query}
        placeholder="输入命令名称"
        aria-label="要执行的命令"
        oninput={(event) => onInput(event.currentTarget.value)}
        onkeydown={onKeyDown}
      />
      <kbd>{shortcut.replaceAll("+", " ")}</kbd>
    </header>
    <div class="quick-result-list" role="listbox" aria-label="命令搜索结果" bind:this={list}>
      {#each filtered as command, index (command.id)}
        <button
          class:active={index === selectedIndex}
          role="option"
          aria-selected={index === selectedIndex}
          aria-disabled={command.enabled === false}
          disabled={command.enabled === false}
          onmouseenter={() => (selectedIndex = index)}
          onclick={() => choose(command)}
        >
          <span class="quick-result-icon"><Icon name="command" size={14} /></span>
          <span><strong>{command.label}</strong><small>{command.category}{command.disabledReason ? ` · ${command.disabledReason}` : ""}</small></span>
          {#if command.shortcut}<kbd>{command.shortcut.replaceAll("+", " ")}</kbd>{/if}
        </button>
      {/each}
      {#if filtered.length === 0}<div class="quick-search-empty">没有匹配的命令</div>{/if}
    </div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 执行</span><span><kbd>Esc</kbd> 关闭</span></footer>
  </div>
</div>
