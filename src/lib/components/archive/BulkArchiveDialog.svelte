<script lang="ts">
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { ArchiveStatus } from "../../types/archive";
  import { DialogDragController } from "../../ux/dialogDrag.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    archiveStore: ArchiveStore;
    close: () => void;
  }

  let { archiveStore, close }: Props = $props();
  let dialog = $state<HTMLDivElement>();
  let drag = new DialogDragController();
  let tagsText = $state("");
  let platform = $state("");
  let status = $state<ArchiveStatus | "">("");

  async function submit(): Promise<void> {
    const tags = tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    const saved = await archiveStore.bulkUpdate({
      addTags: tags,
      platform: platform || undefined,
      status: status || undefined,
    });
    if (saved) close();
  }

  function handleDialogKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={close}>
  <div class="bulk-archive-dialog" class:dragging={drag.active} role="dialog" aria-modal="true" aria-label="批量归档" tabindex="-1" style:transform={`translate3d(${drag.x}px, ${drag.y}px, 0)`} bind:this={dialog} onclick={(event) => event.stopPropagation()} onkeydown={handleDialogKey}>
    <header class="dialog-drag-handle" role="group" aria-label="批量归档标题栏，可拖动" onpointerdown={(event) => drag.begin(event, dialog)} onpointermove={(event) => drag.move(event)} onpointerup={(event) => drag.end(event)} onpointercancel={(event) => drag.end(event)}><div><strong>批量归档</strong><span>已选择 {archiveStore.selectedIds.length} 个文件；留空的字段保持不变。</span></div><button aria-label="关闭" onclick={close}><Icon name="close" size={14} /></button></header>
    <form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label><span>添加标签</span><input bind:value={tagsText} placeholder="线段树, 主席树" /></label>
      <div class="archive-form-grid">
        <label><span>平台</span><select bind:value={platform}><option value="">不修改</option><option value="codeforces">Codeforces</option><option value="atcoder">AtCoder</option><option value="luogu">洛谷</option><option value="other">其他</option></select></label>
        <label><span>状态</span><select bind:value={status}><option value="">不修改</option><option value="unfinished">未完成</option><option value="completed">已完成</option><option value="review">待复习</option><option value="mastered">已掌握</option></select></label>
      </div>
      {#if archiveStore.error}<p class="archive-form-error">{archiveStore.error}</p>{/if}
      <footer><button type="button" class="secondary-button" onclick={close}>取消</button><button class="primary-button" disabled={archiveStore.saving}>{archiveStore.saving ? "正在更新…" : "归档并更新"}</button></footer>
    </form>
  </div>
</div>
