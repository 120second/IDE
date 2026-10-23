export type CompileProfile = "release" | "debug";

export interface CompilerConfig {
  compilerPath: string;
  standard: string;
  releaseArgs: string[];
  debugArgs: string[];
  maxOutputBytes: number;
}

export interface CompileRequest {
  reuseArtifact?: boolean;
  clientTaskId?: string;
  expectedSource?: string;
  sourcePath: string;
  profile: CompileProfile;
  config: CompilerConfig;
}

export interface CompileResult {
  dependencies?: { path: string; contentHash?: string | null }[];
  dependenciesComplete?: boolean;
  diagnosticsIncomplete?: boolean;
  cacheHit?: boolean;
  command?: string[];
  workingDirectory?: string;
  taskId?: string;
  diagnostics?: import("./lsp").LspDiagnostic[];
  sourceChanged?: boolean;
  success: boolean;
  executablePath?: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs: number;
  outputTruncated: boolean;
}

export type RunStatus = "exited" | "timedOut" | "stopped";

export interface RunRequest {
  clientRunId: string;
  executablePath: string;
  arguments: string[];
  workingDirectory: string;
  stdin: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RunResult {
  clientRunId: string;
  status: RunStatus;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs: number;
  outputTruncated: boolean;
}

export interface RunnerOutputBatch {
  clientRunId: string;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}

export type TestcaseKind = "sample" | "custom" | "hack";

export interface Testcase {
  id: number;
  sourcePath: string;
  kind: TestcaseKind;
  name: string;
  input: string;
  expectedOutput: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestcaseInput {
  sourcePath: string;
  kind: TestcaseKind;
  name: string;
  input: string;
  expectedOutput: string;
  enabled: boolean;
}

export type TestcaseStatus = "AC" | "OK" | "WA" | "RE" | "TLE" | "CE" | "OLE" | "Error" | "Stopped" | "Running";

export interface TestcaseResult {
  testcaseId: number;
  name: string;
  status: TestcaseStatus;
  durationMs: number;
  actualOutput: string;
  expectedOutput: string;
  stderr: string;
  exitCode?: number;
}

