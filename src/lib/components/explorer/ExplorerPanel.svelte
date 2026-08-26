<script lang="ts">
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { ArchiveStore } from "../../stores/archive.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import type { FileEntry } from "../../types/workspace";
  import Icon from "../shell/Icon.svelte";
  import FileTree from "./FileTree.svelte";
  import ArchivePanel from "../archive/ArchivePanel.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import ContextMenu from "../ux/ContextMenu.svelte";
  import type { KeybindingMap } from "../../keybindings";

  interface Props {
    fileWorkspace: WorkspaceStore;
    editor: EditorWorkspace;
    archiveStore: ArchiveStore;
    ux: UxStore;
    keybindings: KeybindingMap;
    newFile: (parent: string) => void;
  }

  interface ContextMenuState {
    x: number;
    y: number;
    entry: FileEntry;
  }

  let { fileWorkspace, editor, archiveStore, ux, keybindings, newFile }: Props = $props();
  let menu = $state<ContextMenuState>();
  let view = $state<"files" | "archive">("files");
  let rootDropActive = $state(false);
  let selectedEntry = $derived(
    fileWorkspace.visibleRows.find((row) => row.entry.path === fileWorkspace.selectedPath)?.entry,
  );

  function selectedDirectory(entry = selectedEntry): string | undefined {
    return fileWorkspace.entryDirectory(entry);
  }

  function requestCreate(kind: "file" | "directory", entry?: FileEntry): void {
    menu = undefined;
    const parent = selectedDirectory(entry);
    if (!parent) return;
    if (kind === "file") {
      newFile(parent);
      return;
    }
    const name = window.prompt("新文件夹名称", "新建文件夹")?.trim();
    if (name) void fileWorkspace.create(parent, name, kind);
  }

  function requestRename(entry: FileEntry): void {
    menu = undefined;
    const name = window.prompt("重命名", entry.name)?.trim();
    if (name && name !== entry.name) void fileWorkspace.rename(entry, name);
  }

  async function requestDelete(entry: FileEntry): Promise<void> {
    menu = undefined;
    const accepted = await ux.confirm({
      title: entry.kind === "directory" ? "删除文件夹" : "删除文件",
      message: `确定删除“${entry.name}”吗？此操作无法撤销。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!accepted) return;
    await fileWorkspace.delete(entry);
    if (!fileWorkspace.error) ux.success(`已删除“${entry.name}”。`);
  }

  function openEntry(entry: FileEntry): void {
    menu = undefined;
    if (entry.kind === "directory") void fileWorkspace.toggleDirectory(entry);
    else void editor.openFile(entry.path);
  }

  function openMenu(event: MouseEvent, entry: FileEntry): void {
    event.preventDefault();
    event.stopPropagation();
    fileWorkspace.select(entry.path);
    menu = {
      x: Math.min(event.clientX, window.innerWidth - 170),
      y: Math.min(event.clientY, window.innerHeight - 210),
      entry,
    };
  }

  function allowRootDrop(event: DragEvent): void {
    if (
      !fileWorkspace.info
      || !event.dataTransfer?.types.includes("application/x-lightcp-path")
    ) return;
    event.preventDefault();
    rootDropActive = true;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function dropOnRoot(event: DragEvent): void {
    event.preventDefault();
    const root = fileWorkspace.info?.path;
    const sourcePath = event.dataTransfer?.getData("application/x-lightcp-path");
    const entry = fileWorkspace.visibleRows.find((row) => row.entry.path === sourcePath)?.entry;
    if (root && entry) void fileWorkspace.move(entry, root);
    rootDropActive = false;
  }

  function leaveRootDrop(event: DragEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    rootDropActive = false;
  }
</script>

<svelte:window onclick={() => (menu = undefined)} onblur={() => (menu = undefined)} />

<section class="explorer-panel">
  {#if fileWorkspace.info}
    <div class="explorer-view-tabs" role="tablist" aria-label="资源管理器视图">
      <button class:active={view === "files"} role="tab" aria-selected={view === "files"} onclick={() => (view = "files")}>文件</button>
      <button class:active={view === "archive"} role="tab" aria-selected={view === "archive"} onclick={() => { view = "archive"; void archiveStore.refreshAll(); }}>代码归档</button>
    </div>
    {#if view === "archive"}
      <ArchivePanel {archiveStore} {keybindings} />
    {:else}
      <header
        class="workspace-heading"
        class:drop-target={rootDropActive}
        role="group"
        title={fileWorkspace.info.path}
        ondragover={allowRootDrop}
        ondragleave={leaveRootDrop}
        ondrop={dropOnRoot}
      >
        <span>{fileWorkspace.info.name}</span>
        <div class="workspace-actions">
          <button title="新建文件" aria-label="新建文件" onclick={() => requestCreate("file")}><Icon name="plus" size={13} /></button>
          <button title="新建文件夹" aria-label="新建文件夹" onclick={() => requestCreate("directory")}><Icon name="folder-plus" size={14} /></button>
          <button title="刷新" aria-label="刷新工作区" onclick={() => void fileWorkspace.refresh()}><Icon name="refresh" size={13} /></button>
          <button title="打开文件夹" aria-label="打开其他文件夹" onclick={() => void fileWorkspace.openFolderPicker()}><Icon name="folder" size={14} /></button>
        </div>
      </header>
      <FileTree {fileWorkspace} {editor} {openMenu} />
    {/if}
  {:else}
    <div class="empty-state workspace-empty">
      <Icon name="folder" size={28} />
      <p>尚未打开文件夹</p>
      <span>打开一个竞赛目录；子目录仅在展开时加载。</span>
      <button class="primary-button" disabled={fileWorkspace.loading} onclick={() => void fileWorkspace.openFolderPicker()}>
        {fileWorkspace.loading ? "正在打开…" : "打开文件夹"}
      </button>
    </div>
    {#if fileWorkspace.recent.length > 0}
      <section class="recent-workspaces">
        <h4>最近打开</h4>
        {#each fileWorkspace.recent as recent (recent.path)}
          <button title={recent.path} onclick={() => void fileWorkspace.openPath(recent.path)}>
            <Icon name="folder" size={14} />
            <span><strong>{recent.name}</strong><small>{recent.path}</small></span>
          </button>
        {/each}
      </section>
    {/if}
  {/if}

  {#if fileWorkspace.error}
    <div class="workspace-error" role="alert">
      <Icon name="warning" size={13} />
      <span>{fileWorkspace.error}</span>
      <button aria-label="关闭错误提示" onclick={() => (fileWorkspace.error = "")}><Icon name="close" size={12} /></button>
    </div>
  {/if}
</section>

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    close={() => (menu = undefined)}
    items={[
      { label: "打开", action: () => openEntry(menu!.entry) },
      ...(menu.entry.kind === "directory" ? [
        { label: "新建文件", action: () => requestCreate("file", menu!.entry) },
        { label: "新建文件夹", action: () => requestCreate("directory", menu!.entry) },
      ] : []),
      { label: "重命名", separatorBefore: true, action: () => requestRename(menu!.entry) },
      { label: "删除", danger: true, action: () => void requestDelete(menu!.entry) },
    ]}
  />
{/if}
