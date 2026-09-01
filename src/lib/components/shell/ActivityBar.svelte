<script lang="ts">
  import type { ActivityId, ShellStore } from "../../stores/shell.svelte";
  import Icon, { type IconName } from "./Icon.svelte";

  interface Props {
    shell: ShellStore;
    settingsMenuOpen: boolean;
    toggleSettingsMenu: (anchor: HTMLButtonElement) => void;
  }

  const primaryItems: { id: ActivityId; label: string; icon: IconName }[] = [
    { id: "explorer", label: "资源管理器", icon: "explorer" },
    { id: "testcases", label: "测试点", icon: "testcases" },
    { id: "templates", label: "模板", icon: "templates" },
    { id: "debug", label: "调试", icon: "debug" },
    { id: "judge", label: "对拍", icon: "judge" },
  ];

  let { shell, settingsMenuOpen, toggleSettingsMenu }: Props = $props();
  let settingsButton = $state<HTMLButtonElement>();
</script>

<nav class="activity-bar" aria-label="主要功能">
  <div class="brand-mark" title="LightCP">L</div>
  <div class="activity-items">
    {#each primaryItems as item}
      <button
        class:active={shell.activeActivity === item.id && shell.sidebarVisible}
        aria-label={item.label}
        aria-pressed={shell.activeActivity === item.id && shell.sidebarVisible}
        title={item.label}
        onclick={() => shell.selectActivity(item.id)}
      >
        <Icon name={item.icon} size={21} />
      </button>
    {/each}
  </div>
  <div class="activity-footer">
    <button
      class:active={settingsMenuOpen || shell.settingsWindowOpen}
      aria-label="设置"
      aria-haspopup="menu"
      aria-expanded={settingsMenuOpen}
      title="管理"
      bind:this={settingsButton}
      onclick={() => settingsButton && toggleSettingsMenu(settingsButton)}
    >
      <Icon name="settings" size={21} />
    </button>
  </div>
</nav>
