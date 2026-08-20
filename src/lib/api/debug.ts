import { invoke } from "@tauri-apps/api/core";
import type {
  DebugBreakpoint,
  DebugBreakpointInput,
  DebugSessionSnapshot,
  DebugStartRequest,
  DebugVariablePage,
} from "../types/debug";

export const startDebugSession = (request: DebugStartRequest) =>
  invoke<DebugSessionSnapshot>("start_debug_session", { request });

export const stopDebugSession = () =>
  invoke<DebugSessionSnapshot>("stop_debug_session");

export const restartDebugSession = () =>
  invoke<DebugSessionSnapshot>("restart_debug_session");

export const continueDebugSession = () =>
  invoke<DebugSessionSnapshot>("debug_continue");

export const pauseDebugSession = () =>
  invoke<DebugSessionSnapshot>("debug_pause");

export const stepOverDebugSession = () =>
  invoke<DebugSessionSnapshot>("debug_step_over");

export const stepIntoDebugSession = () =>
  invoke<DebugSessionSnapshot>("debug_step_into");

export const stepOutDebugSession = () =>
  invoke<DebugSessionSnapshot>("debug_step_out");

export const getDebugSnapshot = (selectedFrame: number, watches: string[]) =>
  invoke<DebugSessionSnapshot>("get_debug_snapshot", { selectedFrame, watches });

export const fetchDebugVariableChildren = (
  selectedFrame: number,
  expression: string,
  variableObject: string | undefined,
  from: number,
  count = 100,
) => invoke<DebugVariablePage>("fetch_debug_variable_children", {
  selectedFrame,
  expression,
  variableObject,
  from,
  count,
});

export const setDebugBreakpoint = (breakpoint: DebugBreakpointInput) =>
  invoke<DebugBreakpoint>("set_debug_breakpoint", { breakpoint });

export const removeDebugBreakpoint = (id: string) =>
  invoke<boolean>("remove_debug_breakpoint", { id });
