<script lang="ts">
  import type { AuthStore } from "../../stores/auth.svelte";

  interface Props {
    auth: AuthStore;
  }

  let { auth }: Props = $props();
  let identifier = $state("");
  let username = $state("");
  let email = $state("");
  let password = $state("");
  let passwordConfirm = $state("");
  let code = $state("");
  let localError = $state("");

  async function submitLogin(): Promise<void> {
    localError = "";
    if (!identifier.trim() || !password) {
      localError = "请输入用户名或邮箱和密码。";
      return;
    }
    await auth.signIn(identifier.trim(), password);
  }

  async function submitRegister(): Promise<void> {
    localError = validatePasswordConfirmation();
    if (localError) return;
    await auth.signUp(username.trim(), email.trim(), password);
  }

  async function submitForgot(): Promise<void> {
    localError = "";
    if (!email.trim()) {
      localError = "请输入注册邮箱。";
      return;
    }
    await auth.sendResetCode(email.trim());
  }

  async function submitReset(): Promise<void> {
    localError = validatePasswordConfirmation();
    if (localError) return;
    if (!/^\d{6}$/.test(code)) {
      localError = "验证码应为 6 位数字。";
      return;
    }
    await auth.completeReset((email || auth.resetEmail).trim(), code, password);
  }

  function validatePasswordConfirmation(): string {
    if (password.length < 8 || password.length > 128) return "密码长度必须为 8 到 128 个字符。";
    if (password !== passwordConfirm) return "两次输入的密码不一致。";
    return "";
  }

  function switchScreen(screen: "login" | "register" | "forgot" | "reset"): void {
    localError = "";
    password = "";
    passwordConfirm = "";
    code = "";
    if (screen === "reset" && !email) email = auth.resetEmail;
    auth.show(screen);
  }
</script>

<main class="auth-surface">
  <section class="auth-intro" aria-labelledby="auth-product-title">
    <div class="auth-product-mark" aria-hidden="true">L</div>
    <p class="auth-eyebrow">LIGHTCP CLOUD</p>
    <h1 id="auth-product-title">你的模板，随账号同步</h1>
    <p>登录后继续使用 LightCP。模板由服务器保存，在另一台电脑登录同一账号即可获取最新内容。</p>
    <ul aria-label="账号功能">
      <li><span aria-hidden="true"></span>密码使用 Argon2id 安全哈希</li>
      <li><span aria-hidden="true"></span>登录凭据保存到系统凭据库</li>
      <li><span aria-hidden="true"></span>客户端只通过 HTTPS API 访问服务器</li>
    </ul>
  </section>

  <section class="auth-card" aria-labelledby="auth-form-title">
    <div class="auth-card-heading">
      <p>{auth.screen === "login" ? "欢迎回来" : auth.screen === "register" ? "创建账号" : "找回账号"}</p>
      <h2 id="auth-form-title">
        {auth.screen === "login" ? "登录 LightCP" : auth.screen === "register" ? "注册 LightCP" : auth.screen === "forgot" ? "获取验证码" : "设置新密码"}
      </h2>
    </div>

    {#if auth.notice}
      <div class="auth-message success" role="status">{auth.notice}</div>
    {/if}
    {#if localError || auth.error}
      <div class="auth-message error" role="alert">{localError || auth.error}</div>
    {/if}

    {#if auth.screen === "login"}
      <form onsubmit={(event) => { event.preventDefault(); void submitLogin(); }}>
        <label for="login-identifier">用户名或邮箱</label>
        <input id="login-identifier" bind:value={identifier} autocomplete="username" maxlength="254" spellcheck="false" required />

        <div class="auth-label-row">
          <label for="login-password">密码</label>
          <button type="button" class="auth-text-button" onclick={() => switchScreen("forgot")}>忘记密码？</button>
        </div>
        <input id="login-password" type="password" bind:value={password} autocomplete="current-password" maxlength="128" required />

        <button class="auth-submit" type="submit" disabled={auth.submitting}>
          {auth.submitting ? "正在登录…" : "登录"}
        </button>
      </form>
      <p class="auth-switch">还没有账号？<button type="button" onclick={() => switchScreen("register")}>创建账号</button></p>
    {:else if auth.screen === "register"}
      <form onsubmit={(event) => { event.preventDefault(); void submitRegister(); }}>
        <label for="register-username">用户名</label>
        <input id="register-username" bind:value={username} autocomplete="username" minlength="3" maxlength="32" spellcheck="false" required />

        <label for="register-email">邮箱</label>
        <input id="register-email" type="email" bind:value={email} autocomplete="email" maxlength="254" spellcheck="false" required />

        <label for="register-password">密码</label>
        <input id="register-password" type="password" bind:value={password} autocomplete="new-password" minlength="8" maxlength="128" required />

        <label for="register-confirm">确认密码</label>
        <input id="register-confirm" type="password" bind:value={passwordConfirm} autocomplete="new-password" minlength="8" maxlength="128" required />

        <button class="auth-submit" type="submit" disabled={auth.submitting}>
          {auth.submitting ? "正在创建…" : "创建账号"}
        </button>
      </form>
      <p class="auth-switch">已有账号？<button type="button" onclick={() => switchScreen("login")}>返回登录</button></p>
    {:else if auth.screen === "forgot"}
      <form onsubmit={(event) => { event.preventDefault(); void submitForgot(); }}>
        <p class="auth-helper">输入注册邮箱。如果账号存在，我们会发送一封包含 6 位验证码的邮件。</p>
        <label for="forgot-email">注册邮箱</label>
        <input id="forgot-email" type="email" bind:value={email} autocomplete="email" maxlength="254" spellcheck="false" required />
        <button class="auth-submit" type="submit" disabled={auth.submitting}>
          {auth.submitting ? "正在发送…" : "发送验证码"}
        </button>
      </form>
      <p class="auth-switch"><button type="button" onclick={() => switchScreen("login")}>返回登录</button></p>
    {:else}
      <form onsubmit={(event) => { event.preventDefault(); void submitReset(); }}>
        <label for="reset-email">注册邮箱</label>
        <input id="reset-email" type="email" bind:value={email} autocomplete="email" maxlength="254" spellcheck="false" required />

        <label for="reset-code">邮箱验证码</label>
        <input id="reset-code" class="auth-code" inputmode="numeric" bind:value={code} autocomplete="one-time-code" minlength="6" maxlength="6" pattern="[0-9]{6}" required />

        <label for="reset-password">新密码</label>
        <input id="reset-password" type="password" bind:value={password} autocomplete="new-password" minlength="8" maxlength="128" required />

        <label for="reset-confirm">确认新密码</label>
        <input id="reset-confirm" type="password" bind:value={passwordConfirm} autocomplete="new-password" minlength="8" maxlength="128" required />

        <button class="auth-submit" type="submit" disabled={auth.submitting}>
          {auth.submitting ? "正在重置…" : "重置密码"}
        </button>
      </form>
      <div class="auth-switch auth-switch-spread">
        <button type="button" onclick={() => switchScreen("forgot")}>重新发送</button>
        <button type="button" onclick={() => switchScreen("login")}>返回登录</button>
      </div>
    {/if}
  </section>
</main>
