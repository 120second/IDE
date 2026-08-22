import { invoke } from "@tauri-apps/api/core";
import type { HealthStatus, ToolchainStatus } from "../types/health";

export function healthCheck(): Promise<HealthStatus> {
  return invoke<HealthStatus>("health_check");
}

export function diagnoseToolchain(
  compilerPath: string,
  gdbPath: string,
  clangdPath: string,
): Promise<ToolchainStatus> {
  return invoke<ToolchainStatus>("diagnose_toolchain", {
    compilerPath,
    gdbPath,
    clangdPath,
  });
}

