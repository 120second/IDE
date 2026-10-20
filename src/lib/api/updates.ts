import { invoke } from "@tauri-apps/api/core";

export const RELEASES_PAGE = "https://github.com/120second/IDE/releases";

export interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  publishedAt: string | null;
  prerelease: boolean;
  pageUrl: string;
  installerUrl: string | null;
  portableUrl: string | null;
}

export interface UpdateCheck {
  currentVersion: string;
  status: "updateAvailable" | "upToDate" | "noRelease";
  release: ReleaseInfo | null;
}

export const checkAppUpdate = () => invoke<UpdateCheck>("check_app_update");
export const openUpdateUrl = (url: string) => invoke<void>("open_update_url", { url });
