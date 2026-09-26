export interface ReaderAnnotationPoint {
  x: number;
  y: number;
}

export interface ReaderAnnotationStroke {
  tool: "pen" | "eraser";
  color: string;
  width: number;
  page?: number;
  points: ReaderAnnotationPoint[];
}

export interface ReaderAnnotationDocument {
  version: 1;
  strokes: ReaderAnnotationStroke[];
  updatedAt: number;
}

const STORAGE_KEY = "lightcp.reader-annotations.v1";

export function loadReaderAnnotations(key: string): ReaderAnnotationDocument | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return sanitizeDocument(all[key]);
  } catch {
    return undefined;
  }
}

export function saveReaderAnnotations(key: string, value: ReaderAnnotationDocument): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, ReaderAnnotationDocument>;
    all[key] = value;
    const entries = Object.entries(all)
      .sort((left, right) => (right[1]?.updatedAt ?? 0) - (left[1]?.updatedAt ?? 0))
      .slice(0, 80);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Disabled or full local storage must not interrupt reading.
  }
}

export function deleteReaderAnnotations(key: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, ReaderAnnotationDocument>;
    delete all[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Clearing annotations should remain best-effort.
  }
}

function sanitizeDocument(value: unknown): ReaderAnnotationDocument | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as { version?: unknown; strokes?: unknown; updatedAt?: unknown };
  if (input.version !== 1 || !Array.isArray(input.strokes)) return undefined;
  const strokes = input.strokes.slice(0, 2_000).flatMap((stroke) => {
    if (!stroke || typeof stroke !== "object") return [];
    const candidate = stroke as Partial<ReaderAnnotationStroke>;
    if ((candidate.tool !== "pen" && candidate.tool !== "eraser") || !Array.isArray(candidate.points)) return [];
    const points = candidate.points.slice(0, 20_000).flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const next = point as Partial<ReaderAnnotationPoint>;
      return Number.isFinite(next.x) && Number.isFinite(next.y)
        ? [{ x: clamp(Number(next.x), 0, 1), y: clamp(Number(next.y), 0, 1) }]
        : [];
    });
    if (points.length === 0) return [];
    return [{
      tool: candidate.tool,
      color: typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color)
        ? candidate.color
        : "#ff5d6c",
      width: finite(candidate.width, 1, 48, 3),
      page: Number.isSafeInteger(candidate.page) && Number(candidate.page) > 0
        ? Number(candidate.page)
        : undefined,
      points,
    } satisfies ReaderAnnotationStroke];
  });
  return {
    version: 1,
    strokes,
    updatedAt: finite(input.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

export function readerAnnotationStorageKey(problemKey: string, surface: "markdown" | "pdf"): string {
  return surface === "pdf" ? `${problemKey}::pdf` : problemKey;
}

export function drawReaderAnnotationStroke(
  context: CanvasRenderingContext2D,
  stroke: ReaderAnnotationStroke,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (stroke.points.length === 0) return;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.tool === "eraser" ? stroke.width * 4 : stroke.width;
  const first = stroke.points[0];
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(first.x * canvasWidth, first.y * canvasHeight, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(first.x * canvasWidth, first.y * canvasHeight);
  for (let index = 1; index < stroke.points.length - 1; index += 1) {
    const point = stroke.points[index];
    const next = stroke.points[index + 1];
    context.quadraticCurveTo(
      point.x * canvasWidth,
      point.y * canvasHeight,
      ((point.x + next.x) / 2) * canvasWidth,
      ((point.y + next.y) / 2) * canvasHeight,
    );
  }
  const last = stroke.points.at(-1)!;
  context.lineTo(last.x * canvasWidth, last.y * canvasHeight);
  context.stroke();
}

function finite(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
