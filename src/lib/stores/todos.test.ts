import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemTodo } from "../types/todo";

const api = vi.hoisted(() => ({ listProblemTodos: vi.fn(), saveProblemTodo: vi.fn(), deleteProblemTodo: vi.fn() }));
vi.mock("../api/todos", () => api);
import { TodoStore } from "./todos.svelte";

const todo: ProblemTodo = { id: "first", title: "P1001", url: "https://www.luogu.com.cn/problem/P1001", notes: "边界", completed: false, createdAt: 1 };

describe("problem todos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listProblemTodos.mockResolvedValue([{ ...todo }]);
    api.saveProblemTodo.mockImplementation(async (item) => ({ ...item }));
    api.deleteProblemTodo.mockResolvedValue(undefined);
  });

  it("loads saved items, adds a problem, and marks it completed", async () => {
    const store = new TodoStore();
    await store.initialize();
    expect(store.items).toEqual([todo]);
    expect(await store.save(" CF 4A ", "", "DP")).toBe(true);
    expect(store.items[0].title).toBe("CF 4A");
    expect(await store.toggle(store.items[0])).toBe(true);
    expect(store.items[0].completed).toBe(true);
  });

  it("retains items when persistence fails and supports undo after deletion", async () => {
    const store = new TodoStore();
    await store.initialize();
    api.deleteProblemTodo.mockRejectedValueOnce(new Error("disk full"));
    expect(await store.remove(todo)).toBe(false);
    expect(store.items).toHaveLength(1);
    expect(store.error).toBe("disk full");
    expect(await store.remove(todo)).toBe(true);
    expect(store.items).toHaveLength(0);
    expect(await store.undoDelete()).toBe(true);
    expect(store.items).toEqual([todo]);
  });

  it("rejects unsafe links and blank titles without persisting them", async () => {
    const store = new TodoStore();
    await store.initialize();
    expect(await store.save(" ", "", "")).toBe(false);
    expect(await store.save("Bad", "javascript:alert(1)", "")).toBe(false);
    expect(api.saveProblemTodo).not.toHaveBeenCalled();
  });

  it("preserves the current completion status when saving an older edit draft", async () => {
    const store = new TodoStore();
    await store.initialize();
    const draft = { ...todo };
    await store.toggle(todo);
    await store.save("updated", todo.url, "notes", draft);
    expect(store.items[0].completed).toBe(true);
    expect(store.items[0].id).toBe(todo.id);
  });

  it("reports load errors and allows retry", async () => {
    api.listProblemTodos.mockRejectedValueOnce(new Error("cannot read"));
    const store = new TodoStore();
    await store.initialize();
    expect(store.loading).toBe(false);
    expect(store.error).toBe("cannot read");
    await store.initialize();
    expect(store.items).toEqual([todo]);
    expect(store.error).toBe("");
  });
});
