<script lang="ts">
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { ArchiveStatus } from "../../types/archive";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    archiveStore: ArchiveStore;
    close: () => void;
  }

  let { archiveStore, close }: Props = $props();
  let tagsText = $state("");
  let platform = $state("");
  let ratingText = $state("");
  let status = $state<ArchiveStatus | "">("");

  async function submit(): Promise<void> {
    const tags = tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    const saved = await archiveStore.bulkUpdate({
      addTags: tags,
      platform: platform || undefined,
      rating: ratingText.trim() ? Number(ratingText) : undefined,
      status: status || undefined,
    });
    if (saved) close();
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={close}>
  <div class="bulk-archive-dialog" role="dialog" aria-modal="true" aria-label="批量归档" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
    <header><div><strong>批量归档</strong><span>已选择 {archiveStore.selectedIds.length} 个文件；留空的字段保持不变。</span></div><button aria-label="关闭" onclick={close}><Icon name="close" size={14} /></button></header>
    <form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label><span>添加标签</span><input bind:value={tagsText} placeholder="线段树, 主席树" /></label>
      <div class="archive-form-grid">
        <label><span>平台</span><select bind:value={platform}><option value="">不修改</option><option value="codeforces">Codeforces</option><option value="atcoder">AtCoder</option><option value="luogu">洛谷</option><option value="other">其他</option></select></label>
        <label><span>难度</span><input type="number" min="0" max="10000" bind:value={ratingText} placeholder="不修改" /></label>
        <label class="wide"><span>状态</span><select bind:value={status}><option value="">不修改</option><option value="unfinished">未完成</option><option value="completed">已完成</option><option value="review">待复习</option><option value="mastered">已掌握</option></select></label>
      </div>
      {#if archiveStore.error}<p class="archive-form-error">{archiveStore.error}</p>{/if}
      <footer><button type="button" class="secondary-button" onclick={close}>取消</button><button class="primary-button" disabled={archiveStore.saving}>{archiveStore.saving ? "正在更新…" : "归档并更新"}</button></footer>
    </form>
  </div>
</div>
