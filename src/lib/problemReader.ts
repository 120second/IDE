import { readNotebook, writeNotebook, notebookKey } from "./notebookStorage";
export type ProblemDocumentKind = "markdown" | "pdf";
export type ProblemSampleKind = "input" | "output";

export interface ProblemDocumentMeta {
  kind: ProblemDocumentKind;
  title: string;
  markdown: string;
  sourceUrl?: string;
  pdfName?: string;
  pdfStorageKey?: string;
  updatedAt: number;
}

const DATABASE_NAME = "lightcp-problem-reader";
const DATABASE_VERSION = 1;
const PDF_STORE = "pdfs";

export function problemDocumentKey(sourcePath?: string): string {
  const path = sourcePath?.trim();
  return path ? path.replaceAll("/", "\\").toLocaleLowerCase() : "__scratch__";
}

export function titleFromMarkdown(markdown: string, fallback = "题面"): string {
  const heading = markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1]
    ?.replace(/[*_`~[\]]/g, "")
    .trim();
  return heading || fallback;
}

export function problemSampleContext(label: string): { kind: ProblemSampleKind; id?: string } | undefined {
  const normalized = label.replace(/\s+/g, " ").trim();
  const input = normalized.match(/^(?:样例\s*)?(?:输入|sample\s+input|input(?:\s+sample)?)(?:\s*#?\s*(\d+))?$/i);
  if (input) return { kind: "input", id: input[1] };
  const output = normalized.match(/^(?:样例\s*)?(?:输出|sample\s+output|output(?:\s+sample)?)(?:\s*#?\s*(\d+))?$/i);
  if (output) return { kind: "output", id: output[1] };
  return undefined;
}

export function compactProblemSample(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export async function loadProblemDocument(key: string): Promise<ProblemDocumentMeta | undefined> {
  try {
    const value = await readNotebook<ProblemDocumentMeta>("problem", key);
    if (!value || (value.kind !== "markdown" && value.kind !== "pdf")) return undefined;
    return {
      kind: value.kind,
      title: typeof value.title === "string" ? value.title : "题面",
      markdown: typeof value.markdown === "string" ? value.markdown : "",
      ...(typeof value.sourceUrl === "string" ? { sourceUrl: value.sourceUrl } : {}),
      pdfName: typeof value.pdfName === "string" ? value.pdfName : undefined,
      ...(typeof value.pdfStorageKey === "string" ? { pdfStorageKey: value.pdfStorageKey } : {}),
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    };
  } catch (error) {
    throw error;
  }
}

export function saveProblemDocument(key: string, value: ProblemDocumentMeta): void {
  writeNotebook("problem", key, value);
}

export async function saveProblemPdf(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PDF_STORE, "readwrite");
    const committed = transactionResult(transaction);
    transaction.objectStore(PDF_STORE).put(blob, notebookKey(key));
    await committed;
  } finally { database.close(); }
}
export async function loadProblemPdf(key: string, legacyKey?: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  try {
    const current = await requestResult<Blob | undefined>(database.transaction(PDF_STORE, "readonly").objectStore(PDF_STORE).get(notebookKey(key)));
    if (current || !legacyKey) return current;
    return await requestResult<Blob | undefined>(database.transaction(PDF_STORE, "readonly").objectStore(PDF_STORE).get(legacyKey));
  }
  finally { database.close(); }
}
export async function deleteProblemPdf(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PDF_STORE, "readwrite");
    const committed = transactionResult(transaction);
    transaction.objectStore(PDF_STORE).delete(notebookKey(key));
    await committed;
  } finally { database.close(); }
}
export async function remapProblemPdfs(previous: string, next: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PDF_STORE, "readwrite");
    const committed = transactionResult(transaction);
    const store = transaction.objectStore(PDF_STORE);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      const key = String(item.key).replaceAll("/", "\\").toLowerCase();
      if (key === previous || key.startsWith(`${previous}\\`)) {
        store.put(item.value, next + key.slice(previous.length));
        item.delete();
      }
      item.continue();
    };
    await committed;
  } finally { database.close(); }
}
function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("题面存储事务已取消。"));
    transaction.onerror = () => reject(transaction.error ?? new Error("无法保存题面。"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PDF_STORE)) {
        request.result.createObjectStore(PDF_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开题面存储。"));
  });
}

function requestResult<T = IDBValidKey>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法保存题面文件。"));
  });
}
