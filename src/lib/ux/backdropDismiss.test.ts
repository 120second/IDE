import { describe, expect, it, vi } from "vitest";
import { createBackdropDismiss } from "./backdropDismiss";

describe("createBackdropDismiss", () => {
  it("closes when the pointer starts and ends on the backdrop", () => {
    const close = vi.fn();
    const backdrop = {};
    const handlers = createBackdropDismiss(close);

    handlers.onPointerDown({ target: backdrop, currentTarget: backdrop } as unknown as PointerEvent);
    handlers.onClick({ target: backdrop, currentTarget: backdrop } as unknown as MouseEvent);

    expect(close).toHaveBeenCalledOnce();
  });

  it("does not close when a drag starts inside the dialog and ends on the backdrop", () => {
    const close = vi.fn();
    const backdrop = {};
    const dialog = {};
    const handlers = createBackdropDismiss(close);

    handlers.onPointerDown({ target: dialog, currentTarget: backdrop } as unknown as PointerEvent);
    handlers.onClick({ target: backdrop, currentTarget: backdrop } as unknown as MouseEvent);

    expect(close).not.toHaveBeenCalled();
  });
});
