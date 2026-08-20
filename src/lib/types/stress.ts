import type { CompilerConfig } from "./execution";
import type { VisualGeneratorProfile } from "./generator";

export type StressStatus = "idle" | "compiling" | "running" | "failed" | "stopped" | "completed" | "error";

export interface StressRunRequest {
  sessionId: string;
  solutionPath: string;
  brutePath: string;
  generatorProfile: VisualGeneratorProfile;
  iterations: number;
  infinite: boolean;
  seed: string;
  timeoutMs: number;
  maxOutputBytes: number;
  compilerConfig: CompilerConfig;
  startCase: number;
  initialPassed: number;
  initialFailed: number;
  initialElapsedMs: number;
}

export interface StressStats {
  totalCases: number;
  passed: number;
  failed: number;
  elapsedMs: number;
  casesPerSecond: number;
}

export interface StressCasePassed {
  index: number;
  seed: string;
  solutionTimeMs: number;
  bruteTimeMs: number;
  stats: StressStats;
}

export interface StressFailure {
  index: number;
  seed: string;
  nextSeed: string;
  reason: string;
  input: string;
  solutionOutput: string;
  bruteOutput: string;
  solutionStderr: string;
  bruteStderr: string;
  solutionExitCode?: number;
  bruteExitCode?: number;
  solutionTimeMs: number;
  bruteTimeMs: number;
  stats: StressStats;
}

export interface StressSummary {
  sessionId: string;
  status: Exclude<StressStatus, "idle">;
  message: string;
  nextSeed: string;
  stats: StressStats;
  failure?: StressFailure;
}

export type StressEvent =
  | { kind: "state"; sessionId: string; status: Exclude<StressStatus, "idle">; message: string }
  | { kind: "casePassed"; sessionId: string; result: StressCasePassed }
  | { kind: "casesPassed"; sessionId: string; results: StressCasePassed[] }
  | { kind: "failure"; sessionId: string; failure: StressFailure };

export type StressLogEntry =
  | { status: "AC"; index: number; seed: string; solutionTimeMs: number; bruteTimeMs: number }
  | { status: "FAILED"; index: number; seed: string; reason: string };
