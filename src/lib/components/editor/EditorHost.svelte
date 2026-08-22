<script lang="ts">
  import { onMount } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import ContextMenu from "../ux/ContextMenu.svelte";

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
    event.preventDefault();
    menu = {
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 180),
      code,
    };
  }
</script>

<svelte:window onclick={() => (menu = undefined)} onblur={() => (menu = undefined)} />

<div class="editor-host" role="application" aria-label="代码编辑器" bind:this={host} oncontextmenu={openMenu}></div>

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    close={() => (menu = undefined)}
    items={[
      { label: "保存", action: () => void workspace.saveActive() },
      { label: "保存为代码片段", disabled: !menu.code, action: () => saveAsSnippet(menu!.code) },
      { label: "转到定义", separatorBefore: true, action: () => void workspace.goToDefinition() },
      { label: "查找引用", action: () => void workspace.findReferences() },
      { label: "参数提示", action: () => void workspace.requestSignatureHelp() },
    ]}
  />
{/if}
