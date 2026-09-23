import { invoke } from "@tauri-apps/api/core";
import type { AuthUser } from "../types/auth";

export function restoreAuth(): Promise<AuthUser | null> {
  return invoke<AuthUser | null>("auth_restore");
}

export function register(username: string, email: string, password: string): Promise<AuthUser> {
  return invoke<AuthUser>("auth_register", { username, email, password });
}

export function login(identifier: string, password: string): Promise<AuthUser> {
  return invoke<AuthUser>("auth_login", { identifier, password });
}

export function getCurrentUser(): Promise<AuthUser> {
  return invoke<AuthUser>("auth_me");
}

export function logout(): Promise<void> {
  return invoke<void>("auth_logout");
}

export function forgotPassword(email: string): Promise<void> {
  return invoke<void>("auth_forgot_password", { email });
}

export function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
  return invoke<void>("auth_reset_password", { email, code, newPassword });
}
