import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSettings } from "../types/settings";

const BROWSER_STORAGE_KEY = "lightcp.settings.preview";

export async function loadSettings(fallback: AppSettings): Promise<AppSettings> {
  if (isTauri()) {
    return invoke<AppSettings>("load_settings");
  }

  const stored = localStorage.getItem(BROWSER_STORAGE_KEY);
  return stored ? (JSON.parse(stored) as AppSettings) : fallback;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (isTauri()) {
    return invoke<AppSettings>("save_settings", { settings });
  }

  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(settings));
  return settings;
}

