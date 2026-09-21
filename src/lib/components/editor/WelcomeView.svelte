<script lang="ts">
  import type { KeybindingMap } from "../../keybindings";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    fileWorkspace: WorkspaceStore;
    shell: ShellStore;
    keybindings: KeybindingMap;
    newFile: () => void;
  }

  let { fileWorkspace, shell, keybindings, newFile }: Props = $props();

  function showExplorer(): void {
    shell.activeActivity = "explorer";
    shell.sidebarVisible = true;
  }

</script>

<section class="editor-welcome" aria-label="LightCP 欢迎页">
  <div class="welcome-hero">
    <div class="welcome-logo" aria-hidden="true">L</div>
    <div>
      <h1>LightCP</h1>
      <p>写代码、运行样例，专注解题。</p>
    </div>
  </div>

  <div class="welcome-grid">
    <section>
      <h2>{fileWorkspace.info ? "继续编写" : "从这里开始"}</h2>
      <button onclick={() => void fileWorkspace.openFolderPicker()}>
        <Icon name="folder" size={17} /><span><strong>打开文件夹</strong><small>选择存放 C++ 代码的目录</small></span>
      </button>
      <button onclick={newFile}>
        <Icon name="plus" size={17} /><span><strong>新建 C++ 文件</strong><small>{fileWorkspace.info ? `在 ${fileWorkspace.info.name} 中创建` : "选择文件夹后创建代码文件"}</small></span>
      </button>
      {#if fileWorkspace.info}<button onclick={showExplorer}>
        <Icon name="explorer" size={17} /><span><strong>打开资源管理器</strong><small>浏览、创建和整理文件</small></span>
      </button>{/if}
      <p class="welcome-run-hint">写好代码后，按 <kbd>{keybindings.runCurrent}</kbd> 编译并运行。</p>
    </section>

    <section class="welcome-recent">
      <h2>最近打开</h2>
      {#if fileWorkspace.recent.length}
        {#each fileWorkspace.recent.slice(0, 5) as recent (recent.path)}
          <button title={recent.path} onclick={() => void fileWorkspace.openPath(recent.path)}>
            <Icon name="folder" size={15} />
            <span><strong>{recent.name}</strong><small>{recent.path}</small></span>
          </button>
        {/each}
      {:else}
        <p class="welcome-recent-empty">打开过的文件夹会显示在这里。</p>
      {/if}
    </section>
  </div>

  <details class="welcome-keybindings">
    <summary>常用快捷键</summary>
    <div class="welcome-shortcuts"><span>保存文件</span><kbd>{keybindings.save}</kbd></div>
    <div class="welcome-shortcuts"><span>快速打开文件</span><kbd>{keybindings.quickOpen}</kbd></div>
    <div class="welcome-shortcuts"><span>查找命令</span><kbd>{keybindings.commandPalette}</kbd></div>
    <div class="welcome-shortcuts"><span>运行全部测试点</span><kbd>{keybindings.runAll}</kbd></div>
  </details>
</section>
