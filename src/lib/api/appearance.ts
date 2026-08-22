import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function chooseBackgroundImage(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const selected = await open({
    title: "选择工作台背景图片",
    directory: false,
    multiple: false,
    filters: [
      {
        name: "图片",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
      },
    ],
  });
  return typeof selected === "string" ? selected : undefined;
}
