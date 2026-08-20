<script lang="ts">
  import type { ActivityId, ShellStore } from "../../stores/shell.svelte";
  import Icon, { type IconName } from "./Icon.svelte";

  interface Props {
    shell: ShellStore;
  }

  const primaryItems: { id: ActivityId; label: string; icon: IconName }[] = [
    { id: "explorer", label: "资源管理器", icon: "explorer" },
    { id: "testcases", label: "测试点", icon: "testcases" },
    { id: "search", label: "搜索", icon: "search" },
    { id: "templates", label: "模板", icon: "templates" },
    { id: "debug", label: "调试", icon: "debug" },
    { id: "judge", label: "压力测试", icon: "judge" },
  ];

  let { shell }: Props = $props();
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
      class:active={shell.activeActivity === "settings" && shell.sidebarVisible}
      aria-label="设置"
      aria-pressed={shell.activeActivity === "settings" && shell.sidebarVisible}
      title="设置"
      onclick={() => shell.selectActivity("settings")}
    >
      <Icon name="settings" size={21} />
    </button>
  </div>
</nav>
