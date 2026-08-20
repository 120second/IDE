import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";

export interface PerformanceSnapshot {
  enabled: boolean;
  frontendStartupDurationMs: number;
  backendStartupDurationMs: number;
  workspaceLoadDurationMs: number;
  activeProcessCount: number;
  ipcEventCount: number;
  approximateOutputBufferBytes: number;
}

interface BackendPerformanceSnapshot {
  enabled: boolean;
  backendStartupDurationMs: number;
  workspaceLoadDurationMs: number;
  activeProcessCount: number;
  ipcEventCount: number;
}

const bootStartedAt = performance.now();
let frontendStartupDurationMs = 0;
let workspaceLoadDurationMs = 0;
let ipcEventCount = 0;
let outputSizeReader: (() => number) | undefined;
let activeProcessReader: (() => number) | undefined;

export function markFrontendReady(): void {
  if (!import.meta.env.DEV || frontendStartupDurationMs > 0) return;
  frontendStartupDurationMs = performance.now() - bootStartedAt;
}

export function recordWorkspaceLoad(durationMs: number): void {
  if (import.meta.env.DEV) workspaceLoadDurationMs = durationMs;
}

export function recordIpcEvent(): void {
  if (import.meta.env.DEV) ipcEventCount += 1;
}

export function registerPerformanceReaders(
  output: () => number,
  activeProcesses: () => number,
): void {
  if (!import.meta.env.DEV) return;
  outputSizeReader = output;
  activeProcessReader = activeProcesses;
}

export function installPerformanceConsole(): void {
  if (!import.meta.env.DEV) return;
  window.__LIGHTCP_PERFORMANCE__ = async () => {
    const local: PerformanceSnapshot = {
      enabled: true,
      frontendStartupDurationMs: round(frontendStartupDurationMs),
      backendStartupDurationMs: 0,
      workspaceLoadDurationMs: round(workspaceLoadDurationMs),
      activeProcessCount: activeProcessReader?.() ?? 0,
      ipcEventCount,
      approximateOutputBufferBytes: outputSizeReader?.() ?? 0,
    };
    if (!isTauri()) return local;
    try {
      const backend = await invoke<BackendPerformanceSnapshot>("get_performance_snapshot");
      return {
        ...local,
        enabled: backend.enabled,
        backendStartupDurationMs: backend.backendStartupDurationMs,
        workspaceLoadDurationMs: Math.max(
          backend.workspaceLoadDurationMs,
          local.workspaceLoadDurationMs,
        ),
        activeProcessCount: backend.activeProcessCount,
        ipcEventCount: Math.max(local.ipcEventCount, backend.ipcEventCount),
      };
    } catch {
      return local;
    }
  };
  console.info("LightCP 开发模式性能统计：await window.__LIGHTCP_PERFORMANCE__()");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
