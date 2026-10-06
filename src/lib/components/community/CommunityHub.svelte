<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import type { AuthStore } from "../../stores/auth.svelte";
  import { CommunityStore } from "../../stores/community.svelte";
  import type { ShellStore } from "../../stores/shell.svelte";
  import type { UxStore } from "../../stores/ux.svelte";
  import type { CommunityUser } from "../../types/community";
  import Icon from "../shell/Icon.svelte";
  import CommunityAvatar from "./CommunityAvatar.svelte";

  interface Props {
    auth: AuthStore;
    shell: ShellStore;
    ux: UxStore;
  }

  let { auth, shell, ux }: Props = $props();
  const community = new CommunityStore(() => auth);
  let section = $state<"profile" | "messages">("profile");
  let editing = $state(false);
  let displayName = $state("");
  let bio = $state("");
  let location = $state("");
  let avatarDataUrl = $state("");
  let searchQuery = $state("");
  let draft = $state("");
  let avatarBusy = $state(false);
  let profileForUser = $state("");
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let messageList = $state<HTMLDivElement>();
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  let visiblePeople = $derived(
    searchQuery.trim()
      ? community.searchResults.map((user) => ({ user, unreadCount: 0, lastMessage: undefined }))
      : community.conversations,
  );
  let memberDays = $derived(auth.user ? Math.max(1, Math.ceil((Date.now() - new Date(auth.user.createdAt).getTime()) / 86_400_000)) : 0);
  let unreadTotal = $derived(community.conversations.reduce((sum, item) => sum + item.unreadCount, 0));
  let selectedUser = $derived(community.selectedUser);

  $effect(() => {
    const user = auth.user;
    if (!user) {
      profileForUser = "";
      untrack(() => community.reset());
      return;
    }
    if (profileForUser !== user.id) {
      profileForUser = user.id;
      displayName = user.displayName;
      bio = user.bio;
      location = user.location;
      avatarDataUrl = user.avatarDataUrl;
      untrack(() => void community.initialize());
    }
  });

  onMount(() => {
    pollTimer = setInterval(() => {
      if (section === "messages" && document.visibilityState === "visible") void community.refreshMessages();
    }, 5_000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (searchTimer) clearTimeout(searchTimer);
  });

  function showSection(next: typeof section): void {
    section = next;
    if (next === "messages" && auth.user) void community.refreshConversations();
  }

  function beginEditing(): void {
    const user = auth.user;
    if (!user) return;
    displayName = user.displayName;
    bio = user.bio;
    location = user.location;
    avatarDataUrl = user.avatarDataUrl;
    editing = true;
  }

  async function saveProfile(): Promise<void> {
    const saved = await community.saveProfile({ displayName, bio, location, avatarDataUrl });
    if (!saved) return;
    editing = false;
    ux.success("个人主页已更新。");
  }

  function searchPeople(): void {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void community.search(searchQuery), 220);
  }

  async function openConversation(user: CommunityUser): Promise<void> {
    await community.openConversation(user);
    searchQuery = "";
    community.searchResults = [];
    await scrollMessages();
  }

  async function sendMessage(): Promise<void> {
    const text = draft;
    if (!(await community.send(text))) return;
    draft = "";
    await scrollMessages();
  }

  function composerKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void sendMessage();
  }

  async function scrollMessages(): Promise<void> {
    await tick();
    messageList?.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  }

  async function chooseAvatar(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      ux.error("请选择 PNG、JPEG 或 WebP 图片。");
      return;
    }
    avatarBusy = true;
    try {
      avatarDataUrl = await compressAvatar(file);
    } catch (error) {
      ux.error(error instanceof Error ? error.message : "无法读取这张图片。");
    } finally {
      avatarBusy = false;
    }
  }

  function formatTime(value: string): string {
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
    }
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
  }

  function formatMessageTime(value: string): string {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  }

  function displayLabel(user: CommunityUser): string {
    return user.displayName || user.username;
  }

  async function compressAvatar(file: File): Promise<string> {
    const source = await readFile(file);
    const image = await loadImage(source);
    const canvas = document.createElement("canvas");
    const size = 320;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法处理头像。");
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    for (const quality of [0.86, 0.72, 0.58, 0.44]) {
      const result = canvas.toDataURL("image/webp", quality);
      if (result.length < 340_000) return result;
    }
    throw new Error("图片压缩后仍然过大，请换一张图片。");
  }

  function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取这张图片。"));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片内容无效。"));
      image.src = source;
    });
  }
</script>

<section class="community-hub" aria-label="LightCP 社区">
  <header class="community-topbar">
    <div class="community-title">
      <span class="community-title-mark" aria-hidden="true">&lt;/&gt;</span>
      <div><strong>LightCP 社区</strong><span>和一起写代码的人保持联系</span></div>
    </div>
    {#if auth.user}
      <nav class="community-tabs" aria-label="社区页面">
        <button class:active={section === "profile"} aria-current={section === "profile" ? "page" : undefined} onclick={() => showSection("profile")}>
          <Icon name="user" size={16} />个人主页
        </button>
        <button class:active={section === "messages"} aria-current={section === "messages" ? "page" : undefined} onclick={() => showSection("messages")}>
          <Icon name="message" size={16} />消息
          {#if unreadTotal}<span class="community-tab-badge" aria-label={`${unreadTotal} 条未读消息`}>{unreadTotal > 99 ? "99+" : unreadTotal}</span>{/if}
        </button>
      </nav>
      <CommunityAvatar username={auth.user.username} displayName={auth.user.displayName} avatarDataUrl={auth.user.avatarDataUrl} size="small" />
    {/if}
  </header>

  {#if !auth.user}
    <div class="community-login-state">
      <div class="community-login-art" aria-hidden="true"><span>&lt;</span><span>/</span><span>&gt;</span></div>
      <p class="community-eyebrow">LIGHTCP COMMUNITY</p>
      <h1>代码之外，也有人与你同行。</h1>
      <p>登录后完善你的个人主页，找到其他 LightCP 用户，并通过私信交流思路。</p>
      <button class="community-primary-button" onclick={() => shell.openSettings("account")}><Icon name="user" size={17} />登录或创建账号</button>
      <span>编辑器、本地模板和编译功能仍可离线使用。</span>
    </div>
  {:else if section === "profile"}
    <div class="community-scroll-area">
      <div class="profile-page">
        <section class="profile-hero">
          <div class="profile-codeprint" aria-hidden="true"><span>public:</span><strong>{auth.user.username}</strong><span>build · learn · share</span></div>
          <div class="profile-identity">
            <div class="profile-avatar-wrap">
              <CommunityAvatar username={auth.user.username} displayName={editing ? displayName : auth.user.displayName} avatarDataUrl={editing ? avatarDataUrl : auth.user.avatarDataUrl} size="large" />
              {#if editing}
                <label class="avatar-upload-button" title="更换头像">
                  <Icon name="camera" size={16} />
                  <span class="visually-hidden">选择头像</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onchange={(event) => void chooseAvatar(event)} />
                </label>
              {/if}
            </div>
            <div class="profile-heading">
              <span class="profile-status"><i></i>已连接云端</span>
              <h1>{auth.user.displayName || auth.user.username}</h1>
              <p>@{auth.user.username}</p>
            </div>
            {#if !editing}
              <button class="community-secondary-button profile-edit-button" onclick={beginEditing}><Icon name="edit" size={15} />编辑主页</button>
            {/if}
          </div>
        </section>

        <div class="profile-grid">
          <section class="profile-main-card">
            {#if editing}
              <form class="profile-form" onsubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
                <div class="profile-form-heading"><div><strong>编辑个人主页</strong><p>这些信息会展示给社区中的其他用户。</p></div><span>{bio.length}/280</span></div>
                <label><span>显示名称</span><input bind:value={displayName} maxlength="48" placeholder={auth.user.username} /></label>
                <label><span>个人简介</span><textarea bind:value={bio} maxlength="280" rows="4" placeholder="分享你的方向、目标或正在学习的内容"></textarea></label>
                <label><span>所在地</span><input bind:value={location} maxlength="80" placeholder="例如：杭州" /></label>
                <div class="profile-form-actions">
                  <button type="button" class="community-ghost-button" onclick={() => (editing = false)}>取消</button>
                  <button type="submit" class="community-primary-button" disabled={community.savingProfile || avatarBusy}>{community.savingProfile ? "正在保存…" : avatarBusy ? "正在处理头像…" : "保存更改"}</button>
                </div>
              </form>
            {:else}
              <p class="profile-card-label">关于我</p>
              {#if auth.user.bio}<p class="profile-bio">{auth.user.bio}</p>{:else}<p class="profile-empty-copy">还没有个人简介。写几句话，让其他人更容易认识你。</p>{/if}
              <div class="profile-meta">
                <span><Icon name="map-pin" size={15} />{auth.user.location || "未填写所在地"}</span>
                <span><Icon name="clock" size={15} />加入于 {new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(new Date(auth.user.createdAt))}</span>
              </div>
            {/if}
          </section>

          <aside class="profile-side-column">
            <section class="profile-stats-card">
              <div><strong>{memberDays}</strong><span>加入天数</span></div>
              <div><strong>{community.conversations.length}</strong><span>对话伙伴</span></div>
            </section>
            <section class="profile-account-card">
              <p class="profile-card-label">账户</p>
              <strong>{auth.user.email}</strong>
              <span>邮箱仅自己可见</span>
              <button class="community-ghost-button" onclick={() => shell.openSettings("account")}>账户与云同步 <Icon name="chevron-right" size={14} /></button>
            </section>
          </aside>
        </div>
      </div>
    </div>
  {:else}
    <div class:conversation-open={Boolean(community.selectedUser)} class="chat-layout">
      <aside class="conversation-panel" aria-label="会话列表">
        <div class="conversation-heading"><div><strong>消息</strong><span>{unreadTotal ? `${unreadTotal} 条未读` : "保持联系，交换思路"}</span></div><button title="刷新会话" aria-label="刷新会话" onclick={() => void community.refreshConversations()}><Icon name="refresh" size={16} /></button></div>
        <label class="people-search"><Icon name="search" size={15} /><span class="visually-hidden">搜索用户</span><input bind:value={searchQuery} oninput={searchPeople} placeholder="搜索用户名或昵称" /></label>
        <div class="conversation-list">
          {#if community.loading}
            <p class="community-list-state">正在加载会话…</p>
          {:else if visiblePeople.length === 0}
            <div class="community-list-state"><Icon name="message" size={24} /><strong>{searchQuery ? "没有找到用户" : "还没有消息"}</strong><span>{searchQuery ? "试试输入完整用户名。" : "在上方搜索用户，开始第一次对话。"}</span></div>
          {:else}
            {#each visiblePeople as item (item.user.id)}
              <button class:active={community.selectedUser?.id === item.user.id} class="conversation-item" onclick={() => void openConversation(item.user)}>
                <CommunityAvatar username={item.user.username} displayName={item.user.displayName} avatarDataUrl={item.user.avatarDataUrl} />
                <span class="conversation-copy"><span><strong>{displayLabel(item.user)}</strong>{#if item.lastMessage}<time>{formatTime(item.lastMessage.createdAt)}</time>{/if}</span><small>{item.lastMessage?.body || item.user.bio || `@${item.user.username}`}</small></span>
                {#if item.unreadCount}<span class="conversation-unread" aria-label={`${item.unreadCount} 条未读`}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</span>{/if}
              </button>
            {/each}
          {/if}
        </div>
      </aside>

      <section class="message-panel" aria-label="聊天内容">
        {#if selectedUser}
          <header class="message-header">
            <button class="message-back" aria-label="返回会话列表" onclick={() => (community.selectedUser = undefined)}><Icon name="chevron-left" size={18} /></button>
            <CommunityAvatar username={selectedUser.username} displayName={selectedUser.displayName} avatarDataUrl={selectedUser.avatarDataUrl} size="small" />
            <div><strong>{displayLabel(selectedUser)}</strong><span>@{selectedUser.username}{selectedUser.location ? ` · ${selectedUser.location}` : ""}</span></div>
          </header>
          <div class="message-list" bind:this={messageList} aria-live="polite">
            {#if community.messagesLoading}
              <p class="message-state">正在加载消息…</p>
            {:else if community.messages.length === 0}
              <div class="message-empty"><div aria-hidden="true">&lt;/&gt;</div><strong>从一句你好开始</strong><span>你们的消息只会出现在这个对话中。</span></div>
            {:else}
              <div class="message-day-marker">最近的消息</div>
              {#each community.messages as message (message.id)}
                <div class:mine={message.senderId === auth.user.id} class="message-row">
                  <div class="message-bubble"><p>{message.body}</p><time>{formatMessageTime(message.createdAt)}</time></div>
                </div>
              {/each}
            {/if}
          </div>
          <form class="message-composer" onsubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <textarea bind:value={draft} onkeydown={composerKeydown} maxlength="2000" rows="1" placeholder={`发消息给 ${displayLabel(selectedUser)}…`} aria-label="消息内容"></textarea>
            <button type="submit" disabled={!draft.trim() || community.sending} aria-label="发送消息" title="发送 · Enter"><Icon name="send" size={18} /></button>
            <span>Enter 发送 · Shift+Enter 换行</span>
          </form>
        {:else}
          <div class="message-welcome"><div class="message-welcome-mark" aria-hidden="true"><Icon name="message" size={34} /></div><p class="community-eyebrow">DIRECT MESSAGES</p><h2>选择一段对话</h2><span>从左侧会话继续交流，或搜索一个用户开始聊天。</span></div>
        {/if}
      </section>
    </div>
  {/if}

  {#if community.error}<div class="community-error" role="alert"><Icon name="warning" size={15} />{community.error}<button aria-label="关闭错误" onclick={() => (community.error = "")}><Icon name="close" size={13} /></button></div>{/if}
</section>
