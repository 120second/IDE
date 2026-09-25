export type ProblemDocumentKind = "markdown" | "pdf";

export interface ProblemDocumentMeta {
  kind: ProblemDocumentKind;
  title: string;
  markdown: string;
  pdfName?: string;
  updatedAt: number;
}

const METADATA_KEY = "lightcp.problem-reader.v1";
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

export function loadProblemDocument(key: string): ProblemDocumentMeta | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(METADATA_KEY) ?? "{}") as Record<string, ProblemDocumentMeta>;
    const value = all[key];
    if (!value || (value.kind !== "markdown" && value.kind !== "pdf")) return undefined;
    return {
      kind: value.kind,
      title: typeof value.title === "string" ? value.title : "题面",
      markdown: typeof value.markdown === "string" ? value.markdown : "",
      pdfName: typeof value.pdfName === "string" ? value.pdfName : undefined,
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    };
  } catch {
    return undefined;
  }
}

export function saveProblemDocument(key: string, value: ProblemDocumentMeta): void {
  try {
    const all = JSON.parse(localStorage.getItem(METADATA_KEY) ?? "{}") as Record<string, ProblemDocumentMeta>;
    all[key] = value;
    const entries = Object.entries(all)
      .sort((left, right) => (right[1].updatedAt ?? 0) - (left[1].updatedAt ?? 0))
      .slice(0, 200);
    localStorage.setItem(METADATA_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // A disabled or full localStorage must not prevent editing the statement.
  }
}

export async function saveProblemPdf(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction(PDF_STORE, "readwrite").objectStore(PDF_STORE).put(blob, key));
  database.close();
}

export async function loadProblemPdf(key: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  const value = await requestResult<Blob | undefined>(
    database.transaction(PDF_STORE, "readonly").objectStore(PDF_STORE).get(key),
  );
  database.close();
  return value;
}

export async function deleteProblemPdf(key: string): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction(PDF_STORE, "readwrite").objectStore(PDF_STORE).delete(key));
  database.close();
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
