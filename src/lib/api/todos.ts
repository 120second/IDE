import { invoke, isTauri } from "@tauri-apps/api/core";
import { problemUrl, type ProblemTodo } from "../types/todo";

const KEY = "lightcp.problem-todos.v1";

export async function listProblemTodos(): Promise<ProblemTodo[]> {
  if (isTauri()) return invoke<ProblemTodo[]>("list_problem_todos");
  const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  if (!Array.isArray(value) || !value.every((item) => item && typeof item.id === "string"
    && typeof item.title === "string" && typeof item.url === "string" && typeof item.notes === "string"
    && typeof item.completed === "boolean" && Number.isFinite(item.createdAt))) {
    throw new Error("待办数据无法读取，请保留原数据后重试。");
  }
  return value as ProblemTodo[];
}

export async function saveProblemTodo(todo: ProblemTodo): Promise<ProblemTodo> {
  const normalized = { ...todo, title: todo.title.trim(), url: problemUrl(todo.url), notes: todo.notes.trim() };
  if (isTauri()) return invoke<ProblemTodo>("save_problem_todo", { todo: normalized });
  const items = await listProblemTodos();
  const previous = items.find((item) => item.id === todo.id);
  if (previous) normalized.createdAt = previous.createdAt;
  localStorage.setItem(KEY, JSON.stringify([normalized, ...items.filter((item) => item.id !== todo.id)]));
  return normalized;
}

export async function deleteProblemTodo(id: string): Promise<void> {
  if (isTauri()) return invoke<void>("delete_problem_todo", { id });
  const items = await listProblemTodos();
  localStorage.setItem(KEY, JSON.stringify(items.filter((item) => item.id !== id)));
}

export function openProblemTodoUrl(url: string): Promise<void> {
  return invoke<void>("open_problem_todo_url", { url: problemUrl(url) });
}
