export type ToastKind = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ConfirmationRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  secondaryLabel?: string;
  secondaryDanger: boolean;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  secondaryLabel?: string;
  secondaryDanger?: boolean;
}

export type ConfirmationChoice = "confirm" | "secondary" | "cancel";

export class UxStore {
  toasts = $state.raw<ToastMessage[]>([]);
  confirmation = $state<ConfirmationRequest>();

  private nextId = 1;
  private confirmResolver: ((choice: ConfirmationChoice) => void) | undefined;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly recentMessages = new Map<string, number>();

  confirm(options: ConfirmOptions): Promise<boolean> {
    return this.choose(options).then((choice) => choice === "confirm");
  }

  choose(options: ConfirmOptions): Promise<ConfirmationChoice> {
    this.resolveConfirmation("cancel");
    const id = this.nextId++;
    this.confirmation = {
      id,
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "确定",
      danger: options.danger ?? false,
      secondaryLabel: options.secondaryLabel,
      secondaryDanger: options.secondaryDanger ?? false,
    };
    return new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  acceptConfirmation(): void {
    this.resolveConfirmation("confirm");
  }

  acceptSecondaryConfirmation(): void {
    this.resolveConfirmation("secondary");
  }

  cancelConfirmation(): void {
    this.resolveConfirmation("cancel");
  }

  success(message: string): void {
    this.toast("success", message);
  }

  error(message: string): void {
    this.toast("error", message, 6_000);
  }

  info(message: string): void {
    this.toast("info", message);
  }

  dismissToast(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }

  dispose(): void {
    this.resolveConfirmation("cancel");
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.toasts = [];
  }

  private toast(kind: ToastKind, message: string, duration = 3_500): void {
    const text = message.trim();
    if (!text) return;
    const key = `${kind}:${text}`;
    const now = Date.now();
    if (now - (this.recentMessages.get(key) ?? 0) < 2_000) return;
    this.recentMessages.set(key, now);
    const id = this.nextId++;
    this.toasts = [...this.toasts.slice(-3), { id, kind, message: text }];
    this.timers.set(id, setTimeout(() => this.dismissToast(id), duration));
  }

  private resolveConfirmation(choice: ConfirmationChoice): void {
    const resolve = this.confirmResolver;
    this.confirmResolver = undefined;
    this.confirmation = undefined;
    resolve?.(choice);
  }
}
