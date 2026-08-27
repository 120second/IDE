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
      <p>轻量、专注的算法竞赛 C++ 工作台</p>
    </div>
  </div>

  <div class="welcome-grid">
    <section>
      <h2>开始</h2>
      <button onclick={() => void fileWorkspace.openFolderPicker()}>
        <Icon name="folder" size={17} /><span><strong>打开文件夹</strong><small>选择一个竞赛工作区</small></span>
      </button>
      <button onclick={newFile}>
        <Icon name="plus" size={17} /><span><strong>新建 C++ 文件</strong><small>{fileWorkspace.info ? `在 ${fileWorkspace.info.name} 中创建` : "先选择工作区"}</small></span>
      </button>
      <button onclick={showExplorer}>
        <Icon name="explorer" size={17} /><span><strong>打开资源管理器</strong><small>浏览、创建和整理文件</small></span>
      </button>
    </section>

    <section>
      <h2>常用快捷键</h2>
      <div class="welcome-shortcuts"><span>保存当前文件</span><kbd>{keybindings.save}</kbd></div>
      <div class="welcome-shortcuts"><span>快速打开文件</span><kbd>{keybindings.quickOpen}</kbd></div>
      <div class="welcome-shortcuts"><span>显示命令面板</span><kbd>{keybindings.commandPalette}</kbd></div>
      <div class="welcome-shortcuts"><span>编译并运行</span><kbd>{keybindings.runCurrent}</kbd></div>
      <div class="welcome-shortcuts"><span>运行全部测试点</span><kbd>{keybindings.runAll}</kbd></div>
      <div class="welcome-shortcuts"><span>切换底部面板</span><kbd>{keybindings.togglePanel}</kbd></div>
    </section>
  </div>

  {#if !fileWorkspace.info && fileWorkspace.recent.length > 0}
    <section class="welcome-recent">
      <h2>最近打开</h2>
      <div>
        {#each fileWorkspace.recent.slice(0, 6) as recent (recent.path)}
          <button title={recent.path} onclick={() => void fileWorkspace.openPath(recent.path)}>
            <Icon name="folder" size={15} />
            <span><strong>{recent.name}</strong><small>{recent.path}</small></span>
          </button>
        {/each}
      </div>
    </section>
  {/if}
</section>
