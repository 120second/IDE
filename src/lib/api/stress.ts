import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { StressFailure, StressRunRequest, StressSummary } from "../types/stress";

export const startStressTest = (request: StressRunRequest) =>
  invoke<StressSummary>("start_stress_test", { request });

export const stopStressTest = () => invoke<boolean>("stop_stress_test");

export async function exportStressReplay(failure: StressFailure): Promise<boolean> {
  if (!isTauri()) return false;
  const path = await save({ title: "导出反例重放包", defaultPath: `failure-${failure.index}.lightcp-replay.json`, filters: [{ name: "LightCP 重放包", extensions: ["json"] }] });
  if (!path) return false;
  await invoke("export_stress_replay", { path, failure });
  return true;
}

export async function chooseReplayFile(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const path = await open({ title: "选择重放包并编译运行其中的 C++ 源码", multiple: false, filters: [{ name: "LightCP 重放包", extensions: ["json"] }] });
  return typeof path === "string" ? path : undefined;
}

export const replayStressTest = (path: string, sessionId: string, compilerPath: string) => invoke<StressSummary>("replay_stress_test", { path, sessionId, compilerPath });

export async function chooseCppSource(title: string): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const selected = await open({
    title,
    directory: false,
    multiple: false,
    filters: [{ name: "C++ 源文件", extensions: ["cpp", "cc", "cxx"] }],
  });
  return typeof selected === "string" ? selected : undefined;
}
