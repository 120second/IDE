<script lang="ts">
  import { onMount } from "svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type {
    TemplateCategoryRow,
    TemplateMetadata,
    TemplateSort,
  } from "../../types/templates";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    templateStore: TemplateStore;
  }

  const sorts: { value: TemplateSort; label: string }[] = [
    { value: "manual", label: "手动排序" },
    { value: "name", label: "名称" },
    { value: "recentlyUsed", label: "最近使用" },
    { value: "usageCount", label: "使用次数" },
    { value: "updated", label: "更新时间" },
    { value: "created", label: "创建时间" },
  ];

  let { templateStore }: Props = $props();
  const CATEGORY_ROW_HEIGHT = 27;
  const CATEGORY_OVERSCAN = 8;
  let categoryViewport: HTMLDivElement;
  let categoryScrollTop = $state(0);
  let categoryViewportHeight = $state(300);
  let draggedCategoryId = $state<number>();
  let draggedTemplateId = $state<number>();
  let dropCategoryId = $state<number>();
  let categoryDropMode = $state<"before" | "inside" | "after">("inside");
  let rootDropActive = $state(false);
  let treeRows = $derived(templateStore.treeRows);
  let categoryStart = $derived(
    Math.max(0, Math.floor(categoryScrollTop / CATEGORY_ROW_HEIGHT) - CATEGORY_OVERSCAN),
  );
  let categoryEnd = $derived(
    Math.min(
      treeRows.length,
      Math.ceil((categoryScrollTop + categoryViewportHeight) / CATEGORY_ROW_HEIGHT) + CATEGORY_OVERSCAN,
    ),
  );
  let renderedRows = $derived(treeRows.slice(categoryStart, categoryEnd));

  onMount(() => {
    void templateStore.initialize();
    const observer = new ResizeObserver(([entry]) => {
      categoryViewportHeight = entry.contentRect.height;
    });
    observer.observe(categoryViewport);
    return () => observer.disconnect();
  });

  function beginCategoryDrag(event: DragEvent, id: number): void {
    draggedCategoryId = id;
    event.dataTransfer?.setData("application/x-lightcp-template-category", String(id));
    event.dataTransfer?.setData("text/plain", String(id));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.dropEffect = "move";
    }
  }

  function beginTemplateDrag(event: DragEvent, template: TemplateMetadata): void {
    draggedTemplateId = template.id;
    event.dataTransfer?.setData("application/x-lightcp-template", String(template.id));
    event.dataTransfer?.setData("text/plain", String(template.id));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.dropEffect = "move";
    }
  }

  function allowCategoryDrop(event: DragEvent, row?: TemplateCategoryRow): void {
    const categoryDrag = Boolean(
      draggedCategoryId
      || event.dataTransfer?.types.includes("application/x-lightcp-template-category"),
    );
    const templateDrag = Boolean(
      event.dataTransfer?.types.includes("application/x-lightcp-template"),
    );
    if (!categoryDrag && !templateDrag) return;
    event.preventDefault();
    if (row) event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    rootDropActive = !row;
    dropCategoryId = row?.category.id;
    if (!row || templateDrag) {
      categoryDropMode = "inside";
      return;
    }
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    categoryDropMode = ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "inside";
  }

  function dropOnCategory(event: DragEvent, row: TemplateCategoryRow): void {
    event.preventDefault();
    event.stopPropagation();
    const categoryText = event.dataTransfer?.getData("application/x-lightcp-template-category");
    const templateText = event.dataTransfer?.getData("application/x-lightcp-template");
    if (templateText) {
      const count = templateStore.treeTemplates.filter(
        (template) => template.categoryId === row.category.id && template.id !== Number(templateText),
      ).length;
      void templateStore.moveTemplate(Number(templateText), row.category.id, count);
      clearCategoryDrag();
      return;
    }
    const source = Number(categoryText || draggedCategoryId);
    if (!source) {
      clearCategoryDrag();
      return;
    }

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    if (ratio >= 0.3 && ratio <= 0.7) {
      const childCount = templateStore.categories.filter(
        (category) => category.parentId === row.category.id && category.id !== source,
      ).length;
      void templateStore.moveCategory(source, row.category.id, childCount);
      clearCategoryDrag();
      return;
    }
    const siblings = templateStore.categories
      .filter((category) => category.parentId === row.category.parentId && category.id !== source)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
    const index = siblings.findIndex((category) => category.id === row.category.id);
    void templateStore.moveCategory(
      source,
      row.category.parentId,
      index + (ratio > 0.7 ? 1 : 0),
    );
    clearCategoryDrag();
  }

  function dropOnRoot(event: DragEvent): void {
    event.preventDefault();
    const categoryText = event.dataTransfer?.getData("application/x-lightcp-template-category");
    const templateText = event.dataTransfer?.getData("application/x-lightcp-template");
    const categoryId = Number(categoryText || draggedCategoryId);
    if (categoryId) {
      const roots = templateStore.categories.filter(
        (category) => category.parentId === undefined && category.id !== categoryId,
      );
      void templateStore.moveCategory(categoryId, undefined, roots.length);
    } else if (templateText) {
      const ungrouped = templateStore.treeTemplates.filter(
        (template) => template.categoryId === undefined && template.id !== Number(templateText),
      );
      void templateStore.moveTemplate(Number(templateText), undefined, ungrouped.length);
    }
    clearCategoryDrag();
  }

  function leaveCategoryDrop(event: DragEvent, id: number): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    if (dropCategoryId === id) dropCategoryId = undefined;
  }

  function clearCategoryDrag(): void {
    draggedCategoryId = undefined;
    draggedTemplateId = undefined;
    dropCategoryId = undefined;
    categoryDropMode = "inside";
    rootDropActive = false;
  }

  function handleCategoryKeydown(event: KeyboardEvent, row: TemplateCategoryRow): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void templateStore.setCategory(row.category.id);
      return;
    }
    if (event.key === "ArrowRight" && row.hasChildren && !row.expanded) {
      event.preventDefault();
      templateStore.toggleCategory(row.category.id);
      return;
    }
    if (event.key === "ArrowLeft" && row.expanded) {
      event.preventDefault();
      templateStore.toggleCategory(row.category.id);
    }
  }
</script>

<section class="template-sidebar-panel">
  <div class="template-kind-tabs" role="tablist" aria-label="模板类型">
    <button class:active={templateStore.kind === "snippet"} role="tab" aria-selected={templateStore.kind === "snippet"} onclick={() => void templateStore.setKind("snippet")}>代码片段</button>
    <button class:active={templateStore.kind === "file"} role="tab" aria-selected={templateStore.kind === "file"} onclick={() => void templateStore.setKind("file")}>文件模板</button>
  </div>

  <div class="search-box template-search">
    <Icon name="search" size={14} />
    <input
      aria-label="搜索模板"
      name="template-search"
      autocomplete="off"
      placeholder="名称、触发词或别名…"
      value={templateStore.search}
      oninput={(event) => templateStore.setSearch(event.currentTarget.value)}
    />
  </div>

  <div class="template-collections">
    <button class:active={templateStore.collection === "all" && templateStore.selectedCategoryId === undefined} aria-pressed={templateStore.collection === "all" && templateStore.selectedCategoryId === undefined} onclick={() => void templateStore.setCollection("all")}>
      <Icon name="templates" size={13} /><span>全部模板</span>
    </button>
    <button class:active={templateStore.collection === "favorites"} aria-pressed={templateStore.collection === "favorites"} onclick={() => void templateStore.setCollection("favorites")}>
      <Icon name="star" size={13} /><span>收藏</span>
    </button>
    <button class:active={templateStore.collection === "recent"} aria-pressed={templateStore.collection === "recent"} onclick={() => void templateStore.setCollection("recent")}>
      <Icon name="clock" size={13} /><span>最近使用</span>
    </button>
  </div>

  <label class="template-sort-row">
    <span>排序</span>
    <select name="template-sort" value={templateStore.sort} onchange={(event) => void templateStore.setSort(event.currentTarget.value as TemplateSort)}>
      {#each sorts as sort}
        <option value={sort.value}>{sort.label}</option>
      {/each}
    </select>
  </label>

  <div class="category-heading">
    <span>分类</span>
    <button title="新建顶级分类" aria-label="新建顶级分类" onclick={() => void templateStore.createCategory()}><Icon name="plus" size={13} /></button>
  </div>

  <div
    class="category-tree"
    class:root-drop-target={rootDropActive}
    bind:this={categoryViewport}
    role="tree"
    tabindex="-1"
    aria-label="模板文件树"
    onscroll={(event) => (categoryScrollTop = event.currentTarget.scrollTop)}
    ondragover={allowCategoryDrop}
    ondrop={dropOnRoot}
  >
    <div class="category-tree-spacer" style:height={`${treeRows.length * CATEGORY_ROW_HEIGHT}px`}>
    {#each renderedRows as row, index (`${row.kind}-${row.kind === "category" ? row.category.id : row.template.id}`)}
      {#if row.kind === "category"}
        <div
          class="category-row"
          class:active={templateStore.selectedCategoryId === row.category.id && templateStore.collection === "all"}
          class:dragging={draggedCategoryId === row.category.id}
          class:drop-target={dropCategoryId === row.category.id && categoryDropMode === "inside"}
          class:drop-before={dropCategoryId === row.category.id && categoryDropMode === "before"}
          class:drop-after={dropCategoryId === row.category.id && categoryDropMode === "after"}
          role="none"
          draggable="true"
          style:top={`${(categoryStart + index) * CATEGORY_ROW_HEIGHT}px`}
          style:padding-left={`${7 + row.depth * 14}px`}
          ondragstart={(event) => beginCategoryDrag(event, row.category.id)}
          ondragover={(event) => allowCategoryDrop(event, row)}
          ondragleave={(event) => leaveCategoryDrop(event, row.category.id)}
          ondragend={clearCategoryDrag}
          ondrop={(event) => dropOnCategory(event, row)}
        >
          <button
            class="category-chevron"
            class:expanded={row.expanded}
            aria-label={row.expanded ? "收起分类" : "展开分类"}
            disabled={!row.hasChildren}
            onclick={(event) => {
              event.stopPropagation();
              templateStore.toggleCategory(row.category.id);
            }}
          ><Icon name="chevron-right" size={11} /></button>
          <button
            class="category-row-main"
            type="button"
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={templateStore.selectedCategoryId === row.category.id}
            title={row.category.name}
            onclick={() => void templateStore.setCategory(row.category.id)}
            onkeydown={(event) => handleCategoryKeydown(event, row)}
          >
            <Icon name={row.expanded ? "folder-open" : "folder"} size={13} />
            <span class="category-name">{row.category.name}</span>
          </button>
          <span class="category-actions">
            <button title="新建子分类" aria-label="新建子分类" onclick={(event) => { event.stopPropagation(); void templateStore.createCategory(row.category.id); }}><Icon name="plus" size={11} /></button>
            <button title="重命名分类" aria-label="重命名分类" onclick={(event) => { event.stopPropagation(); void templateStore.renameCategory(row.category); }}><Icon name="edit" size={11} /></button>
            <button title="删除分类" aria-label="删除分类" onclick={(event) => { event.stopPropagation(); void templateStore.deleteCategory(row.category); }}><Icon name="close" size={11} /></button>
          </span>
        </div>
      {:else}
        <button
          class="template-tree-file"
          class:active={templateStore.selectedId === row.template.id}
          class:dragging={draggedTemplateId === row.template.id}
          type="button"
          role="treeitem"
          aria-level={row.depth + 1}
          aria-selected={templateStore.selectedId === row.template.id}
          aria-grabbed={draggedTemplateId === row.template.id}
          draggable="true"
          title={row.template.trigger && row.template.trigger !== row.template.name
            ? `${row.template.name} · ${row.template.trigger}`
            : row.template.name}
          style:top={`${(categoryStart + index) * CATEGORY_ROW_HEIGHT}px`}
          style:padding-left={`${7 + row.depth * 14}px`}
          onclick={() => void templateStore.openTemplate(row.template.id)}
          ondragstart={(event) => beginTemplateDrag(event, row.template)}
          ondragover={(event) => event.stopPropagation()}
          ondragend={clearCategoryDrag}
        >
          <span class="category-chevron-placeholder" aria-hidden="true"></span>
          <Icon name={row.template.kind === "snippet" ? "cpp" : "file"} size={13} />
          <span class="template-tree-file-name">{row.template.name}</span>
          {#if row.template.trigger && row.template.trigger !== row.template.name}
            <small>{row.template.trigger}</small>
          {/if}
        </button>
      {/if}
    {/each}
    </div>
    {#if treeRows.length === 0}
      <div class="category-empty">暂无分类或模板</div>
    {/if}
  </div>

  <button class="new-template-button" onclick={() => templateStore.beginCreate()}>
    <Icon name="plus" size={13} /> 新建{templateStore.kind === "snippet" ? "代码片段" : "文件模板"}
  </button>

  {#if templateStore.error}
    <div class="template-sidebar-error" role="alert">{templateStore.error}</div>
  {/if}
</section>
