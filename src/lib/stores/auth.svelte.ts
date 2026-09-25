import {
  forgotPassword,
  login,
  logout,
  register,
  resetPassword,
  restoreAuth,
} from "../api/auth";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AuthScreen, AuthUser } from "../types/auth";

export class AuthStore {
  user = $state<AuthUser>();
  screen = $state<AuthScreen>("login");
  connection = $state<"checking" | "online" | "offline">("checking");
  loading = $state(true);
  submitting = $state(false);
  error = $state("");
  notice = $state("");
  resetEmail = $state("");
  private unlistenExpired?: UnlistenFn;

  async initialize(): Promise<void> {
    this.loading = true;
    this.connection = "checking";
    this.error = "";
    try {
      if (isTauri() && !this.unlistenExpired) {
        this.unlistenExpired = await listen("auth-expired", () => {
          this.user = undefined;
          this.screen = "login";
          this.error = "登录状态无效或已过期，请重新登录。";
        });
      }
      this.user = (await restoreAuth()) ?? undefined;
      this.connection = "online";
    } catch (error) {
      this.user = undefined;
      this.connection = "offline";
      this.error = errorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  dispose(): void {
    this.unlistenExpired?.();
    this.unlistenExpired = undefined;
  }

  show(screen: AuthScreen): void {
    this.screen = screen;
    this.error = "";
    this.notice = "";
  }

  async signIn(identifier: string, password: string): Promise<boolean> {
    return this.submit(async () => {
      this.user = await login(identifier, password);
      this.connection = "online";
      this.notice = "";
    });
  }

  async signUp(username: string, email: string, password: string): Promise<boolean> {
    return this.submit(async () => {
      this.user = await register(username, email, password);
      this.connection = "online";
      this.notice = "";
    });
  }

  async sendResetCode(email: string): Promise<boolean> {
    return this.submit(async () => {
      await forgotPassword(email);
      this.resetEmail = email.trim();
      this.screen = "reset";
      this.notice = "如果该邮箱已注册，验证码已经发送。";
    });
  }

  async completeReset(email: string, code: string, password: string): Promise<boolean> {
    return this.submit(async () => {
      await resetPassword(email, code, password);
      this.screen = "login";
      this.notice = "密码已重置，请使用新密码登录。";
    });
  }

  async signOut(): Promise<void> {
    this.error = "";
    try {
      await logout();
      this.user = undefined;
      this.screen = "login";
      this.notice = "已退出登录。";
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  private async submit(action: () => Promise<void>): Promise<boolean> {
    if (this.submitting) return false;
    this.submitting = true;
    this.error = "";
    try {
      await action();
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      return false;
    } finally {
      this.submitting = false;
    }
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { technicalMessage?: unknown; userMessage?: unknown };
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
