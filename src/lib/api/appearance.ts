import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface BackgroundImageSelection {
  path: string;
  name: string;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif"];

export async function selectBackgroundImage(): Promise<BackgroundImageSelection | undefined> {
  if (isTauri()) {
    const selected = await open({
      title: "选择 LightCP 背景图片",
      directory: false,
      multiple: false,
      filters: [{ name: "图片", extensions: IMAGE_EXTENSIONS }],
    });
    if (typeof selected !== "string") return undefined;
    return invoke<BackgroundImageSelection>("install_background_image", { path: selected });
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      if (!file.type.startsWith("image/")) {
        reject(new Error("请选择 PNG、JPEG、WebP 或 AVIF 图片。"));
        return;
      }
      resolve({ path: URL.createObjectURL(file), name: file.name });
    };
    input.click();
  });
}
