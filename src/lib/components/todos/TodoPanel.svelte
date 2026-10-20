<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { openProblemTodoUrl } from "../../api/todos";
  import { TodoStore } from "../../stores/todos.svelte";
  import { problemUrl, type ProblemTodo } from "../../types/todo";
  import Icon from "../shell/Icon.svelte";

  const todos = new TodoStore();
  let title = $state("");
  let url = $state("");
  let notes = $state("");
  let editing = $state<ProblemTodo>();
  let filter = $state<"pending" | "completed" | "all">("pending");
  let search = $state("");
  let titleInput: HTMLInputElement;
  let pending = $derived(todos.items.filter((item) => !item.completed).length);
  let visible = $derived(todos.items.filter((item) =>
    (filter === "all" || item.completed === (filter === "completed"))
    && `${item.title} ${item.url} ${item.notes}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ).sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdAt - a.createdAt));

  onMount(() => { void todos.initialize(); });

  function clear(): void { editing = undefined; title = ""; url = ""; notes = ""; }
  function edit(todo: ProblemTodo): void {
    editing = todo; title = todo.title; url = todo.url; notes = todo.notes;
    titleInput?.focus();
  }
  async function submit(): Promise<void> {
    if (await todos.save(title, url, notes, editing)) {
      clear();
      titleInput?.focus();
    }
  }
  async function remove(todo: ProblemTodo): Promise<void> {
    if (await todos.remove(todo) && editing?.id === todo.id) clear();
  }
  function safeUrl(value: string): string | undefined {
    try { return problemUrl(value) || undefined; } catch { return undefined; }
  }
  async function openLink(event: MouseEvent, url: string): Promise<void> {
    if (!isTauri()) return;
    event.preventDefault();
    try { await openProblemTodoUrl(url); }
    catch { todos.error = "无法打开浏览器，请复制题目链接后手动打开。"; }
  }
</script>

<section class="todo-panel" aria-label="待刷题清单">
  <div class="todo-heading">
    <strong>先记下来，慢慢刷</strong>
    <span aria-live="polite">{pending} 道待刷 · 本机保存</span>
  </div>
  <form onsubmit={(event) => { event.preventDefault(); void submit(); }} aria-label={editing ? "编辑待办" : "添加待办"}>
    <label for="todo-title">{editing ? "编辑题目" : "题目名称或题号"}</label>
    <input id="todo-title" bind:this={titleInput} bind:value={title} maxlength="200" required placeholder="例如：洛谷 P1001" disabled={todos.loading || todos.busy} />
    <label for="todo-url">题目链接 <small>选填</small></label>
    <input id="todo-url" type="url" bind:value={url} maxlength="2048" placeholder="https://…" disabled={todos.busy} />
    <label for="todo-notes">备注 <small>选填</small></label>
    <textarea id="todo-notes" bind:value={notes} maxlength="2000" rows="2" placeholder="想练的算法、补题原因…" disabled={todos.busy}></textarea>
    <div class="todo-form-actions">
      <button class="primary-button" type="submit" disabled={todos.loading || todos.busy || !title.trim()}>
        <Icon name={editing ? "check" : "plus"} size={15} />{todos.busy ? "正在保存…" : editing ? "保存修改" : "加入待办"}
      </button>
      {#if editing}<button class="secondary-button" type="button" onclick={clear} disabled={todos.busy}>取消</button>{/if}
    </div>
  </form>
  {#if todos.error}
    <div class="todo-error" role="alert">{todos.error}
      {#if todos.loading === false && !todos.items.length}<button class="text-button" onclick={() => void todos.initialize()}>重新加载</button>{/if}
    </div>
  {/if}
  {#if todos.deleted}
    <div class="todo-undo" role="status"><span>已删除「{todos.deleted.title}」</span><button class="text-button" onclick={() => void todos.undoDelete()} disabled={todos.busy}>撤销</button></div>
  {/if}
  <div class="todo-filters" role="group" aria-label="待办筛选">
    {#each [{ id: "pending", label: "待刷" }, { id: "completed", label: "已完成" }, { id: "all", label: "全部" }] as item}
      <button class:active={filter === item.id} aria-pressed={filter === item.id} onclick={() => filter = item.id as typeof filter}>{item.label}</button>
    {/each}
  </div>
  <input class="todo-search" aria-label="搜索待办" type="search" bind:value={search} placeholder="搜索题目或备注" />
  {#if todos.loading}
    <p class="todo-empty" role="status">正在读取待办…</p>
  {:else if !visible.length}
    <p class="todo-empty">{search ? "没有匹配的题目" : filter === "completed" ? "还没有已完成的题目" : filter === "pending" ? "暂时没有待刷题目，先记下一道吧。" : "想刷的题目，都可以记在这里。"}</p>
  {:else}
    <ul class="todo-list">
      {#each visible as todo (todo.id)}
        <li class:completed={todo.completed}>
          <div class="todo-item-heading">
            <button class="todo-check" class:checked={todo.completed} aria-label={`${todo.completed ? "恢复待刷" : "标记完成"}：${todo.title}`} aria-pressed={todo.completed} disabled={todos.busy} onclick={() => void todos.toggle(todo)}>
              {#if todo.completed}<Icon name="check" size={14} />{/if}
            </button>
            <strong>{todo.title}</strong>
          </div>
          {#if todo.notes}<p class="todo-notes">{todo.notes}</p>{/if}
          <div class="todo-item-actions">
            {#if safeUrl(todo.url)}<a href={safeUrl(todo.url)} target="_blank" rel="noopener noreferrer" onclick={(event) => void openLink(event, todo.url)}>打开题目 ↗</a>{/if}
            <button aria-label={`编辑：${todo.title}`} title="编辑待办" onclick={() => edit(todo)} disabled={todos.busy}><Icon name="edit" size={15} /></button>
            <button aria-label={`删除：${todo.title}`} title="删除待办" onclick={() => void remove(todo)} disabled={todos.busy}><Icon name="trash" size={15} /></button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .todo-panel { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding: 4px 12px 16px; }
  .todo-heading { display: grid; gap: 5px; }
  .todo-heading strong { font-size: 14px; }
  .todo-heading span, small, .todo-empty { color: var(--text-secondary); font-size: 12px; }
  form { display: flex; flex-direction: column; gap: 7px; }
  label { font-size: 12px; margin-top: 3px; }
  small { font-weight: normal; margin-left: 4px; }
  input, textarea { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--border); border-radius: 5px; padding: 8px; background: var(--input-background); color: var(--text-primary); font: inherit; font-size: 12px; }
  textarea { resize: vertical; min-height: 58px; }
  button, a { border-radius: 4px; }
  button { cursor: pointer; }
  button:disabled { cursor: default; opacity: .55; }
  input:focus-visible, textarea:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .todo-form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 3px; }
  .todo-form-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 32px; padding: 6px 10px; font-size: 12px; }
  .todo-error { color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
  .todo-undo { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .todo-undo span { min-width: 0; overflow-wrap: anywhere; }
  .todo-filters { display: flex; gap: 4px; border-bottom: 1px solid var(--border); padding-bottom: 7px; }
  .todo-filters button { flex: 1; min-height: 30px; border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; }
  .todo-filters button.active { color: var(--accent); background: var(--active-background); }
  .todo-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .todo-list li { padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--background-elevated); min-width: 0; }
  .todo-item-heading { display: flex; align-items: flex-start; gap: 8px; }
  .todo-item-heading strong { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; min-width: 0; }
  .completed strong { color: var(--text-secondary); text-decoration: line-through; }
  .todo-check { flex-shrink: 0; display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--border-strong); background: transparent; color: var(--accent); }
  .todo-check.checked { border-color: var(--accent); background: var(--active-background); }
  .todo-notes { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
  .todo-item-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 8px; }
  .todo-item-actions a { margin-right: auto; font-size: 12px; color: var(--accent); text-decoration: none; padding: 5px 0; }
  .todo-item-actions button { width: 30px; height: 30px; display: grid; place-items: center; border: 0; background: transparent; color: var(--text-secondary); }
  .todo-item-actions button:hover, .todo-filters button:hover { background: var(--hover-background); color: var(--text-primary); }
  .todo-empty { line-height: 1.7; text-align: center; margin: 6px 0; }
</style>
