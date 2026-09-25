<script lang="ts">
  import { importLocalTemplatesToCloud, syncCloudTemplatesToLocal } from "../../api/cloudTemplates";
  import type { AuthStore } from "../../stores/auth.svelte";
  import type { TemplateStore } from "../../stores/templates.svelte";
  import type { UxStore } from "../../stores/ux.svelte";

  interface Props {
    auth: AuthStore;
    templateStore: TemplateStore;
    ux: UxStore;
  }

  let { auth, templateStore, ux }: Props = $props();
  let mode = $state<"login" | "register" | "forgot" | "reset">("login");
  let identifier = $state("");
  let username = $state("");
  let email = $state("");
  let password = $state("");
  let resetCode = $state("");
  let transfer = $state<"upload" | "download">();
  let transferNotice = $state("");
  let transferError = $state("");

  let connectionLabel = $derived(
    auth.connection === "checking"
      ? "正在检查云服务"
      : auth.connection === "online"
        ? "云服务可连接"
        : "当前离线，本地功能不受影响",
  );

  function switchMode(next: typeof mode): void {
    mode = next;
    auth.error = "";
    auth.notice = "";
  }

  async function submit(): Promise<void> {
    if (mode === "login") {
      await auth.signIn(identifier, password);
    } else if (mode === "register") {
      await auth.signUp(username, email, password);
    } else if (mode === "forgot") {
      if (await auth.sendResetCode(email)) mode = "reset";
    } else {
      if (await auth.completeReset(email || auth.resetEmail, resetCode, password)) mode = "login";
    }
  }

  async function runTransfer(direction: "upload" | "download"): Promise<void> {
    if (transfer) return;
    transfer = direction;
    transferNotice = "";
    transferError = "";
    try {
      const result = direction === "upload"
        ? await importLocalTemplatesToCloud()
        : await syncCloudTemplatesToLocal();
      const action = direction === "upload" ? "上传" : "同步到本地";
      transferNotice = `${action}完成：新增 ${result.templatesCreated} 个模板，跳过 ${result.templatesSkipped} 个相同模板。`;
      if (direction === "download" && templateStore.storage === "local") await templateStore.reload();
      if (direction === "upload" && templateStore.storage === "cloud") await templateStore.reload();
      ux.success(transferNotice);
    } catch (error) {
      transferError = errorMessage(error);
    } finally {
      transfer = undefined;
    }
  }

  function errorMessage(error: unknown): string {
    if (typeof error === "object" && error) {
      const commandError = error as { userMessage?: unknown; technicalMessage?: unknown };
      if (typeof commandError.userMessage === "string") return commandError.userMessage;
      if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
    }
    return error instanceof Error ? error.message : String(error);
  }
</script>

<section class="settings-section account-settings" aria-label="账户与云同步">
  <div class="offline-first-card">
    <span class="offline-mark" aria-hidden="true">L</span>
    <div>
      <strong>本地模式始终可用</strong>
      <p>代码编辑、编译、测试点和本地模板都不需要登录，也不依赖网络。</p>
    </div>
    <span class:online={auth.connection === "online"} class="connection-state">{connectionLabel}</span>
  </div>

  {#if auth.user}
    <div class="account-card">
      <div class="account-identity">
        <span class="account-avatar" aria-hidden="true">{auth.user.username.slice(0, 1).toUpperCase()}</span>
        <div><strong>{auth.user.username}</strong><small>{auth.user.email}</small></div>
      </div>
      <button class="secondary-button compact-button" onclick={() => void auth.signOut()}>退出登录</button>
    </div>

    <div class="cloud-sync-card">
      <div class="cloud-sync-heading">
        <div><strong>模板同步</strong><p>本地与云端分开保存。同步只新增缺少的模板，不会删除或覆盖现有内容。</p></div>
      </div>
      <div class="cloud-sync-actions">
        <button class="primary-button" disabled={Boolean(transfer)} onclick={() => void runTransfer("upload")}>
          {transfer === "upload" ? "正在上传…" : "上传本地到云端"}
        </button>
        <button class="secondary-button" disabled={Boolean(transfer)} onclick={() => void runTransfer("download")}>
          {transfer === "download" ? "正在同步…" : "同步云端到本地"}
        </button>
      </div>
      {#if transferNotice}<p class="account-notice" role="status">{transferNotice}</p>{/if}
      {#if transferError}<p class="account-error" role="alert">{transferError}</p>{/if}
    </div>
  {:else}
    <div class="account-login-card">
      <div class="account-login-heading">
        <div><strong>{mode === "register" ? "创建云端账户" : mode === "forgot" || mode === "reset" ? "找回密码" : "登录云端"}</strong><p>仅在需要云端模板时登录。</p></div>
        {#if mode === "login"}<button class="text-button" onclick={() => switchMode("register")}>创建账户</button>{/if}
      </div>

      <form class="account-login-form" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
        {#if mode === "login"}
          <label><span>用户名或邮箱</span><input required bind:value={identifier} autocomplete="username" /></label>
          <label><span>密码</span><input required type="password" bind:value={password} autocomplete="current-password" /></label>
        {:else if mode === "register"}
          <label><span>用户名</span><input required bind:value={username} autocomplete="username" /></label>
          <label><span>邮箱</span><input required type="email" bind:value={email} autocomplete="email" /></label>
          <label><span>密码</span><input required type="password" bind:value={password} autocomplete="new-password" /></label>
        {:else if mode === "forgot"}
          <label><span>邮箱</span><input required type="email" bind:value={email} autocomplete="email" /></label>
        {:else}
          <label><span>邮箱</span><input required type="email" bind:value={email} autocomplete="email" /></label>
          <label><span>验证码</span><input required bind:value={resetCode} inputmode="numeric" autocomplete="one-time-code" /></label>
          <label><span>新密码</span><input required type="password" bind:value={password} autocomplete="new-password" /></label>
        {/if}

        {#if auth.error}<p class="account-error" role="alert">{auth.error}</p>{/if}
        {#if auth.notice}<p class="account-notice" role="status">{auth.notice}</p>{/if}

        <div class="account-form-actions">
          <button class="primary-button" type="submit" disabled={auth.submitting}>
            {auth.submitting ? "请稍候…" : mode === "login" ? "登录" : mode === "register" ? "创建账户" : mode === "forgot" ? "发送验证码" : "重置密码"}
          </button>
          {#if mode === "login"}
            <button class="text-button" type="button" onclick={() => switchMode("forgot")}>忘记密码</button>
          {:else}
            <button class="text-button" type="button" onclick={() => switchMode("login")}>返回登录</button>
          {/if}
        </div>
      </form>
    </div>
  {/if}
</section>
