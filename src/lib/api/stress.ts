import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { StressRunRequest, StressSummary } from "../types/stress";

export const startStressTest = (request: StressRunRequest) =>
  invoke<StressSummary>("start_stress_test", { request });

export const stopStressTest = () => invoke<boolean>("stop_stress_test");

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
