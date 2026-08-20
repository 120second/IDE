/// <reference types="vite/client" />

import type { PerformanceSnapshot } from "./lib/performance";

declare global {
  interface Window {
    __LIGHTCP_PERFORMANCE__?: () => Promise<PerformanceSnapshot>;
  }
}

export {};
