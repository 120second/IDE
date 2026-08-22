export interface HealthStatus {
  status: "ready";
  application: string;
  version: string;
  databaseSchemaVersion: number;
}

export interface ToolStatus {
  available: boolean;
  requested: string;
  resolvedPath?: string;
}

export interface ToolchainStatus {
  compiler: ToolStatus;
  debugger: ToolStatus;
  languageServer: ToolStatus;
}

export interface CommandError {
  category:
    | "FILE_SYSTEM"
    | "DATABASE"
    | "PROCESS"
    | "CONFIGURATION"
    | "INTERNAL";
  code: string;
  userMessage: string;
  technicalMessage: string;
}

