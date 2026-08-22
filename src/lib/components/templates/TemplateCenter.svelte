<script lang="ts">
  import { onMount } from "svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type { TemplateMetadata } from "../../types/templates";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    templateStore: TemplateStore;
  }

  let { templateStore }: Props = $props();
  let historyOpen = $state(false);
  const TEMPLATE_ROW_HEIGHT = 62;
  const TEMPLATE_OVERSCAN = 8;
  let listViewport: HTMLDivElement;
  let listScrollTop = $state(0);
  let listViewportHeight = $state(400);
  let draggedTemplateId = $state<number>();
  let dropTemplateId = $state<number>();
  let dropAfter = $state(false);
  let detailOpen = $derived(templateStore.detailLoading || templateStore.mode !== "empty");
  let templateStart = $derived(
    Math.max(0, Math.floor(listScrollTop / TEMPLATE_ROW_HEIGHT) - TEMPLATE_OVERSCAN),
  );
  let templateEnd = $derived(
    Math.min(
      templateStore.templates.length,
      Math.ceil((listScrollTop + listViewportHeight) / TEMPLATE_ROW_HEIGHT) + TEMPLATE_OVERSCAN,
    ),
  );
  let renderedTemplates = $derived(templateStore.templates.slice(templateStart, templateEnd));

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      listViewportHeight = entry.contentRect.height;
    });
    observer.observe(listViewport);
    return () => observer.disconnect();
  });

  function beginTemplateDrag(event: DragEvent, template: TemplateMetadata): void {
    draggedTemplateId = template.id;
    event.dataTransfer?.setData("application/x-lightcp-template", String(template.id));
    event.dataTransfer?.setData("text/plain", String(template.id));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.dropEffect = "move";
    }
  }

  function allowTemplateDrop(event: DragEvent, target: TemplateMetadata): void {
    if (
      templateStore.sort === "manual"
      && !templateStore.search
      && (draggedTemplateId || event.dataTransfer?.types.includes("application/x-lightcp-template"))
    ) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
      dropTemplateId = target.id;
      dropAfter = event.clientY >= bounds.top + bounds.height / 2;
    }
  }

  function dropTemplate(event: DragEvent, target: TemplateMetadata): void {
    if (templateStore.sort !== "manual" || templateStore.search) return;
    event.preventDefault();
    event.stopPropagation();
    const source = Number(
      event.dataTransfer?.getData("application/x-lightcp-template") || draggedTemplateId,
    );
    if (!source || source === target.id) {
      clearTemplateDrag();
      return;
    }
    const siblings = templateStore.templates.filter(
      (template) => template.categoryId === target.categoryId && template.id !== source,
    );
    const index = siblings.findIndex((template) => template.id === target.id);
    void templateStore.moveTemplate(source, target.categoryId, Math.max(0, index + Number(dropAfter)));
    clearTemplateDrag();
  }

  function leaveTemplateDrop(event: DragEvent, id: number): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    if (dropTemplateId === id) dropTemplateId = undefined;
  }

  function clearTemplateDrag(): void {
    draggedTemplateId = undefined;
    dropTemplateId = undefined;
    dropAfter = false;
  }

  function categoryName(categoryId?: number): string {
    return templateStore.categories.find((category) => category.id === categoryId)?.name ?? "未分类";
  }

  function aliasesInput(value: string): void {
    templateStore.draft.aliases = value
      .split(/[,，\n]/)
      .map((alias) => alias.trim())
      .filter(Boolean);
  }

  function collapseFromBlank(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest(".template-list-pane")) return;
    if (target.closest("button, input, select, .template-list-row")) return;
    templateStore.collapseEditor();
  }

  async function showHistory(): Promise<void> {
    historyOpen = true;
    await templateStore.loadHistory();
  }

  function formatTime(value?: string): string {
    if (!value) return "刚刚";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
</script>

<svelte:window onclick={collapseFromBlank} />

<section class="template-center" aria-label="模板中心">
  <header class="template-center-header">
    <div>
      <strong>模板中心</strong>
      <span>{templateStore.kind === "snippet" ? "可重复使用的代码片段" : "新文件的起始模板"}</span>
    </div>
    <button class="primary-button" onclick={() => templateStore.beginCreate()}><Icon name="plus" size={13} /> 新建</button>
  </header>

  <div class="template-center-body" class:detail-open={detailOpen}>
    <aside class="template-list-pane" aria-label="模板列表">
      <div class="template-list-summary">
        <span>{templateStore.loading ? "正在加载…" : `${templateStore.templates.length} 个模板`}</span>
        {#if templateStore.sort !== "manual"}<small>拖到分类可移动；列表排序需切换手动</small>{/if}
      </div>
      <div class="template-list" bind:this={listViewport} onscroll={(event) => (listScrollTop = event.currentTarget.scrollTop)}>
        <div class="template-list-spacer" style:height={`${templateStore.templates.length * TEMPLATE_ROW_HEIGHT}px`}>
        {#each renderedTemplates as template, index (template.id)}
          <div
            class="template-list-row"
            class:active={templateStore.selectedId === template.id}
            class:dragging={draggedTemplateId === template.id}
            class:drop-before={dropTemplateId === template.id && !dropAfter}
            class:drop-after={dropTemplateId === template.id && dropAfter}
            role="button"
            tabindex="0"
            draggable="true"
            aria-grabbed={draggedTemplateId === template.id}
            style:top={`${(templateStart + index) * TEMPLATE_ROW_HEIGHT}px`}
            onclick={() => void templateStore.openTemplate(template.id)}
            onkeydown={(event) => {
              if (event.key === "Enter") void templateStore.openTemplate(template.id);
            }}
            ondragstart={(event) => beginTemplateDrag(event, template)}
            ondragover={(event) => allowTemplateDrop(event, template)}
            ondragleave={(event) => leaveTemplateDrop(event, template.id)}
            ondragend={clearTemplateDrag}
            ondrop={(event) => dropTemplate(event, template)}
          >
            <span class="template-type-mark">{template.kind === "snippet" ? "{}" : "C++"}</span>
            <span class="template-list-copy">
              <strong>{template.name}</strong>
              <small>{template.trigger || categoryName(template.categoryId)}</small>
              {#if template.aliases.length}<em>{template.aliases.slice(0, 3).join(" · ")}</em>{/if}
            </span>
            <button
              class:active={template.favorite}
              class="favorite-button"
              aria-label={template.favorite ? "取消收藏" : "添加到收藏"}
              title={template.favorite ? "取消收藏" : "添加到收藏"}
              onclick={(event) => {
                event.stopPropagation();
                void templateStore.toggleFavorite(template);
              }}
            >★</button>
          </div>
        {/each}
        </div>
        {#if !templateStore.loading && templateStore.templates.length === 0}
          <div class="template-list-empty">
            <Icon name="templates" size={27} />
            <span>没有匹配的模板</span>
            <button onclick={() => templateStore.beginCreate()}>新建模板</button>
          </div>
        {/if}
      </div>
    </aside>

    {#if detailOpen}
    <div class="template-detail-pane">
      {#if templateStore.detailLoading}
        <div class="template-detail-empty">正在加载模板内容…</div>
      {:else if templateStore.mode !== "empty"}
        <form class="template-editor-form" onsubmit={(event) => { event.preventDefault(); void templateStore.saveDraft(); }}>
          <header class="template-editor-toolbar">
            <div>
              <strong>{templateStore.mode === "create" ? "新建模板" : templateStore.detail?.name}</strong>
              <span>{templateStore.mode === "create" ? "首次保存时会创建一个版本" : `更新于 ${formatTime(templateStore.detail?.updatedAt)}`}</span>
            </div>
            <div class="template-editor-actions">
              {#if templateStore.mode === "view" && templateStore.detail}
                {#if templateStore.detail.kind === "snippet"}
                  <button type="button" class="secondary-button" onclick={() => void templateStore.insertTemplate(templateStore.detail!)}>插入</button>
                {/if}
                <button type="button" class="secondary-button" onclick={() => void showHistory()}>版本历史</button>
                <button type="button" class="danger-button" onclick={() => void templateStore.deleteSelected()}>删除</button>
              {/if}
              <button class="primary-button" type="submit" disabled={templateStore.saving}>{templateStore.saving ? "正在保存…" : "保存"}</button>
            </div>
          </header>

          <div class="template-fields-grid">
            <label><span>名称</span><input required bind:value={templateStore.draft.name} /></label>
            <label><span>语言</span><input bind:value={templateStore.draft.language} /></label>
            {#if templateStore.draft.kind === "snippet"}
              <label><span>触发词</span><input bind:value={templateStore.draft.trigger} placeholder="dinic" /></label>
            {/if}
            <label>
              <span>分类</span>
              <select bind:value={templateStore.draft.categoryId}>
                <option value={undefined}>未分类</option>
                {#each templateStore.categories as category (category.id)}
                  <option value={category.id}>{category.name}</option>
                {/each}
              </select>
            </label>
            <label class="wide"><span>别名</span><input value={templateStore.draft.aliases.join(", ")} oninput={(event) => aliasesInput(event.currentTarget.value)} placeholder="流, 最大流, maxflow" /></label>
            <label class="wide"><span>说明</span><input bind:value={templateStore.draft.description} /></label>
          </div>

          <label class="template-code-field">
            <span>
              代码
              {#if templateStore.draft.kind === "snippet"}<small>占位符：{"${1:name}"}、{"${2:value}"}、$0</small>{/if}
            </span>
            <textarea spellcheck="false" bind:value={templateStore.draft.code}></textarea>
          </label>

          {#if templateStore.notice}<p class="template-notice">{templateStore.notice}</p>{/if}
          {#if templateStore.error}<p class="template-form-error">{templateStore.error}</p>{/if}
        </form>
      {/if}
    </div>
    {/if}
  </div>
</section>

{#if historyOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => { historyOpen = false; templateStore.versionPreview = undefined; }}>
    <div class="history-dialog" role="dialog" aria-modal="true" aria-label="模板版本历史" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
      <header>
        <div><strong>版本历史</strong><span>最近保存的 20 个版本</span></div>
        <button aria-label="关闭版本历史" onclick={() => { historyOpen = false; templateStore.versionPreview = undefined; }}><Icon name="close" size={14} /></button>
      </header>
      <div class="history-body">
        <div class="history-list">
          {#if templateStore.historyLoading}<span class="history-empty">正在加载…</span>{/if}
          {#each templateStore.versions as version (version.id)}
            <button class:active={templateStore.versionPreview?.id === version.id} onclick={() => void templateStore.previewVersion(version.id)}>
              <strong>v{version.versionNumber}</strong>
              <span>{version.name}</span>
              <small>{formatTime(version.createdAt)}</small>
            </button>
          {/each}
        </div>
        <div class="history-preview">
          {#if templateStore.versionPreview}
            <header>
              <span>v{templateStore.versionPreview.versionNumber}</span>
              <div class="history-preview-actions">
                <button
                  class="danger-button"
                  onclick={() => {
                    const version = templateStore.versions.find(
                      (candidate) => candidate.id === templateStore.versionPreview?.id,
                    );
                    if (version) void templateStore.deleteVersion(version);
                  }}
                >删除此版本</button>
                <button class="primary-button" onclick={() => void templateStore.restoreVersion(templateStore.versionPreview!.id)}>恢复此版本</button>
              </div>
            </header>
            <pre>{templateStore.versionPreview.code}</pre>
          {:else}
            <span class="history-empty">请选择一个版本以加载内容。</span>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
