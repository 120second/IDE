interface DragState {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  dialogLeft: number;
  dialogTop: number;
  dialogWidth: number;
  dialogHeight: number;
  offsetX: number;
  offsetY: number;
}

export class DialogDragController {
  x = $state(0);
  y = $state(0);
  private state = $state<DragState>();

  get active(): boolean {
    return this.state !== undefined;
  }

  begin(event: PointerEvent, dialog: HTMLElement | undefined): void {
    if (
      event.button !== 0
      || !dialog
      || (event.target instanceof Element && event.target.closest("button"))
    ) return;
    event.preventDefault();
    const bounds = dialog.getBoundingClientRect();
    this.state = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      dialogLeft: bounds.left,
      dialogTop: bounds.top,
      dialogWidth: bounds.width,
      dialogHeight: bounds.height,
      offsetX: this.x,
      offsetY: this.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  move(event: PointerEvent): void {
    if (!this.state || event.pointerId !== this.state.pointerId) return;
    const margin = 8;
    const desiredLeft = this.state.dialogLeft + event.clientX - this.state.pointerX;
    const desiredTop = this.state.dialogTop + event.clientY - this.state.pointerY;
    const maxLeft = Math.max(margin, window.innerWidth - this.state.dialogWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - this.state.dialogHeight - margin);
    const left = Math.max(margin, Math.min(desiredLeft, maxLeft));
    const top = Math.max(margin, Math.min(desiredTop, maxTop));
    this.x = this.state.offsetX + left - this.state.dialogLeft;
    this.y = this.state.offsetY + top - this.state.dialogTop;
  }

  end(event: PointerEvent): void {
    if (!this.state || event.pointerId !== this.state.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    this.state = undefined;
  }
}
