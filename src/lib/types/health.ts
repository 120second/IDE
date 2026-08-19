export interface HealthStatus {
  status: "ready";
  application: string;
  version: string;
  databaseSchemaVersion: number;
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

