<script lang="ts">
  import { onMount } from "svelte";
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { ArchiveStatus, SmartCollection, SmartCollectionInput } from "../../types/archive";
  import { DialogDragController } from "../../ux/dialogDrag.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    archiveStore: ArchiveStore;
    collection?: SmartCollection;
    close: () => void;
  }

  let { archiveStore, collection, close }: Props = $props();
  let dialog = $state<HTMLDivElement>();
  let drag = new DialogDragController();
  let tagsText = $state("");
  let draft = $state<SmartCollectionInput>({
    name: "",
    platform: undefined,
    status: undefined,
    tags: [],
  });

  onMount(() => {
    if (!collection) return;
    tagsText = collection.tags.join(", ");
    draft = {
      name: collection.name,
      platform: collection.platform,
      status: collection.status,
      tags: [...collection.tags],
    };
  });

  function parseTags(value: string): void {
    tagsText = value;
    draft.tags = value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  }

  async function submit(): Promise<void> {
    if (!draft.name.trim()) return;
    const saved = collection
      ? await archiveStore.updateCollection(collection.id, draft)
      : await archiveStore.createCollection(draft);
    if (saved) {
      await archiveStore.selectView(`collection-${saved.id}`, saved.name, { collectionId: saved.id });
      close();
    }
  }

  function handleDialogKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={close}>
  <div class="smart-collection-dialog" class:dragging={drag.active} role="dialog" aria-modal="true" aria-label="智能集合" tabindex="-1" style:transform={`translate3d(${drag.x}px, ${drag.y}px, 0)`} bind:this={dialog} onclick={(event) => event.stopPropagation()} onkeydown={handleDialogKey}>
    <header class="dialog-drag-handle" role="group" aria-label="智能集合标题栏，可拖动" onpointerdown={(event) => drag.begin(event, dialog)} onpointermove={(event) => drag.move(event)} onpointerup={(event) => drag.end(event)} onpointercancel={(event) => drag.end(event)}><div><strong>{collection ? "编辑智能集合" : "新建智能集合"}</strong><span>所有条件在 SQLite 中查询，不复制代码文件。</span></div><button aria-label="关闭" onclick={close}><Icon name="close" size={14} /></button></header>
    <form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label><span>名称</span><input required bind:value={draft.name} placeholder="区域赛数据结构复习" /></label>
      <div class="archive-form-grid">
        <label><span>平台</span><select bind:value={draft.platform}><option value={undefined}>全部平台</option><option value="codeforces">Codeforces</option><option value="atcoder">AtCoder</option><option value="luogu">洛谷</option><option value="other">其他</option></select></label>
        <label><span>状态</span><select bind:value={draft.status}><option value={undefined}>全部状态</option>{#each statusOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
        <label class="wide"><span>算法标签（满足任意一个）</span><input value={tagsText} oninput={(event) => parseTags(event.currentTarget.value)} placeholder="线段树, 主席树, FHQ" /></label>
      </div>
      {#if archiveStore.error}<p class="archive-form-error">{archiveStore.error}</p>{/if}
      <footer><button type="button" class="secondary-button" onclick={close}>取消</button><button class="primary-button" disabled={!draft.name.trim()}>{collection ? "保存" : "创建"}</button></footer>
    </form>
  </div>
</div>

<script lang="ts" module>
  const statusOptions: { value: ArchiveStatus; label: string }[] = [
    { value: "unfinished", label: "未完成" },
    { value: "completed", label: "已完成" },
    { value: "review", label: "待复习" },
    { value: "mastered", label: "已掌握" },
  ];
</script>
