<script lang="ts">
  import { onMount } from "svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type { TemplateCategoryRow, TemplateSort } from "../../types/templates";
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
  let categoryRows = $derived(templateStore.categoryRows);
  let categoryStart = $derived(
    Math.max(0, Math.floor(categoryScrollTop / CATEGORY_ROW_HEIGHT) - CATEGORY_OVERSCAN),
  );
  let categoryEnd = $derived(
    Math.min(
      categoryRows.length,
      Math.ceil((categoryScrollTop + categoryViewportHeight) / CATEGORY_ROW_HEIGHT) + CATEGORY_OVERSCAN,
    ),
  );
  let renderedCategories = $derived(categoryRows.slice(categoryStart, categoryEnd));

  onMount(() => {
    void templateStore.initialize();
    const observer = new ResizeObserver(([entry]) => {
      categoryViewportHeight = entry.contentRect.height;
    });
    observer.observe(categoryViewport);
    return () => observer.disconnect();
  });

  function beginCategoryDrag(event: DragEvent, id: number): void {
    event.dataTransfer?.setData("application/x-lightcp-template-category", String(id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function allowCategoryDrop(event: DragEvent): void {
    if (event.dataTransfer?.types.includes("application/x-lightcp-template-category")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
    if (event.dataTransfer?.types.includes("application/x-lightcp-template")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }

  function dropOnCategory(event: DragEvent, row: TemplateCategoryRow): void {
    event.preventDefault();
    event.stopPropagation();
    const categoryText = event.dataTransfer?.getData("application/x-lightcp-template-category");
    const templateText = event.dataTransfer?.getData("application/x-lightcp-template");
    if (templateText) {
      const count = templateStore.templates.filter(
        (template) => template.categoryId === row.category.id,
      ).length;
      void templateStore.moveTemplate(Number(templateText), row.category.id, count);
      return;
    }
    if (!categoryText) return;

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    if (ratio >= 0.3 && ratio <= 0.7) {
      const childCount = templateStore.categories.filter(
        (category) => category.parentId === row.category.id,
      ).length;
      void templateStore.moveCategory(Number(categoryText), row.category.id, childCount);
      return;
    }
    const siblings = templateStore.categories
      .filter((category) => category.parentId === row.category.parentId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
    const index = siblings.findIndex((category) => category.id === row.category.id);
    void templateStore.moveCategory(
      Number(categoryText),
      row.category.parentId,
      index + (ratio > 0.7 ? 1 : 0),
    );
  }

  function dropOnRoot(event: DragEvent): void {
    event.preventDefault();
    const categoryText = event.dataTransfer?.getData("application/x-lightcp-template-category");
    const templateText = event.dataTransfer?.getData("application/x-lightcp-template");
    if (categoryText) {
      const roots = templateStore.categories.filter((category) => category.parentId === undefined);
      void templateStore.moveCategory(Number(categoryText), undefined, roots.length);
    } else if (templateText) {
      const ungrouped = templateStore.templates.filter(
        (template) => template.categoryId === undefined,
      );
      void templateStore.moveTemplate(Number(templateText), undefined, ungrouped.length);
    }
  }
</script>

<section class="template-sidebar-panel">
  <div class="template-kind-tabs" role="tablist" aria-label="模板类型">
    <button class:active={templateStore.kind === "snippet"} role="tab" onclick={() => void templateStore.setKind("snippet")}>代码片段</button>
    <button class:active={templateStore.kind === "file"} role="tab" onclick={() => void templateStore.setKind("file")}>文件模板</button>
  </div>

  <div class="search-box template-search">
    <Icon name="search" size={14} />
    <input
      aria-label="搜索模板"
      placeholder="名称、触发词或别名…"
      value={templateStore.search}
      oninput={(event) => templateStore.setSearch(event.currentTarget.value)}
    />
  </div>

  <div class="template-collections">
    <button class:active={templateStore.collection === "all" && templateStore.selectedCategoryId === undefined} onclick={() => void templateStore.setCollection("all")}>
      <span>⌘</span><span>全部模板</span>
    </button>
    <button class:active={templateStore.collection === "favorites"} onclick={() => void templateStore.setCollection("favorites")}>
      <span>★</span><span>收藏</span>
    </button>
    <button class:active={templateStore.collection === "recent"} onclick={() => void templateStore.setCollection("recent")}>
      <span>◷</span><span>最近使用</span>
    </button>
  </div>

  <label class="template-sort-row">
    <span>排序</span>
    <select value={templateStore.sort} onchange={(event) => void templateStore.setSort(event.currentTarget.value as TemplateSort)}>
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
    bind:this={categoryViewport}
    role="tree"
    tabindex="0"
    aria-label="模板分类"
    onscroll={(event) => (categoryScrollTop = event.currentTarget.scrollTop)}
    ondragover={allowCategoryDrop}
    ondrop={dropOnRoot}
  >
    <div class="category-tree-spacer" style:height={`${categoryRows.length * CATEGORY_ROW_HEIGHT}px`}>
    {#each renderedCategories as row, index (row.category.id)}
      <div
        class="category-row"
        class:active={templateStore.selectedCategoryId === row.category.id && templateStore.collection === "all"}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={row.hasChildren ? row.expanded : undefined}
        aria-selected={templateStore.selectedCategoryId === row.category.id}
        tabindex="0"
        draggable="true"
        style:top={`${(categoryStart + index) * CATEGORY_ROW_HEIGHT}px`}
        style:padding-left={`${7 + row.depth * 14}px`}
        onclick={() => void templateStore.setCategory(row.category.id)}
        onkeydown={(event) => {
          if (event.key === "Enter") void templateStore.setCategory(row.category.id);
        }}
        ondragstart={(event) => beginCategoryDrag(event, row.category.id)}
        ondragover={allowCategoryDrop}
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
        <Icon name="folder" size={13} />
        <span class="category-name">{row.category.name}</span>
        <span class="category-actions">
          <button title="新建子分类" aria-label="新建子分类" onclick={(event) => { event.stopPropagation(); void templateStore.createCategory(row.category.id); }}>+</button>
          <button title="重命名分类" aria-label="重命名分类" onclick={(event) => { event.stopPropagation(); void templateStore.renameCategory(row.category); }}>✎</button>
          <button title="删除分类" aria-label="删除分类" onclick={(event) => { event.stopPropagation(); void templateStore.deleteCategory(row.category); }}>×</button>
        </span>
      </div>
    {/each}
    </div>
    {#if templateStore.categories.length === 0}
      <div class="category-empty">暂无分类</div>
    {/if}
  </div>

  <button class="new-template-button" onclick={() => templateStore.beginCreate()}>
    <Icon name="plus" size={13} /> 新建{templateStore.kind === "snippet" ? "代码片段" : "文件模板"}
  </button>

  {#if templateStore.error}
    <div class="template-sidebar-error" role="alert">{templateStore.error}</div>
  {/if}
</section>
