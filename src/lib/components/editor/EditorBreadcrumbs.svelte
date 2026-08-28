<script lang="ts">
  import type { EditorWorkspace } from "../../editor/workspace.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    workspace: EditorWorkspace;
    fileWorkspace: WorkspaceStore;
    showExplorer: () => void;
  }

  interface Breadcrumb {
    label: string;
    path?: string;
    kind: "root" | "directory" | "file";
  }

  let { workspace, fileWorkspace, showExplorer }: Props = $props();
  let breadcrumbs = $derived(buildBreadcrumbs(
    workspace.activeTab?.path,
    workspace.activeTab?.title,
    fileWorkspace.info?.path,
    fileWorkspace.info?.name,
  ));

  function activate(crumb: Breadcrumb): void {
    if (crumb.kind === "file") {
      workspace.focus();
      return;
    }
    showExplorer();
    if (crumb.path) void fileWorkspace.revealPath(crumb.path);
  }

  function buildBreadcrumbs(
    filePath: string | undefined,
    title: string | undefined,
    rootPath: string | undefined,
    rootName: string | undefined,
  ): Breadcrumb[] {
    if (!filePath) return [];
    const file = normalize(filePath);
    const root = rootPath ? normalize(rootPath) : "";
    if (!root || (file.toLocaleLowerCase() !== root.toLocaleLowerCase()
      && !file.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}\\`))) {
      return [{ label: title ?? fileName(file), path: filePath, kind: "file" }];
    }

    const relative = file.slice(root.length).replace(/^\\+/, "");
    const parts = relative.split("\\").filter(Boolean);
    const crumbs: Breadcrumb[] = [{
      label: rootName ?? fileName(root),
      path: rootPath,
      kind: "root",
    }];
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = `${current}\\${part}`;
      crumbs.push({
        label: part,
        path: current,
        kind: index === parts.length - 1 ? "file" : "directory",
      });
    }
    return crumbs;
  }

  function normalize(path: string): string {
    return path.replaceAll("/", "\\").replace(/\\+$/, "");
  }

  function fileName(path: string): string {
    return normalize(path).split("\\").at(-1) || path;
  }
</script>

{#if breadcrumbs.length > 0}
  <nav class="editor-breadcrumbs" aria-label="当前文件路径">
    {#each breadcrumbs as crumb, index (`${crumb.kind}:${crumb.path ?? crumb.label}`)}
      {#if index > 0}<Icon name="chevron-right" size={11} />{/if}
      <button
        class:file={crumb.kind === "file"}
        title={crumb.path ?? crumb.label}
        aria-current={crumb.kind === "file" ? "page" : undefined}
        onclick={() => activate(crumb)}
      >
        {#if crumb.kind === "root"}<Icon name="folder" size={13} />{/if}
        <span>{crumb.label}</span>
        {#if crumb.kind === "file" && workspace.activeTab?.dirty}<i aria-label="未保存">●</i>{/if}
      </button>
    {/each}
  </nav>
{/if}
