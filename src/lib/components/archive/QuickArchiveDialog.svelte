<script lang="ts">
  import { onMount } from "svelte";
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { ArchiveInput, ArchiveStatus } from "../../types/archive";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    archiveStore: ArchiveStore;
    path: string;
    close: () => void;
  }

  let { archiveStore, path, close }: Props = $props();
  let loading = $state(true);
  let ratingText = $state("");
  let tagsText = $state("");
  let draft = $state<ArchiveInput>({
    path: "",
    title: "",
    platform: "other",
    problemId: "",
    rating: undefined,
    status: "unfinished",
    note: "",
    favorite: false,
    tags: [],
  });

  onMount(() => {
    draft = { ...draft, path, title: fileTitle(path) };
    void archiveStore.loadFile(path)
      .then((file) => {
        if (file) {
          draft = {
            path: file.path,
            title: file.title,
            platform: file.platform,
            problemId: file.problemId,
            rating: file.rating,
            status: file.status,
            note: file.note,
            favorite: file.favorite,
            tags: [...file.tags],
          };
          ratingText = file.rating === undefined ? "" : String(file.rating);
          tagsText = file.tags.join(", ");
        }
      })
      .catch((error: unknown) => {
        archiveStore.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => (loading = false));
  });

  function parseTags(value: string): void {
    tagsText = value;
    draft.tags = value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function parseRating(value: string): void {
    ratingText = value;
    draft.rating = value.trim() ? Number(value) : undefined;
  }

  async function submit(): Promise<void> {
    if (!draft.title.trim() || loading) return;
    if (await archiveStore.saveFile(draft)) close();
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={close}>
  <div class="quick-archive-dialog" role="dialog" aria-modal="true" aria-label="快速归档" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
    <header>
      <div><strong>快速归档</strong><span>{fileName(path)}</span></div>
      <button aria-label="关闭" onclick={close}><Icon name="close" size={14} /></button>
    </header>

    {#if loading}
      <div class="archive-dialog-loading">正在读取归档信息…</div>
    {:else}
      <form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div class="archive-form-grid">
          <label class="wide"><span>标题</span><input required bind:value={draft.title} /></label>
          <label>
            <span>平台</span>
            <select bind:value={draft.platform}>
              <option value="codeforces">Codeforces</option>
              <option value="atcoder">AtCoder</option>
              <option value="luogu">洛谷</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label><span>题号</span><input bind:value={draft.problemId} placeholder="840D" /></label>
          <label><span>难度</span><input type="number" min="0" max="10000" value={ratingText} oninput={(event) => parseRating(event.currentTarget.value)} placeholder="2500" /></label>
          <label>
            <span>状态</span>
            <select bind:value={draft.status}>
              {#each statusOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
          <label class="wide"><span>标签</span><input list="archive-tag-suggestions" value={tagsText} oninput={(event) => parseTags(event.currentTarget.value)} placeholder="主席树, 区间查询" /></label>
          <label class="wide"><span>笔记</span><textarea bind:value={draft.note} placeholder="记录思路、易错点或复习计划"></textarea></label>
        </div>
        <datalist id="archive-tag-suggestions">
          {#each archiveStore.knownTags as tag}<option value={tag}></option>{/each}
        </datalist>
        {#if archiveStore.error}<p class="archive-form-error">{archiveStore.error}</p>{/if}
        <footer>
          <label class="archive-favorite-toggle"><input type="checkbox" bind:checked={draft.favorite} /> 收藏</label>
          <div><button type="button" class="secondary-button" onclick={close}>取消</button><button class="primary-button" disabled={archiveStore.saving || !draft.title.trim()}>{archiveStore.saving ? "正在归档…" : "归档"}</button></div>
        </footer>
      </form>
    {/if}
  </div>
</div>

<script lang="ts" module>
  const statusOptions: { value: ArchiveStatus; label: string }[] = [
    { value: "unfinished", label: "未完成" },
    { value: "completed", label: "已完成" },
    { value: "review", label: "待复习" },
    { value: "mastered", label: "已掌握" },
  ];

  function fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  function fileTitle(path: string): string {
    return fileName(path).replace(/\.cpp$/i, "");
  }
</script>
