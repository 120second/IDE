<script lang="ts">
  import type { SettingsPage, ShellStore } from "../../stores/shell.svelte";

  interface Props {
    shell: ShellStore;
  }

  const appearancePages: { page: SettingsPage; title: string }[] = [
    { page: "theme", title: "主题" },
    { page: "background", title: "背景" },
    { page: "interface", title: "界面" },
    { page: "editor", title: "编辑器" },
  ];

  let { shell }: Props = $props();

  function open(page: SettingsPage): void {
    shell.openSettings(page);
  }
</script>

<nav class="settings-navigation" aria-label="设置分类">
  <div class="settings-navigation-level">
    <div class="settings-navigation-group-heading">
      <strong>外观</strong>
    </div>
    <div class="settings-navigation-list">
      {#each appearancePages as item}
        <button
          class:active={shell.settingsPage === item.page}
          aria-current={shell.settingsPage === item.page ? "page" : undefined}
          onclick={() => open(item.page)}
        >
          <span>{item.title}</span>
        </button>
      {/each}
    </div>
  </div>
</nav>
