import { invoke, isTauri } from "@tauri-apps/api/core";
export type NotebookKind = "problem" | "sketch" | "annotations";
export const legacyNotebookKeys: Record<NotebookKind, string> = {
  problem: "lightcp.problem-reader.v1", sketch: "lightcp.sketch-board.v1", annotations: "lightcp.reader-annotations.v1",
};
const migrations = new Map<NotebookKind, Promise<void>>();
const redirects = new Map<string, string>();
const failedWrites = new Map<string, () => Promise<void>>();
let writes: Promise<void> = Promise.resolve();
const desktop = () => typeof window !== "undefined" && isTauri();
function storageError(error: unknown): void {
  if (typeof window === "undefined")
    return;
  const message = typeof error === "object" && error && "userMessage" in error ? String(error.userMessage) : String(error);
  window.dispatchEvent?.(new CustomEvent("notebook-storage-error", { detail: `题面或画板保存失败，请保留窗口并重试：${message}` }));
}
function enqueue(identity: string, operation: () => Promise<void>): void {
  writes = writes.then(operation).then(() => { failedWrites.delete(identity); }, (error) => {
    failedWrites.set(identity, operation);
    storageError(error);
  });
}
export async function flushNotebookWrites(): Promise<void> {
  if (typeof window !== "undefined")
    window.dispatchEvent?.(new Event("notebook-flush"));
  await writes;
  for (const [identity, operation] of [...failedWrites])
    enqueue(identity, operation);
  await writes;
  if (failedWrites.size)
    throw new Error("题面或画板尚未保存成功，请检查磁盘空间后重试。");
}
export function notebookKey(key: string): string {
  let result = key.replaceAll("/", "\\").toLowerCase();
  for (let i = 0; i <= redirects.size; i++) {
    const entry = [...redirects].find(([previous]) => result === previous || result.startsWith(`${previous}\\`) || result.startsWith(`${previous}::`));
    if (!entry)
      break;
    result = entry[1] + result.slice(entry[0].length);
  }
  return result;
}
export function clearNotebookRedirect(path: string): void {
  const normalized = path.replaceAll("/", "\\").toLowerCase();
  for (const previous of redirects.keys())
    if (previous === normalized || previous.startsWith(`${normalized}\\`))
      redirects.delete(previous);
}
function legacy(kind: NotebookKind): Record<string, unknown> {
  const parsed: unknown = JSON.parse(localStorage.getItem(legacyNotebookKeys[kind]) ?? "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("旧版笔记数据无法识别，原数据已保留。");
  return parsed as Record<string, unknown>;
}
async function migrate(kind: NotebookKind): Promise<void> {
  if (!desktop())
    return;
  let migration = migrations.get(kind);
  if (!migration) {
    migration = invoke<void>("import_notebooks", { kind, storageKey: legacyNotebookKeys[kind], records: Object.entries(legacy(kind)).map(([key, value]) => ({ sourcePath: key.replaceAll("/", "\\").toLowerCase(), content: JSON.stringify(kind === "problem" && typeof value === "object" && value && ("pdfName" in value || ("kind" in value && value.kind === "pdf")) ? { ...value, pdfStorageKey: key } : value) })) });
    migrations.set(kind, migration);
    migration.catch(() => migrations.delete(kind));
  }
  await migration;
}
export async function readNotebook<T>(kind: NotebookKind, key: string): Promise<T | undefined> {
  await writes;
  await migrate(kind);
  if (!desktop())
    return legacy(kind)[notebookKey(key)] as T | undefined;
  const content = await invoke<string | null>("read_notebook", { kind, key: notebookKey(key) });
  return content === null ? undefined : JSON.parse(content) as T;
}
export function writeNotebook(kind: NotebookKind, key: string, value: unknown): void {
  const target = notebookKey(key);
  const content = JSON.stringify(value);
  if (!desktop()) {
    const all = legacy(kind);
    all[target] = JSON.parse(content);
    localStorage.setItem(legacyNotebookKeys[kind], JSON.stringify(all));
    return;
  }
  enqueue(`${kind}:${target}`, async () => {
    await migrate(kind);
    await invoke("write_notebook", { kind, key: target, content });
  });
}
export function deleteNotebook(kind: NotebookKind, key: string): void {
  const target = notebookKey(key);
  if (!desktop()) {
    const all = legacy(kind);
    delete all[target];
    localStorage.setItem(legacyNotebookKeys[kind], JSON.stringify(all));
    return;
  }
  enqueue(`${kind}:${target}`, async () => { await migrate(kind); await invoke("delete_notebook", { kind, key: target }); });
}
export async function remapNotebookPaths(previous: string, next: string): Promise<void> {
  await flushNotebookWrites();
  await Promise.all((Object.keys(legacyNotebookKeys) as NotebookKind[]).map(migrate));
  const from = previous.replaceAll("/", "\\").toLowerCase();
  const to = next.replaceAll("/", "\\").toLowerCase();
  if (from === to)
    return;
  clearNotebookRedirect(to);
  redirects.set(from, to);
  // Queue behind existing saves; stale UI snapshots now target the new path.
  if (desktop()) {
    const operation = () => invoke<void>("remap_notebooks", { previous, next });
    enqueue(`rename:${from}`, operation);
    await writes;
    if (failedWrites.has(`rename:${from}`))
      throw new Error("文件已改名，但关联数据迁移失败，请保留窗口并重试。");
  }
  else {
    for (const kind of Object.keys(legacyNotebookKeys) as NotebookKind[]) {
      const all = legacy(kind);
      for (const key of Object.keys(all)) {
        if (key === from || key.startsWith(`${from}\\`) || key.startsWith(`${from}::`)) {
          all[notebookKey(key)] = all[key];
          delete all[key];
        }
      }
      localStorage.setItem(legacyNotebookKeys[kind], JSON.stringify(all));
    }
  }
  const { remapProblemPdfs } = await import("./problemReader");
  await remapProblemPdfs(from, to);
}
