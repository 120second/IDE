import { invoke } from "@tauri-apps/api/core";
import type { HealthStatus } from "../types/health";

export function healthCheck(): Promise<HealthStatus> {
  return invoke<HealthStatus>("health_check");
}

