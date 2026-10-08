import { invoke } from "@tauri-apps/api/core";

export interface ProblemListenerStatus {
  listening: boolean;
  port: number;
  workspacePath?: string;
}

export interface ImportedProblem {
  title: string;
  sourcePath: string;
  markdownPath: string;
  sourceUrl: string;
  sampleCount: number;
  alreadyImported: boolean;
}

export const problemListenerStatus = () => invoke<ProblemListenerStatus>("problem_listener_status");
export const startProblemListener = (templateCode: string) =>
  invoke<ProblemListenerStatus>("start_problem_listener", { templateCode });
export const stopProblemListener = () => invoke<void>("stop_problem_listener");
