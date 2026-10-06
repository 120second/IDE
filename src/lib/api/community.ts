import { invoke } from "@tauri-apps/api/core";
import type { AuthUser } from "../types/auth";
import type { ChatMessage, CommunityUser, Conversation, ProfileUpdate } from "../types/community";

export function updateCommunityProfile(profile: ProfileUpdate): Promise<AuthUser> {
  return invoke<AuthUser>("update_community_profile", {
    displayName: profile.displayName,
    bio: profile.bio,
    location: profile.location,
    avatarDataUrl: profile.avatarDataUrl,
  });
}

export function searchCommunityUsers(query: string): Promise<CommunityUser[]> {
  return invoke<CommunityUser[]>("search_community_users", { query });
}

export function listConversations(): Promise<Conversation[]> {
  return invoke<Conversation[]>("list_conversations");
}

export function listChatMessages(userId: string, beforeId?: string): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>("list_chat_messages", { userId, beforeId });
}

export function sendChatMessage(recipientId: string, body: string): Promise<ChatMessage> {
  return invoke<ChatMessage>("send_chat_message", { recipientId, body });
}
