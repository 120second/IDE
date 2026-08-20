export const OUTPUT_FLUSH_INTERVAL_MS = 32;

export class BoundedOutputBuffer {
  private pending: string[] = [];
  private pendingLength = 0;

  constructor(
    private readonly limit: number,
    private readonly truncationPrefix: string,
  ) {}

  enqueue(value: string): void {
    if (!value) return;
    this.pending.push(value);
    this.pendingLength += value.length;
  }

  flush(current: string): string {
    if (this.pendingLength === 0) return current;
    const appended = this.pending.length === 1 ? this.pending[0] : this.pending.join("");
    this.pending = [];
    this.pendingLength = 0;
    const next = current + appended;
    return next.length <= this.limit
      ? next
      : `${this.truncationPrefix}${next.slice(-this.limit)}`;
  }

  clear(): void {
    this.pending = [];
    this.pendingLength = 0;
  }

  approximateLength(current: string): number {
    return current.length + this.pendingLength;
  }
}

