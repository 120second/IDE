interface AnchoredMenuInput {
  viewportWidth: number;
  anchorRight: number;
  anchorBottom: number;
  menuWidth: number;
  menuHeight: number;
  contentTop: number;
  contentBottom: number;
  margin?: number;
}

interface AnchoredMenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

export function fitAnchoredMenu(input: AnchoredMenuInput): AnchoredMenuPlacement {
  const margin = input.margin ?? 6;
  const contentTop = Math.max(margin, input.contentTop);
  const contentBottom = Math.max(contentTop + 1, input.contentBottom);
  const maxHeight = contentBottom - contentTop;
  const fittedHeight = Math.min(Math.max(1, input.menuHeight), maxHeight);
  const maximumLeft = Math.max(margin, input.viewportWidth - input.menuWidth - margin);
  const left = clamp(input.anchorRight - 2, margin, maximumLeft);
  const maximumTop = Math.max(contentTop, contentBottom - fittedHeight);
  const top = clamp(input.anchorBottom - fittedHeight, contentTop, maximumTop);
  return { left, top, maxHeight };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
