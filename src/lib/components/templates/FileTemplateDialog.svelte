<script lang="ts">
  import { onMount } from "svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    parent: string;
    templateStore: TemplateStore;
    fileWorkspace: WorkspaceStore;
    close: () => void;
  }

  let { parent, templateStore, fileWorkspace, close }: Props = $props();
  let nameInput: HTMLInputElement;
  let name = $state("solution.cpp");
  let selectedId = $state<number>();
  let creating = $state(false);

  onMount(() => {
    const preferred = templateStore.fileTemplates.find((template) => template.name === "Contest C++")
      ?? templateStore.fileTemplates[0];
    selectedId = preferred?.id;
    nameInput.focus();
  });

  async function submit(): Promise<void> {
    const fileName = name.trim();
    if (!fileName || creating) return;
    creating = true;
    let code = "";
    if (selectedId) {
      const materialized = await templateStore.materializeFileTemplate(selectedId);
      if (materialized === undefined) {
        creating = false;
        return;
      }
      code = materialized;
    }
    const created = await fileWorkspace.create(parent, fileName, "file", code);
    creating = false;
    if (created) close();
  }

  function displayName(value: string): string {
    if (value === "Empty C++") return "空白 C++";
    if (value === "Contest C++") return "竞赛 C++";
    if (value === "Multi Test C++") return "多组测试 C++";
    return value;
  }

  function displayDescription(value: string): string {
    if (value === "An empty C++ source file.") return "创建一个空白的 C++ 源文件。";
    if (value === "Single-test competitive programming entry point.") return "适用于单组测试的竞赛程序入口。";
    if (value === "Competitive programming entry point with multiple test cases.") return "适用于多组测试的竞赛程序入口。";
    return value;
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={close}>
  <div class="file-template-dialog" role="dialog" aria-modal="true" aria-label="从模板新建文件" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
    <header><div><strong>新建 C++ 文件</strong><span>选择文件模板</span></div><button aria-label="关闭" onclick={close}><Icon name="close" size={14} /></button></header>
    <label><span>文件名</span><input bind:this={nameInput} bind:value={name} onkeydown={(event) => { if (event.key === "Enter") void submit(); }} /></label>
    <div class="file-template-options" role="radiogroup" aria-label="文件模板">
      {#each templateStore.fileTemplates as template (template.id)}
        <button class:active={selectedId === template.id} role="radio" aria-checked={selectedId === template.id} onclick={() => (selectedId = template.id)}>
          <span class="file-template-icon">C++</span>
          <span><strong>{displayName(template.name)}</strong><small>{displayDescription(template.description)}</small></span>
        </button>
      {/each}
      {#if templateStore.fileTemplates.length === 0}
        <button class="active" role="radio" aria-checked="true"><span class="file-template-icon">C++</span><span><strong>空白 C++</strong><small>创建一个空白源文件。</small></span></button>
      {/if}
    </div>
    <footer><button class="secondary-button" onclick={close}>取消</button><button class="primary-button" disabled={!name.trim() || creating} onclick={() => void submit()}>{creating ? "正在创建…" : "创建"}</button></footer>
  </div>
</div>
