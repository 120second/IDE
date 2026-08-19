<script lang="ts">
  import { onMount } from "svelte";
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import type { FileEntry } from "../../types/workspace";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    fileWorkspace: WorkspaceStore;
    editor: EditorWorkspace;
    openMenu: (event: MouseEvent, entry: FileEntry) => void;
  }

  const ROW_HEIGHT = 25;
  const OVERSCAN = 10;

  let { fileWorkspace, editor, openMenu }: Props = $props();
  let viewport: HTMLDivElement;
  let scrollTop = $state(0);
  let viewportHeight = $state(300);
  let rows = $derived(fileWorkspace.visibleRows);
  let start = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  let end = $derived(
    Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN),
  );
  let renderedRows = $derived(rows.slice(start, end));

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      viewportHeight = entry.contentRect.height;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
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
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate(entry);
  }

  function beginDrag(event: DragEvent, entry: FileEntry): void {
    event.dataTransfer?.setData("application/x-lightcp-path", entry.path);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function allowDrop(event: DragEvent, entry: FileEntry): void {
    if (entry.kind !== "directory") return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function drop(event: DragEvent, target: FileEntry): void {
    if (target.kind !== "directory") return;
    event.preventDefault();
    const sourcePath = event.dataTransfer?.getData("application/x-lightcp-path");
    const source = rows.find((row) => row.entry.path === sourcePath)?.entry;
    if (source) void fileWorkspace.move(source, target.path);
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
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={fileWorkspace.selectedPath === row.entry.path}
        aria-expanded={row.entry.kind === "directory" ? row.expanded : undefined}
        tabindex={fileWorkspace.selectedPath === row.entry.path ? 0 : -1}
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
        ondrop={(event) => drop(event, row.entry)}
      >
        {#if row.entry.kind === "directory"}
          <button
            class="tree-chevron"
            class:expanded={row.expanded}
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
