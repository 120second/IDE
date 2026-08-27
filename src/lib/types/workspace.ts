export type EntryKind = "file" | "directory" | "symlink";

export interface FileEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size?: number;
  modifiedAt?: number;
}

export interface FileContent {
  path: string;
  content: string;
  modifiedAt?: number;
  revision: string;
}

export interface WriteTextResult {
  status: "saved" | "conflict";
  path: string;
  revision: string;
}

export interface FileRevision {
  path: string;
  revision: string;
}

export interface PathResult {
  path: string;
}

export interface WorkspaceInfo {
  name: string;
  path: string;
}

export interface WorkspaceChange {
  kind: "created" | "deleted" | "renamed" | "changed";
  paths: string[];
}

export interface WorkspaceFileMatch {
  path: string;
  relativePath: string;
}

export interface WorkspaceFileResponse {
  results: WorkspaceFileMatch[];
  limitHit: boolean;
  filesScanned: number;
  durationMs: number;
}

export interface TreeRow {
  entry: FileEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
}
