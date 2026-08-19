import { invoke } from "@tauri-apps/api/core";
import type {
  CompileRequest,
  CompileResult,
  RunRequest,
  RunResult,
  Testcase,
  TestcaseInput,
} from "../types/execution";

export function compileCurrentFile(request: CompileRequest): Promise<CompileResult> {
  return invoke<CompileResult>("compile_current_file", { request }).then(normalizeCompileResult);
}

export function runProgram(request: RunRequest): Promise<RunResult> {
  return invoke<RunResult>("run_program", { request });
}

export function stopProgram(): Promise<boolean> {
  return invoke<boolean>("stop_program");
}

export function listTestcases(sourcePath: string): Promise<Testcase[]> {
  return invoke<Testcase[]>("list_testcases", { sourcePath });
}

export function createTestcase(input: TestcaseInput): Promise<Testcase> {
  return invoke<Testcase>("create_testcase", { input });
}

export function updateTestcase(id: number, input: TestcaseInput): Promise<Testcase> {
  return invoke<Testcase>("update_testcase", { id, input });
}

export function duplicateTestcase(id: number): Promise<Testcase> {
  return invoke<Testcase>("duplicate_testcase", { id });
}

export function deleteTestcase(id: number): Promise<void> {
  return invoke<void>("delete_testcase", { id });
}

export function moveTestcase(id: number, targetIndex: number): Promise<void> {
  return invoke<void>("move_testcase", { id, targetIndex });
}

export function compareTestcaseOutput(actual: string, expected: string): Promise<boolean> {
  return invoke<boolean>("compare_testcase_output", { actual, expected });
}

function normalizeCompileResult(result: CompileResult): CompileResult {
  return {
    ...result,
    executablePath: result.executablePath ?? undefined,
    exitCode: result.exitCode ?? undefined,
  };
}

