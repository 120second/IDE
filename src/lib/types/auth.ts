export interface AuthUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export type AuthScreen = "login" | "register" | "forgot" | "reset";

