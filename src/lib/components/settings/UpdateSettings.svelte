<script lang="ts">
  import { onMount } from "svelte";
  import { RELEASES_PAGE } from "../../api/updates";
  import { UpdatesStore } from "../../stores/updates.svelte";

  let { updates = new UpdatesStore() }: { updates?: UpdatesStore } = $props();
  const release = $derived(updates.result?.release);
  const available = $derived(updates.result?.status === "updateAvailable");
  const preview = $derived(updates.version.includes("-") && updates.version !== "读取失败");
  const status = $derived(
    updates.checking ? "正在检查最新版本…"
      : updates.error ? "暂时无法检查更新"
      : available ? `发现新版本 ${release?.version}`
      : updates.result?.status === "upToDate" ? "当前已是最新版本"
      : updates.result?.status === "noRelease" ? "暂无可用的发布版本"
      : "检查是否有新版本",
  );

  function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN");
  }

  onMount(() => { void updates.loadVersion(); });
</script>

<section class="update-settings" aria-label="关于与更新">
  <div class="update-product">
    <span class="update-monogram" aria-hidden="true">L</span>
    <div><h3>LightCP</h3><p>轻量的算法竞赛工作台</p></div>
  </div>

  <dl class="update-version">
    <div><dt>当前版本</dt><dd>{updates.version || "正在读取…"}</dd></div>
    <div><dt>更新渠道</dt><dd>{!updates.version || updates.version === "读取失败" ? "随当前版本确定" : preview ? "预览版与正式版" : "正式版"}</dd></div>
  </dl>

  <div class="update-check" aria-busy={updates.checking}>
    <div class="update-check-heading">
      <strong aria-live="polite" role="status">{status}</strong>
      <button class="primary-button" disabled={updates.checking} onclick={() => void updates.check()}>
        {updates.checking ? "检查中…" : updates.error ? "重新检查" : "检查更新"}
      </button>
    </div>
    {#if updates.error}
      <p class="update-error" role="alert">{updates.error}</p>
    {:else if updates.checkedAt}
      <p class="update-hint">上次检查：{updates.checkedAt.toLocaleString("zh-CN")}</p>
    {:else}
      <p class="update-hint">从官方 GitHub Releases 获取版本信息，无需登录。</p>
    {/if}

    {#if available && release}
      <div class="update-release">
        <div class="update-release-heading">
          <strong>{release.name || release.version}</strong>
          {#if release.prerelease}<span class="update-badge">预览版</span>{/if}
        </div>
        {#if release.publishedAt}<p class="update-hint">发布于 {formatDate(release.publishedAt)}</p>{/if}
        <div class="update-actions">
          {#if release.installerUrl}
            <button class="primary-button" disabled={updates.opening} onclick={() => void updates.open(release.installerUrl!)}>下载安装包</button>
          {/if}
          {#if release.portableUrl}
            <button class="secondary-button" disabled={updates.opening} onclick={() => void updates.open(release.portableUrl!)}>下载便携版</button>
          {/if}
          <button class="secondary-button" disabled={updates.opening} onclick={() => void updates.open(release.pageUrl)}>查看此版本</button>
        </div>
        {#if release.notes.trim()}
          <details class="update-notes"><summary>更新说明</summary><p>{release.notes}</p></details>
        {/if}
        <p class="update-hint">下载将通过浏览器打开。更新前请保存代码并退出 LightCP，再运行安装包或替换便携版。</p>
      </div>
    {/if}
  </div>

  <div class="update-footer">
    <button class="secondary-button" disabled={updates.opening} onclick={() => void updates.open(RELEASES_PAGE)}>打开版本发布页</button>
    <p class="update-hint">预览版同时检查预览版和正式版更新；正式版仅检查正式版更新。</p>
  </div>
  {#if updates.openError}<p class="update-error" role="alert">{updates.openError}</p>{/if}
</section>

<style>
  .update-settings { display: grid; gap: 22px; padding: 4px 0 20px; max-width: 680px; }
  .update-product { display: flex; align-items: center; gap: 14px; }
  .update-monogram { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px; background: var(--accent); color: var(--accent-contrast); font-size: 26px; font-weight: 700; }
  h3 { margin: 0; font-size: 20px; } p { margin: 6px 0 0; line-height: 1.6; }
  .update-product p, .update-hint, dt { color: var(--text-secondary); font-size: 12px; }
  .update-version { margin: 0; display: flex; flex-wrap: wrap; gap: 18px 44px; }
  .update-version div { display: grid; gap: 5px; } dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
  .update-check { padding: 18px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
  .update-check-heading { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; justify-content: space-between; }
  .update-check-heading strong { font-size: 14px; overflow-wrap: anywhere; }
  button { min-height: 32px; white-space: normal; }
  .update-error { color: var(--danger); font-size: 13px; overflow-wrap: anywhere; }
  .update-release { display: grid; gap: 12px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border); }
  .update-release p { margin: 0; }
  .update-release-heading, .update-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .update-release-heading strong { overflow-wrap: anywhere; }
  .update-badge { border: 1px solid var(--border); color: var(--accent); padding: 2px 7px; border-radius: 5px; font-size: 11px; }
  .update-notes summary { cursor: pointer; font-size: 13px; padding: 4px 0; }
  .update-notes p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; max-height: 280px; overflow-y: auto; margin-top: 8px; }
  .update-footer { display: grid; justify-items: start; gap: 6px; }
  @media (max-width: 520px) { .update-check { padding: 12px; } }
</style>
