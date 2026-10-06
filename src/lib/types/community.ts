export interface CommunityUser {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  location: string;
  avatarDataUrl: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt?: string;
}

export interface Conversation {
  user: CommunityUser;
  lastMessage: ChatMessage;
  unreadCount: number;
}

export interface ProfileUpdate {
  displayName: string;
  bio: string;
  location: string;
  avatarDataUrl: string;
}
