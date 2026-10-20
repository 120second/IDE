import { getVersion } from "@tauri-apps/api/app";
import { checkAppUpdate, openUpdateUrl, type UpdateCheck } from "../api/updates";

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "检查更新失败，请稍后重试或打开版本发布页。";
}

export class UpdatesStore {
  version = $state("");
  checking = $state(false);
  opening = $state(false);
  result = $state<UpdateCheck>();
  error = $state("");
  openError = $state("");
  checkedAt = $state<Date>();

  async loadVersion(): Promise<void> {
    try {
      this.version = await getVersion();
    } catch {
      // A later update check also returns the authoritative native version.
      if (!this.version) this.version = "读取失败";
    }
  }

  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.error = "";
    this.openError = "";
    this.result = undefined;
    this.checkedAt = undefined;
    try {
      const result = await checkAppUpdate();
      this.version = result.currentVersion;
      this.result = result;
      this.checkedAt = new Date();
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.checking = false;
    }
  }

  async open(url: string): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    this.openError = "";
    try {
      await openUpdateUrl(url);
    } catch (error) {
      this.openError = errorMessage(error);
    } finally {
      this.opening = false;
    }
  }
}
