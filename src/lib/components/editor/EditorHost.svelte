<script lang="ts">
  import { onMount } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";

  interface Props {
    workspace: EditorWorkspace;
    saveAsSnippet: (code: string) => void;
  }

  let { workspace, saveAsSnippet }: Props = $props();
  let host: HTMLDivElement;
  let menu = $state<{ x: number; y: number; code: string }>();

  onMount(() => {
    workspace.attach(host);
    return () => workspace.detach();
  });

  function openMenu(event: MouseEvent): void {
    const code = workspace.getSelectedText();
    if (!code) return;
    event.preventDefault();
    menu = {
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 55),
      code,
    };
  }
</script>

<svelte:window onclick={() => (menu = undefined)} onblur={() => (menu = undefined)} />

<div class="editor-host" role="application" aria-label="代码编辑器" bind:this={host} oncontextmenu={openMenu}></div>

{#if menu}
  <div class="context-menu editor-context-menu" role="menu" tabindex="-1" style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
    <button role="menuitem" onclick={() => { saveAsSnippet(menu!.code); menu = undefined; }}>保存为代码片段</button>
  </div>
{/if}
