export interface ProblemTodo {
  id: string;
  title: string;
  url: string;
  notes: string;
  completed: boolean;
  createdAt: number;
}

export function problemUrl(value: string): string {
  const text = value.trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch { /* Report invalid URLs beside the form. */ }
  throw new Error("请输入以 http:// 或 https:// 开头的有效题目链接。");
}
