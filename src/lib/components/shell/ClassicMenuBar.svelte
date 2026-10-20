<script lang="ts">
  import { tick } from "svelte";
  import type { WorkbenchCommand } from "../../types/commands";
  import TitleBar from "./TitleBar.svelte";
  import Icon from "./Icon.svelte";

  let { commands, quickOpen, shortcut, settings, account, about }: {
    commands: WorkbenchCommand[]; quickOpen: () => void; shortcut: string;
    settings: () => void; account: () => void; about: () => void;
  } = $props();
  const menus = [
    { label: "文件", ids: ["file.new", "file.openFolder", "file.quickOpen", "file.save", "file.saveAll", "file.reveal", "editor.close"] },
    { label: "工具", ids: ["view.generator", "view.templates", "view.todos", "problem.listen"] },
    { label: "选项", ids: ["view.settings", "view.toggleSidebar", "view.togglePanel", "view.zen"] },
    { label: "运行", ids: ["build.compile", "build.run", "test.runAll", "build.stop", "debug.start", "stress.start"] },
  ];
  let open = $state<string>();
  let root = $state<HTMLElement>();
  let menuTrigger = $state<HTMLButtonElement>();
  let items = $derived(menus.find((menu) => menu.label === open)?.ids.flatMap((id) => {
    const command = commands.find((candidate) => candidate.id === id);
    return command ? [command] : [];
  }) ?? []);

  async function toggle(label: string, event: MouseEvent): Promise<void> {
    menuTrigger = event.currentTarget as HTMLButtonElement;
    open = open === label ? undefined : label;
    if (open) { await tick(); root?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus(); }
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) { open = undefined; menuTrigger?.focus(); event.preventDefault(); }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus(); event.preventDefault();
  }
</script>

<svelte:window onpointerdown={(event) => { if (event.target instanceof Node && !root?.contains(event.target)) open = undefined; }} onkeydown={keydown} />
<header class="classic-menubar" bind:this={root} data-tauri-drag-region>
  <div class="classic-brand" data-tauri-drag-region><span aria-hidden="true">&lt;/&gt;</span><strong data-tauri-drag-region>LightCP IDE</strong></div>
  <nav aria-label="应用菜单">
    {#each menus as menu}
      <div class="classic-menu-anchor">
        <button aria-haspopup="menu" aria-expanded={open === menu.label} class:active={open === menu.label} onclick={(event) => void toggle(menu.label, event)}>{menu.label}</button>
        {#if open === menu.label}
          <div class="classic-menu-popup" role="menu" aria-label={menu.label}>
            {#each items as command}
              <button role="menuitem" disabled={command.enabled === false} title={command.disabledReason} onclick={() => { open = undefined; void command.run(); }}><span>{command.label}</span><kbd>{command.shortcut ?? ""}</kbd></button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    <button onclick={account}>账户</button><button onclick={about}>关于</button>
  </nav>
  <div class="classic-title-drag" data-tauri-drag-region></div>
  <button class="classic-file-search" onclick={quickOpen} title={`搜索文件 · ${shortcut}`}><Icon name="search" size={14}/><span>搜索文件</span><kbd>{shortcut}</kbd></button>
  <button class="classic-settings-shortcut" onclick={settings} aria-label="打开设置" title="设置"><Icon name="settings" size={16}/></button>
  <TitleBar controlsOnly />
</header>
