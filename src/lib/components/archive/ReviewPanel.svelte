<script lang="ts">
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { ArchiveFile } from "../../types/archive";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    archiveStore: ArchiveStore;
  }

  type ReviewFilter = "due" | "upcoming" | "completed";

  let { archiveStore }: Props = $props();
  let filter = $state<ReviewFilter>("due");
  let now = $state(Date.now());

  let dueCount = $derived(archiveStore.reviewFiles.filter((file) => isDue(file, now)).length);
  let upcomingCount = $derived(archiveStore.reviewFiles.filter((file) => isUpcoming(file, now)).length);
  let completedCount = $derived(archiveStore.reviewFiles.filter((file) => file.reviewCompleted).length);
  let visibleFiles = $derived(archiveStore.reviewFiles.filter((file) => matchesFilter(file, filter, now)));

  function selectFilter(next: ReviewFilter): void {
    now = Date.now();
    filter = next;
  }

  function matchesFilter(file: ArchiveFile, active: ReviewFilter, timestamp: number): boolean {
    if (active === "completed") return file.reviewCompleted;
    return active === "due" ? isDue(file, timestamp) : isUpcoming(file, timestamp);
  }

  function isDue(file: ArchiveFile, timestamp: number): boolean {
    return !file.reviewCompleted
      && !!file.nextReviewAt
      && new Date(file.nextReviewAt).getTime() <= timestamp;
  }

  function isUpcoming(file: ArchiveFile, timestamp: number): boolean {
    return !file.reviewCompleted
      && !!file.nextReviewAt
      && new Date(file.nextReviewAt).getTime() > timestamp;
  }

  function reviewProgress(file: ArchiveFile): string {
    if (file.reviewCompleted) return "6 / 6 次 · 已掌握";
    return `第 ${(file.reviewStep ?? 0) + 1} / 6 次`;
  }

  function dueLabel(file: ArchiveFile, timestamp: number): string {
    if (file.reviewCompleted) return file.lastReviewedAt ? `完成于 ${formatDate(file.lastReviewedAt)}` : "复习已完成";
    if (!file.nextReviewAt) return "等待安排";
    const target = new Date(file.nextReviewAt);
    const difference = target.getTime() - timestamp;
    if (difference <= 0) {
      const overdueDays = Math.floor(Math.abs(difference) / 86_400_000);
      return overdueDays > 0 ? `已逾期 ${overdueDays} 天` : "现在可以复习";
    }
    if (difference < 86_400_000) return `今天 ${timeLabel(target)}`;
    if (difference < 172_800_000) return `明天 ${timeLabel(target)}`;
    return formatDate(file.nextReviewAt);
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function timeLabel(value: Date): string {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);
  }
</script>

<section class="review-panel">
  <header class="review-summary">
    <div class:has-due={dueCount > 0}>
      <Icon name="clock" size={18} />
      <span><strong>{dueCount}</strong><small>今日待复习</small></span>
    </div>
    <p>自动按 1、2、4、7、15、30 天推进</p>
  </header>

  <div class="review-filter-tabs" role="tablist" aria-label="复习题目筛选">
    <button class:active={filter === "due"} role="tab" aria-selected={filter === "due"} onclick={() => selectFilter("due")}><span>待复习</span><em>{dueCount}</em></button>
    <button class:active={filter === "upcoming"} role="tab" aria-selected={filter === "upcoming"} onclick={() => selectFilter("upcoming")}><span>未到期</span><em>{upcomingCount}</em></button>
    <button class:active={filter === "completed"} role="tab" aria-selected={filter === "completed"} onclick={() => selectFilter("completed")}><span>已完成</span><em>{completedCount}</em></button>
  </div>

  <div class="review-search-row">
    <div class="search-box archive-search">
      <Icon name="search" size={13} />
      <input aria-label="搜索复习题目" placeholder="标题、平台、标签…" value={archiveStore.reviewSearch} oninput={(event) => archiveStore.setReviewSearch(event.currentTarget.value)} />
    </div>
    <button title="刷新复习计划" aria-label="刷新复习计划" onclick={() => void archiveStore.refreshReviews()}><Icon name="refresh" size={13} /></button>
  </div>

  <div class="review-list" aria-busy={archiveStore.reviewLoading}>
    {#each visibleFiles as file (file.id)}
      <article class="review-row" class:due={isDue(file, now)} class:completed={file.reviewCompleted}>
        <button class="review-file-main" title={file.path} onclick={() => void archiveStore.openFile(file)}>
          <span class="review-row-title"><Icon name="cpp" size={13} /><strong>{file.title}</strong></span>
          <small>{reviewProgress(file)} · {dueLabel(file, now)}</small>
          {#if file.tags.length}<em>{file.tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}</em>{/if}
        </button>
        {#if file.reviewCompleted}
          <span class="review-done" aria-label="复习已完成"><Icon name="check" size={13} /></span>
        {:else}
          <button class="review-complete" disabled={!isDue(file, now) || archiveStore.saving} onclick={() => void archiveStore.completeReview(file)}>
            {isDue(file, now) ? "完成本次" : "未到期"}
          </button>
        {/if}
      </article>
    {/each}
    {#if !archiveStore.reviewLoading && visibleFiles.length === 0}
      <div class="archive-empty">
        <Icon name={filter === "completed" ? "check" : "clock"} size={24} />
        <span>{filter === "due" ? "目前没有到期的复习，保持得很好。" : filter === "upcoming" ? "暂无等待中的复习计划。" : "完成全部 6 次复习后，题目会出现在这里。"}</span>
      </div>
    {/if}
  </div>

  {#if archiveStore.notice}<div class="archive-notice" aria-live="polite">{archiveStore.notice}</div>{/if}
  {#if archiveStore.error}<div class="archive-error" role="alert">{archiveStore.error}<button aria-label="关闭错误提示" onclick={() => (archiveStore.error = "")}><Icon name="close" size={12} /></button></div>{/if}
</section>
