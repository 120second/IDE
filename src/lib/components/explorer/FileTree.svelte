<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import type { FileEntry } from "../../types/workspace";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    fileWorkspace: WorkspaceStore;
    editor: EditorWorkspace;
    openMenu: (event: MouseEvent, entry: FileEntry) => void;
    renameEntry: (entry: FileEntry) => void | Promise<void>;
    deleteEntry: (entry: FileEntry) => void | Promise<void>;
  }

  const ROW_HEIGHT = 25;
  const OVERSCAN = 10;

  let { fileWorkspace, editor, openMenu, renameEntry, deleteEntry }: Props = $props();
  let viewport: HTMLDivElement;
  let scrollTop = $state(0);
  let viewportHeight = $state(300);
  let rows = $derived(fileWorkspace.visibleRows);
  let start = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  let end = $derived(
    Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN),
  );
  let renderedRows = $derived(rows.slice(start, end));
  let draggedPath = $state("");
  let dropTargetPath = $state("");
  let expandTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      viewportHeight = entry.contentRect.height;
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      if (expandTimer) clearTimeout(expandTimer);
    };
  });

  $effect(() => {
    const selectedPath = fileWorkspace.selectedPath;
    const index = rows.findIndex((row) => row.entry.path === selectedPath);
    if (index < 0) return;
    void tick().then(() => revealRow(index));
  });

  function activate(entry: FileEntry): void {
    fileWorkspace.select(entry.path);
    if (entry.kind === "directory") {
      void fileWorkspace.toggleDirectory(entry);
    } else {
      void editor.openFile(entry.path);
    }
  }

  function onKeyDown(event: KeyboardEvent, entry: FileEntry): void {
    const index = rows.findIndex((row) => row.entry.path === entry.path);
    if (event.key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      void renameEntry(entry);
    } else if (event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      void deleteEntry(entry);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(entry);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      void focusRow(Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      void focusRow(Math.max(0, index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      void focusRow(0);
    } else if (event.key === "End") {
      event.preventDefault();
      void focusRow(rows.length - 1);
    } else if (event.key === "ArrowRight" && entry.kind === "directory") {
      event.preventDefault();
      const row = rows[index];
      if (!row.expanded) void fileWorkspace.toggleDirectory(entry);
      else void focusRow(Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const row = rows[index];
      if (entry.kind === "directory" && row.expanded) {
        void fileWorkspace.toggleDirectory(entry);
        return;
      }
      for (let parentIndex = index - 1; parentIndex >= 0; parentIndex -= 1) {
        if (rows[parentIndex].depth < row.depth) {
          void focusRow(parentIndex);
          return;
        }
      }
    }
  }

  async function focusRow(index: number): Promise<void> {
    const row = rows[index];
    if (!row) return;
    fileWorkspace.select(row.entry.path);
    const top = index * ROW_HEIGHT;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + ROW_HEIGHT > viewport.scrollTop + viewportHeight) {
      viewport.scrollTop = top - viewportHeight + ROW_HEIGHT;
    }
    scrollTop = viewport.scrollTop;
    await tick();
    viewport.querySelector<HTMLElement>(`[data-row-index="${index}"]`)?.focus();
  }

  function revealRow(index: number): void {
    if (!viewport) return;
    const top = index * ROW_HEIGHT;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + ROW_HEIGHT > viewport.scrollTop + viewportHeight) {
      viewport.scrollTop = Math.max(0, top - viewportHeight + ROW_HEIGHT);
    }
    scrollTop = viewport.scrollTop;
  }

  function beginDrag(event: DragEvent, entry: FileEntry): void {
    draggedPath = entry.path;
    event.dataTransfer?.setData("application/x-lightcp-path", entry.path);
    event.dataTransfer?.setData("text/plain", entry.path);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.dropEffect = "move";
    }
  }

  function allowDrop(event: DragEvent, entry: FileEntry): void {
    if (
      entry.kind !== "directory"
      || entry.path === draggedPath
      || (!draggedPath && !event.dataTransfer?.types.includes("application/x-lightcp-path"))
    ) return;
    event.preventDefault();
    event.stopPropagation();
    if (dropTargetPath !== entry.path) {
      if (expandTimer) clearTimeout(expandTimer);
      dropTargetPath = entry.path;
      const row = rows.find((candidate) => candidate.entry.path === entry.path);
      if (row && !row.expanded) {
        expandTimer = setTimeout(() => {
          expandTimer = undefined;
          void fileWorkspace.toggleDirectory(entry);
        }, 650);
      }
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function drop(event: DragEvent, target: FileEntry): void {
    if (target.kind !== "directory") return;
    event.preventDefault();
    event.stopPropagation();
    const sourcePath = event.dataTransfer?.getData("application/x-lightcp-path") || draggedPath;
    const source = rows.find((row) => row.entry.path === sourcePath)?.entry;
    if (source) void fileWorkspace.move(source, target.path);
    clearDrag();
  }

  function leaveDrop(event: DragEvent, path: string): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    if (dropTargetPath !== path) return;
    if (expandTimer) clearTimeout(expandTimer);
    expandTimer = undefined;
    dropTargetPath = "";
  }

  function clearDrag(): void {
    if (expandTimer) clearTimeout(expandTimer);
    expandTimer = undefined;
    draggedPath = "";
    dropTargetPath = "";
  }
</script>

<div
  class="file-tree"
  bind:this={viewport}
  role="tree"
  aria-label="工作区文件"
  onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
>
  <div class="tree-spacer" style:height={`${rows.length * ROW_HEIGHT}px`}>
    {#each renderedRows as row, index (row.entry.path)}
      <div
        class="tree-row"
        class:selected={fileWorkspace.selectedPath === row.entry.path}
        class:directory={row.entry.kind === "directory"}
        class:dragging={draggedPath === row.entry.path}
        class:drop-target={dropTargetPath === row.entry.path}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={fileWorkspace.selectedPath === row.entry.path}
        aria-expanded={row.entry.kind === "directory" ? row.expanded : undefined}
        aria-keyshortcuts="F2 Delete"
        tabindex={fileWorkspace.selectedPath === row.entry.path ? 0 : -1}
        data-row-index={start + index}
        draggable="true"
        title={row.entry.path}
        style:top={`${(start + index) * ROW_HEIGHT}px`}
        style:padding-left={`${7 + row.depth * 15}px`}
        onclick={() => fileWorkspace.select(row.entry.path)}
        ondblclick={() => activate(row.entry)}
        onkeydown={(event) => onKeyDown(event, row.entry)}
        oncontextmenu={(event) => openMenu(event, row.entry)}
        ondragstart={(event) => beginDrag(event, row.entry)}
        ondragover={(event) => allowDrop(event, row.entry)}
        ondragleave={(event) => leaveDrop(event, row.entry.path)}
        ondragend={clearDrag}
        ondrop={(event) => drop(event, row.entry)}
      >
        {#if row.depth > 0}
          <span class="tree-indent-guides" aria-hidden="true">
            {#each Array(row.depth) as _}<i></i>{/each}
          </span>
        {/if}
        {#if row.entry.kind === "directory"}
          <button
            class="tree-chevron"
            class:expanded={row.expanded}
            tabindex="-1"
            aria-label={row.expanded ? `收起 ${row.entry.name}` : `展开 ${row.entry.name}`}
            onclick={(event) => {
              event.stopPropagation();
              void fileWorkspace.toggleDirectory(row.entry);
            }}
          >
            <Icon name="chevron-right" size={12} />
          </button>
        {:else}
          <span class="tree-chevron-spacer"></span>
        {/if}
        <span class="tree-file-icon" class:cpp-file={row.entry.name.toLowerCase().endsWith(".cpp")}>
          <Icon name={row.entry.kind === "directory" ? "folder" : row.entry.name.toLowerCase().endsWith(".cpp") ? "cpp" : "file"} size={14} />
        </span>
        <span class="tree-name">{row.entry.name}</span>
        {#if row.loading}<span class="tree-loading" aria-label="正在加载"></span>{/if}
      </div>
    {/each}
  </div>
</div>
