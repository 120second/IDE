import { deleteProblemTodo, listProblemTodos, saveProblemTodo } from "../api/todos";
import { problemUrl, type ProblemTodo } from "../types/todo";

export class TodoStore {
  items = $state<ProblemTodo[]>([]);
  loading = $state(true);
  busy = $state(false);
  error = $state("");
  deleted = $state<ProblemTodo>();

  async initialize(): Promise<void> {
    this.loading = true;
    this.error = "";
    try { this.items = await listProblemTodos(); }
    catch (error) { this.error = message(error); }
    finally { this.loading = false; }
  }

  async save(title: string, url: string, notes: string, existing?: ProblemTodo): Promise<boolean> {
    return this.mutate(async () => {
      title = title.trim();
      if (!title) throw new Error("请填写题目名称或题号。");
      if (title.length > 200 || notes.length > 2000 || url.length > 2048) throw new Error("内容过长，请缩短题目名称、链接或备注。");
      if (existing) existing = this.items.find((item) => item.id === existing?.id) ?? existing;
      const todo = await saveProblemTodo({
        id: existing?.id ?? crypto.randomUUID(), title, url: problemUrl(url), notes: notes.trim(),
        completed: existing?.completed ?? false, createdAt: existing?.createdAt ?? Date.now(),
      });
      this.items = [todo, ...this.items.filter((item) => item.id !== todo.id)];
    });
  }

  async toggle(todo: ProblemTodo): Promise<boolean> {
    return this.mutate(async () => {
      const saved = await saveProblemTodo({ ...todo, completed: !todo.completed });
      this.items = this.items.map((item) => item.id === saved.id ? saved : item);
    });
  }

  async remove(todo: ProblemTodo): Promise<boolean> {
    return this.mutate(async () => {
      await deleteProblemTodo(todo.id);
      this.items = this.items.filter((item) => item.id !== todo.id);
      this.deleted = todo;
    });
  }

  async undoDelete(): Promise<boolean> {
    const todo = this.deleted;
    if (!todo) return false;
    return this.mutate(async () => {
      const saved = await saveProblemTodo(todo);
      this.items = [saved, ...this.items.filter((item) => item.id !== saved.id)];
      this.deleted = undefined;
    });
  }

  private async mutate(action: () => Promise<void>): Promise<boolean> {
    if (this.busy || this.loading) return false;
    this.busy = true;
    this.error = "";
    try { await action(); return true; }
    catch (error) { this.error = message(error); return false; }
    finally { this.busy = false; }
  }
}

function message(error: unknown): string {
  if (error && typeof error === "object" && "userMessage" in error) return String(error.userMessage);
  return error instanceof Error ? error.message : String(error);
}
