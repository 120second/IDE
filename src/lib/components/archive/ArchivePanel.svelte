<script lang="ts">
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { ArchiveFile, ArchiveStatus, SmartCollection } from "../../types/archive";
  import Icon from "../shell/Icon.svelte";
  import BulkArchiveDialog from "./BulkArchiveDialog.svelte";
  import SmartCollectionDialog from "./SmartCollectionDialog.svelte";
  import type { KeybindingMap } from "../../keybindings";

  interface Props {
    archiveStore: ArchiveStore;
    keybindings: KeybindingMap;
  }

  let { archiveStore, keybindings }: Props = $props();
  let bulkDialogOpen = $state(false);
  let collectionDialogOpen = $state(false);
  let editingCollection = $state<SmartCollection>();

  function platformCount(platform: string): number {
    return archiveStore.facets.platforms.find((facet) => facet.name === platform)?.count ?? 0;
  }

  function beginCollection(collection?: SmartCollection): void {
    editingCollection = collection;
    collectionDialogOpen = true;
  }

  function metadata(file: ArchiveFile): string {
    return [
      platformLabel(file.platform),
      file.problemId,
      file.rating === undefined ? "" : String(file.rating),
      statusLabel(file.status),
    ].filter(Boolean).join(" · ");
  }
</script>

<section class="archive-panel">
  <div class="archive-search-row">
    <div class="search-box archive-search"><Icon name="search" size={13} /><input aria-label="搜索归档" placeholder="标题、题号、标签…" value={archiveStore.search} oninput={(event) => archiveStore.setSearch(event.currentTarget.value)} /></div>
    <button title={`归档当前文件 · ${keybindings.quickArchive}`} aria-label="归档当前文件" onclick={() => archiveStore.openQuickArchive()}><Icon name="plus" size={13} /></button>
  </div>

  <div class="archive-virtual-tree">
    <section class="archive-group">
      <h4>集合</h4>
      <button class:active={archiveStore.activeView === "inbox"} onclick={() => void archiveStore.selectView("inbox", "收件箱", { inboxOnly: true })}><span>收件箱</span><em>{archiveStore.facets.inboxCount}</em></button>
      <button class:active={archiveStore.activeView === "favorites"} onclick={() => void archiveStore.selectView("favorites", "收藏", { favoriteOnly: true })}><span>★ 收藏</span><em>{archiveStore.facets.favoriteCount}</em></button>
      <button class:active={archiveStore.activeView === "recent"} onclick={() => void archiveStore.selectView("recent", "最近编辑", { recentOnly: true })}><span>◷ 最近编辑</span><em>{archiveStore.facets.recentCount}</em></button>
      <button class:active={archiveStore.activeView === "completed"} onclick={() => void archiveStore.selectView("completed", "已完成", { status: "completed" })}><span>✓ 已完成</span><em>{archiveStore.facets.completedCount}</em></button>
      <button class:active={archiveStore.activeView === "review"} onclick={() => void archiveStore.selectView("review", "待复习", { status: "review" })}><span>↻ 待复习</span><em>{archiveStore.facets.reviewCount}</em></button>
    </section>

    <section class="archive-group">
      <h4><span>智能集合</span><button title="新建智能集合" aria-label="新建智能集合" onclick={() => beginCollection()}>+</button></h4>
      {#each archiveStore.collections as collection (collection.id)}
        <div class="smart-collection-row" class:active={archiveStore.activeView === `collection-${collection.id}`}>
          <button class="smart-collection-main" onclick={() => void archiveStore.selectView(`collection-${collection.id}`, collection.name, { collectionId: collection.id })}><span>☆ {collection.name}</span><em>{collection.count}</em></button>
          <button title="编辑智能集合" aria-label={`编辑 ${collection.name}`} onclick={() => beginCollection(collection)}>✎</button>
          <button title="删除智能集合" aria-label={`删除 ${collection.name}`} onclick={() => void archiveStore.deleteCollection(collection)}>×</button>
        </div>
      {/each}
      {#if archiveStore.collections.length === 0}<p>可按难度、状态和算法标签保存查询。</p>{/if}
    </section>

    <section class="archive-group">
      <h4>平台</h4>
      {#each platforms as platform}
        <button class:active={archiveStore.activeView === `platform-${platform.value}`} onclick={() => void archiveStore.selectView(`platform-${platform.value}`, platform.label, { platform: platform.value })}><span>{platform.label}</span><em>{platformCount(platform.value)}</em></button>
      {/each}
    </section>

    <section class="archive-group">
      <h4>难度</h4>
      {#each archiveStore.facets.difficulties as difficulty}
        <button class:active={archiveStore.activeView === `difficulty-${difficulty.label}`} onclick={() => void archiveStore.selectView(`difficulty-${difficulty.label}`, `难度 ${difficulty.label}`, { minRating: difficulty.minRating, maxRating: difficulty.maxRating })}><span>{difficulty.label}</span><em>{difficulty.count}</em></button>
      {/each}
    </section>

    <section class="archive-group archive-tags-group">
      <h4>算法标签</h4>
      {#each archiveStore.facets.tags as tag (tag.name)}
        <button class:active={archiveStore.activeView === `tag-${tag.name}`} onclick={() => void archiveStore.selectView(`tag-${tag.name}`, tag.name, { tag: tag.name })}><span># {tag.name}</span><em>{tag.count}</em></button>
      {/each}
      {#if archiveStore.facets.tags.length === 0}<p>归档文件时添加算法标签。</p>{/if}
    </section>
  </div>

  <div class="archive-results-heading">
    <label title="选择当前结果"><input type="checkbox" checked={archiveStore.files.length > 0 && archiveStore.selectedIds.length === archiveStore.files.length} onchange={(event) => archiveStore.selectAll(event.currentTarget.checked)} /></label>
    <strong>{archiveStore.activeLabel}</strong>
    <span>{archiveStore.loading ? "加载中…" : `${archiveStore.files.length} 项`}</span>
  </div>

  <div class="archive-file-list">
    {#each archiveStore.files as file (file.id)}
      <div class="archive-file-row" class:selected={archiveStore.isSelected(file.id)}>
        <input type="checkbox" aria-label={`选择 ${file.title}`} checked={archiveStore.isSelected(file.id)} onchange={(event) => archiveStore.toggleSelected(file.id, event.currentTarget.checked)} />
        <button class="archive-file-main" title={file.path} onclick={() => void archiveStore.openFile(file)}>
          <strong>{file.title}</strong>
          <small>{file.archived ? metadata(file) : fileName(file.path)}</small>
          {#if file.tags.length}<span>{file.tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}</span>{/if}
        </button>
        {#if file.archived}<button class:active={file.favorite} class="archive-favorite" title={file.favorite ? "取消收藏" : "收藏"} aria-label={file.favorite ? `取消收藏 ${file.title}` : `收藏 ${file.title}`} onclick={() => void archiveStore.toggleFavorite(file)}>★</button>{/if}
        <button class="archive-edit" title={file.archived ? "编辑归档" : "归档"} aria-label={`${file.archived ? "编辑" : "归档"} ${file.title}`} onclick={() => (archiveStore.quickArchivePath = file.path)}>→</button>
      </div>
    {/each}
    {#if !archiveStore.loading && archiveStore.files.length === 0}
      <div class="archive-empty"><Icon name="database" size={24} /><span>{archiveStore.activeView === "inbox" ? "当前已发现的 C++ 文件都已整理。" : "此虚拟分类中暂无文件。"}</span></div>
    {/if}
  </div>

  {#if archiveStore.selectedIds.length}
    <div class="archive-batch-bar"><span>已选择 {archiveStore.selectedIds.length} 项</span><button class="primary-button" onclick={() => (bulkDialogOpen = true)}>批量修改</button></div>
  {/if}
  {#if archiveStore.notice}<div class="archive-notice">{archiveStore.notice}</div>{/if}
  {#if archiveStore.error}<div class="archive-error" role="alert">{archiveStore.error}<button aria-label="关闭错误提示" onclick={() => (archiveStore.error = "")}>×</button></div>{/if}
</section>

{#if bulkDialogOpen}<BulkArchiveDialog {archiveStore} close={() => (bulkDialogOpen = false)} />{/if}
{#if collectionDialogOpen}<SmartCollectionDialog {archiveStore} collection={editingCollection} close={() => { collectionDialogOpen = false; editingCollection = undefined; }} />{/if}

<script lang="ts" module>
  const platforms = [
    { value: "codeforces", label: "Codeforces" },
    { value: "atcoder", label: "AtCoder" },
    { value: "luogu", label: "洛谷" },
    { value: "other", label: "其他" },
  ];

  function platformLabel(platform: string): string {
    return platforms.find((option) => option.value === platform)?.label ?? platform;
  }

  function statusLabel(status: ArchiveStatus): string {
    if (status === "completed") return "已完成";
    if (status === "review") return "待复习";
    if (status === "mastered") return "已掌握";
    return "未完成";
  }

  function fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }
</script>
