import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export async function importThemeDocument(): Promise<string | undefined> {
  if (isTauri()) {
    const selected = await open({
      title: "导入 LightCP 主题",
      directory: false,
      multiple: false,
      filters: [{ name: "LightCP 主题", extensions: ["json", "lightcp-theme"] }],
    });
    return typeof selected === "string"
      ? invoke<string>("read_theme_file", { path: selected })
      : undefined;
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.lightcp-theme,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      file.text().then(resolve, reject);
    };
    input.click();
  });
}

export async function exportThemeDocument(fileName: string, content: string): Promise<boolean> {
  if (isTauri()) {
    const selected = await save({
      title: "导出 LightCP 主题",
      defaultPath: `${safeFileName(fileName)}.lightcp-theme.json`,
      filters: [{ name: "LightCP 主题", extensions: ["json"] }],
    });
    if (!selected) return false;
    await invoke("write_theme_file", { path: selected, content });
    return true;
  }

  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(fileName)}.lightcp-theme.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/[. ]+$/g, "").slice(0, 64)
    || "lightcp-theme";
}
