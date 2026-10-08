<script lang="ts">
  import { onMount } from "svelte";
  import type { ProblemImportStore } from "../../stores/problemImport.svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type { WorkspaceStore } from "../../stores/workspace.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import { createBackdropDismiss } from "../../ux/backdropDismiss";
  import userscript from "../../../../scripts/lightcp-codeforces.user.js?raw";
  import Icon from "../shell/Icon.svelte";

  interface Props {
    listener: ProblemImportStore;
    templateStore: TemplateStore;
    fileWorkspace: WorkspaceStore;
    ux: UxStore;
    close: () => void;
  }
  let { listener, templateStore, fileWorkspace, ux, close }: Props = $props();
  let selectedId = $state<number>();
  let loadingTemplates = $state(true);
  let starting = $state(false);
  let localError = $state("");
  let dialog: HTMLDivElement;
  const backdrop = createBackdropDismiss(() => close());

  onMount(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.focus();
    let disposed = false;
    void Promise.all([listener.initialize(), templateStore.refreshFileTemplates()]).then(() => {
      if (disposed) return;
      selectedId = (templateStore.fileTemplates.find((template) => template.id === listener.templateId)
        ?? templateStore.fileTemplates.find((template) => template.name === "Contest C++")
        ?? templateStore.fileTemplates[0])?.id;
      loadingTemplates = false;
    });
    return () => { disposed = true; previousFocus?.focus(); };
  });

  async function start(): Promise<void> {
    if (starting || selectedId === undefined) return;
    starting = true;
    localError = "";
    try {
      const template = templateStore.fileTemplates.find((candidate) => candidate.id === selectedId);
      const code = await templateStore.materializeFileTemplate(selectedId);
      if (code === undefined) throw new Error(templateStore.error || "无法读取所选模板。");
      await listener.start(code);
      if (listener.listening) {
        listener.templateId = selectedId;
        listener.templateName = template?.name;
      }
    } catch (error) { localError = error instanceof Error ? error.message : String(error); }
    finally { starting = false; }
  }

  async function copy(text: string, message: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); ux.success(message); }
    catch { localError = "无法访问剪贴板，请使用项目中的 lightcp-codeforces.user.js 脚本文件。"; }
  }

  function templateLabel(name: string): string {
    return name === "Contest C++" ? "竞赛 C++" : name === "Multi Test C++" ? "多组测试 C++" : name === "Empty C++" ? "空白 C++" : name;
  }

  function keydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href]'));
    const first = controls[0], last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
      event.preventDefault(); first.focus();
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onpointerdown={backdrop.onPointerDown} onclick={backdrop.onClick} onpointercancel={backdrop.onPointerCancel}>
  <div class="problem-import-dialog" role="dialog" aria-modal="true" aria-label="CF / 洛谷题目监听" tabindex="-1" bind:this={dialog} onkeydown={keydown}>
    <header><div><strong>题目监听</strong><span>Codeforces / 洛谷 · 中文题面与样例</span></div><button class="icon-button" aria-label="关闭题目监听设置" onclick={close}><Icon name="close" size={16} /></button></header>
    <div class="dialog-body">
      <div class="listener-state" class:listening={listener.listening} role="status">
        <Icon name={listener.listening ? "check" : "pause"} size={16} />
        <div><strong>{listener.listening ? "正在监听 CF / 洛谷题目" : "监听尚未开启"}</strong><span>{listener.listening ? "关闭此窗口后仍会继续监听" : "开启后，油猴自动导入浏览器当前可见的 CF 或洛谷题目"}</span></div>
      </div>
      <div class="import-directory"><span>保存到当前工作区</span><strong title={listener.workspacePath ?? fileWorkspace.info?.path}>{listener.workspacePath ?? fileWorkspace.info?.path ?? "请先打开一个文件夹"}</strong>
        {#if !fileWorkspace.info}<button class="secondary-button" onclick={() => void fileWorkspace.openFolderPicker()}>打开文件夹</button>{/if}
      </div>
      <label class="template-select"><span>C++ 文件模板</span><select bind:value={selectedId} disabled={loadingTemplates || listener.listening || listener.busy || starting}>
        {#if loadingTemplates}<option value={undefined}>正在加载模板…</option>{/if}
        {#if listener.listening && listener.templateName}
          <option value={selectedId}>{templateLabel(listener.templateName)}</option>
        {:else}
          {#each templateStore.fileTemplates as template (template.id)}<option value={template.id}>{templateLabel(template.name)}</option>{/each}
        {/if}
      </select></label>
      <section class="import-guide" aria-label="油猴脚本安装方法"><strong>第一次使用</strong>
        <ol><li>在浏览器中安装 Tampermonkey（油猴）扩展。</li><li>开启监听，复制安装地址并在浏览器中打开，安装或更新脚本。也可复制脚本到油猴中保存。</li><li>刷新并显示 CF 或洛谷题目页，即会自动导入。也可点击页面上的“发送到 LightCP”。</li></ol>
        <div class="script-actions"><button class="secondary-button" disabled={!listener.listening} onclick={() => void copy(`http://127.0.0.1:${listener.port}/lightcp-codeforces.user.js`, "安装地址已复制，请在浏览器中打开。")}>复制安装地址</button><button class="secondary-button" onclick={() => void copy(userscript, "脚本已复制，请粘贴到油猴的“添加新脚本”并保存。")}>复制油猴脚本</button></div>
      </section>
      <p class="import-description">自动创建以题目名称命名的 .cpp 和 .md 文件，打开读题面板并导入样例。洛谷 CF 题优先使用中文翻译。同一来源的题目重复发送会打开已有文件。</p>
      {#if !loadingTemplates && !listener.ready}<p class="import-error" role="status">题目监听需要在 LightCP 桌面版中使用。</p>{/if}
      {#if localError || listener.error || templateStore.error}<p class="import-error" role="alert">{localError || listener.error || templateStore.error}</p>{/if}
      {#if listener.lastImported}<p class="last-imported">最近导入：{listener.lastImported}</p>{/if}
    </div>
    <footer><button class="secondary-button" onclick={close}>关闭</button>
      {#if listener.listening}<button class="danger-button" disabled={listener.busy} onclick={() => void listener.stop()}>{listener.busy ? "正在停止…" : "停止监听"}</button>
      {:else}<button class="primary-button" disabled={!listener.ready || !fileWorkspace.info || selectedId === undefined || listener.busy || starting || loadingTemplates} onclick={() => void start()}>{starting || listener.busy ? "正在开启…" : "开启监听"}</button>{/if}
    </footer>
  </div>
</div>

<style>
  .problem-import-dialog { width: min(540px, calc(100vw - 40px)); max-height: calc(100vh - 48px); padding: 22px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 18px; border: 1px solid var(--border-strong); border-radius: 12px; color: var(--text-primary); background: var(--background-elevated); box-shadow: 0 20px 60px #0005; font: var(--ui-font-size)/1.5 var(--ui-font); }
  .dialog-body { display: grid; gap: 18px; min-height: 0; overflow-y: auto; }
  header, footer, .script-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  header > div, .listener-state > div, .import-directory, .template-select { display: grid; gap: 6px; min-width: 0; }
  header strong { font-size: 18px; } header span, .listener-state span, .import-directory > span, .template-select > span { color: var(--text-secondary); font-size: var(--ui-font-small); }
  header > button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: var(--radius); color: var(--text-secondary); background: transparent; } header > button:hover { color: var(--text-primary); background: var(--hover-background); }
  .listener-state { display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-raised); }
  .listener-state.listening { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
  .listener-state strong { font-size: var(--ui-font-size); }
  .import-directory strong { font: 13px/1.5 var(--utility-font); overflow-wrap: anywhere; } .import-directory button { justify-self: start; }
  select { width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 5px; color: var(--text-primary); background: var(--input-background); }
  .import-guide { padding-top: 16px; border-top: 1px solid var(--border); font-size: var(--ui-font-small); line-height: 1.7; } .import-guide ol { margin: 8px 0 12px; padding-left: 22px; color: var(--text-secondary); } .import-guide li + li { margin-top: 5px; }
  .script-actions { justify-content: flex-start; flex-wrap: wrap; } .import-description, .last-imported { margin: 0; color: var(--text-secondary); font-size: var(--ui-font-small); line-height: 1.65; }
  .import-error { margin: 0; color: var(--danger); font-size: var(--ui-font-small); overflow-wrap: anywhere; }
  footer { padding-top: 16px; border-top: 1px solid var(--border); justify-content: flex-end; }
</style>
