export type DebugSessionState = "idle" | "starting" | "running" | "stopped" | "exited" | "error";

export interface DebugBreakpointInput {
  id: string;
  file: string;
  line: number;
  enabled: boolean;
  condition: string;
}

export interface DebugBreakpoint extends DebugBreakpointInput {
  verified: boolean;
  gdbNumber?: string;
  message: string;
}

export interface DebugStartRequest {
  gdbPath: string;
  executablePath: string;
  sourcePath: string;
  workingDirectory: string;
  stdin: string;
  breakpoints: DebugBreakpointInput[];
}

export interface DebugFrame {
  level: number;
  address: string;
  function: string;
  file: string;
  fullName: string;
  line?: number;
}

export interface DebugVariable {
  name: string;
  expression: string;
  value: string;
  typeName: string;
  numChildren: number;
  hasChildren: boolean;
  variableObject?: string;
}

export interface DebugVariablePage {
  parentExpression: string;
  variableObject: string;
  from: number;
  total: number;
  hasMore: boolean;
  children: DebugVariable[];
}

export interface DebugWatchValue {
  expression: string;
  value: string;
  error: string;
}

export interface DebugSessionSnapshot {
  sessionId: string;
  state: DebugSessionState;
  reason: string;
  selectedFrame: number;
  frames: DebugFrame[];
  variables: DebugVariable[];
  watches: DebugWatchValue[];
  breakpoints: DebugBreakpoint[];
}

export type DebugEvent =
  | { kind: "state"; sessionId: string; state: DebugSessionState; reason: string }
  | { kind: "output"; sessionId: string; stream: "console" | "target" | "log"; text: string }
  | { kind: "breakpoints"; sessionId: string; breakpoints: DebugBreakpoint[] };

export interface DebugWatch extends DebugWatchValue {
  id: string;
}
