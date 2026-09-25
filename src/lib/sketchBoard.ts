export interface SketchPoint {
  x: number;
  y: number;
}

export interface SketchStroke {
  tool: "pen" | "eraser";
  color: string;
  width: number;
  points: SketchPoint[];
}

export interface SketchDocument {
  version: 2;
  canvasWidth: number;
  canvasHeight: number;
  strokes: SketchStroke[];
  updatedAt: number;
}

const STORAGE_KEY = "lightcp.sketch-board.v1";

export function sketchDocumentKey(sourcePath?: string): string {
  const path = sourcePath?.trim();
  return path ? path.replaceAll("/", "\\").toLocaleLowerCase() : "__scratch__";
}

export function loadSketchDocument(key: string): SketchDocument | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return sanitizeDocument(all[key]);
  } catch {
    return undefined;
  }
}

export function saveSketchDocument(key: string, value: SketchDocument): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, SketchDocument>;
    all[key] = value;
    const entries = Object.entries(all)
      .sort((left, right) => (right[1]?.updatedAt ?? 0) - (left[1]?.updatedAt ?? 0))
      .slice(0, 80);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // A full or disabled localStorage must not interrupt drawing.
  }
}

function sanitizeDocument(value: unknown): SketchDocument | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as {
    version?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    width?: number;
    height?: number;
    strokes?: unknown;
    updatedAt?: number;
  };
  if ((input.version !== 1 && input.version !== 2) || !Array.isArray(input.strokes)) return undefined;
  const strokes = input.strokes.slice(0, 2_000).flatMap((stroke) => {
    if (!stroke || typeof stroke !== "object") return [];
    const candidate = stroke as Partial<SketchStroke>;
    if ((candidate.tool !== "pen" && candidate.tool !== "eraser") || !Array.isArray(candidate.points)) return [];
    const points = candidate.points.slice(0, 20_000).flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const candidatePoint = point as Partial<SketchPoint>;
      return Number.isFinite(candidatePoint.x) && Number.isFinite(candidatePoint.y)
        ? [{ x: Number(candidatePoint.x), y: Number(candidatePoint.y) }]
        : [];
    });
    if (points.length === 0) return [];
    return [{
      tool: candidate.tool,
      color: typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color)
        ? candidate.color
        : "#52c7b2",
      width: finite(candidate.width, 1, 48, 3),
      points,
    } satisfies SketchStroke];
  });
  const legacy = input.version === 1;
  return {
    version: 2,
    canvasWidth: legacy
      ? finite(input.width, 160, 4_096, 720)
      : finite(input.canvasWidth, 160, 4_096, 960),
    canvasHeight: legacy
      ? finite(typeof input.height === "number" ? input.height - 76 : undefined, 160, 4_096, 444)
      : finite(input.canvasHeight, 160, 4_096, 640),
    strokes,
    updatedAt: finite(input.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function finite(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
