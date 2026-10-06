export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  bio: string;
  location: string;
  avatarDataUrl: string;
  createdAt: string;
}

export type AuthScreen = "login" | "register" | "forgot" | "reset";

