export interface BackdropDismissHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onClick: (event: MouseEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Dismisses a backdrop only when the pointer starts and ends on the backdrop.
 * This prevents a drag that begins inside a dialog and is released outside it
 * from being interpreted as a backdrop click.
 */
export function createBackdropDismiss(close: () => void): BackdropDismissHandlers {
  let pointerStartedOnBackdrop = false;

  return {
    onPointerDown: (event) => {
      pointerStartedOnBackdrop = event.target === event.currentTarget;
    },
    onClick: (event) => {
      const shouldClose = pointerStartedOnBackdrop && event.target === event.currentTarget;
      pointerStartedOnBackdrop = false;
      if (shouldClose) close();
    },
    onPointerCancel: () => {
      pointerStartedOnBackdrop = false;
    },
  };
}
