<script lang="ts">
  import type { DebugStore } from "../../stores/debug.svelte";
  import type { DebugVariable, DebugVariablePage } from "../../types/debug";

  interface Props {
    debug: DebugStore;
    variables: DebugVariable[];
  }

  interface ExpandedVariable {
    loading: boolean;
    page?: DebugVariablePage;
    error: string;
  }

  let { debug, variables }: Props = $props();
  let expanded = $state.raw<Record<string, ExpandedVariable>>({});

  const keyOf = (variable: DebugVariable) => variable.variableObject ?? variable.expression;

  async function toggle(variable: DebugVariable): Promise<void> {
    const key = keyOf(variable);
    if (expanded[key]?.page) {
      const next = { ...expanded };
      delete next[key];
      expanded = next;
      return;
    }
    expanded = { ...expanded, [key]: { loading: true, error: "" } };
    const page = await debug.fetchChildren(variable);
    expanded = {
      ...expanded,
      [key]: page
        ? { loading: false, page, error: "" }
        : { loading: false, error: "无法读取子变量。" },
    };
  }

  async function loadMore(variable: DebugVariable, current: DebugVariablePage): Promise<void> {
    const key = keyOf(variable);
    expanded = { ...expanded, [key]: { loading: true, page: current, error: "" } };
    const next = await debug.fetchChildren(
      { ...variable, variableObject: current.variableObject },
      current.from + current.children.length,
    );
    if (!next) {
      expanded = { ...expanded, [key]: { loading: false, page: current, error: "无法读取下一页。" } };
      return;
    }
    expanded = {
      ...expanded,
      [key]: {
        loading: false,
        error: "",
        page: { ...next, from: current.from, children: [...current.children, ...next.children] },
      },
    };
  }
</script>

{#snippet row(variable: DebugVariable, depth: number)}
  {@const entry = expanded[keyOf(variable)]}
  <div class="debug-variable-row" style:padding-left={`${8 + depth * 13}px`}>
    {#if variable.hasChildren}
      <button class="debug-tree-toggle" aria-label={entry?.page ? "折叠变量" : "展开变量"} onclick={() => void toggle(variable)}>
        {entry?.loading && !entry.page ? "·" : entry?.page ? "▾" : "▸"}
      </button>
    {:else}
      <span class="debug-tree-spacer"></span>
    {/if}
    <span class="debug-variable-name" title={variable.expression}>{variable.name}</span>
    <span class="debug-variable-value" title={variable.value || variable.typeName}>
      {variable.value || (variable.hasChildren ? `{${variable.numChildren ? ` ${variable.numChildren} 项 ` : "…"}}` : "<不可用>")}
    </span>
  </div>
  {#if entry?.page}
    {#each entry.page.children as child (`${keyOf(variable)}-${child.variableObject ?? child.expression}`)}
      {@render row(child, depth + 1)}
    {/each}
    {#if entry.page.hasMore}
      <button
        class="debug-load-more"
        style:padding-left={`${25 + depth * 13}px`}
        disabled={entry.loading}
        onclick={() => void loadMore(variable, entry.page!)}
      >{entry.loading ? "正在读取…" : `再读取最多 100 项（共 ${entry.page.total} 项）`}</button>
    {/if}
  {/if}
  {#if entry?.error}<div class="debug-inline-error" style:padding-left={`${25 + depth * 13}px`}>{entry.error}</div>{/if}
{/snippet}

<div class="debug-variable-tree">
  {#each variables as variable (variable.expression)}
    {@render row(variable, 0)}
  {/each}
</div>
