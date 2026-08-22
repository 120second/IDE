import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  FileContent,
  FileEntry,
  FileRevision,
  PathResult,
  WriteTextResult,
  WorkspaceInfo,
} from "../types/workspace";

export async function chooseWorkspaceFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const selection = await open({
    title: "打开 LightCP 工作区",
    directory: true,
    multiple: false,
  });
  return typeof selection === "string" ? selection : null;
}

export function openWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("open_workspace", { path });
}

export function listRecentWorkspaces(): Promise<WorkspaceInfo[]> {
  return isTauri() ? invoke<WorkspaceInfo[]>("list_recent_workspaces") : Promise.resolve([]);
}

export function listDirectory(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_directory", { path });
}

export function readTextFile(path: string): Promise<FileContent> {
  return invoke<FileContent>("read_text_file", { path });
}

export function getTextFileRevision(path: string): Promise<FileRevision> {
  return invoke<FileRevision>("get_text_file_revision", { path });
}

export function writeTextFile(
  path: string,
  content: string,
  expectedRevision: string,
): Promise<WriteTextResult> {
  return invoke<WriteTextResult>("write_text_file", { path, content, expectedRevision });
}

export function createFile(parent: string, name: string, content = ""): Promise<PathResult> {
  return invoke<PathResult>("create_file", { parent, name, content });
}

export function createDirectory(parent: string, name: string): Promise<PathResult> {
  return invoke<PathResult>("create_directory", { parent, name });
}

export function renameEntry(path: string, newName: string): Promise<PathResult> {
  return invoke<PathResult>("rename_entry", { path, newName });
}

export function deleteEntry(path: string): Promise<void> {
  return invoke<void>("delete_entry", { path });
}

export function moveEntry(source: string, targetDirectory: string): Promise<PathResult> {
  return invoke<PathResult>("move_entry", { source, targetDirectory });
}
