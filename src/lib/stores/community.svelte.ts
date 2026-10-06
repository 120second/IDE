import {
  listChatMessages,
  listConversations,
  searchCommunityUsers,
  sendChatMessage,
  updateCommunityProfile,
} from "../api/community";
import type { ChatMessage, CommunityUser, Conversation, ProfileUpdate } from "../types/community";
import type { AuthStore } from "./auth.svelte";

export class CommunityStore {
  conversations = $state.raw<Conversation[]>([]);
  searchResults = $state.raw<CommunityUser[]>([]);
  messages = $state.raw<ChatMessage[]>([]);
  selectedUser = $state<CommunityUser>();
  loading = $state(false);
  messagesLoading = $state(false);
  savingProfile = $state(false);
  sending = $state(false);
  error = $state("");
  private conversationRequest = 0;
  private searchRequest = 0;
  private messageRequest = 0;

  constructor(private readonly getAuth: () => AuthStore) {}

  async initialize(): Promise<void> {
    if (!this.getAuth().user) return;
    this.loading = true;
    this.error = "";
    try {
      await this.refreshConversations();
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.loading = false;
    }
  }

  async refreshConversations(): Promise<void> {
    if (!this.getAuth().user) return;
    const request = ++this.conversationRequest;
    try {
      const conversations = await listConversations();
      if (request === this.conversationRequest) this.conversations = conversations;
    } catch (error) {
      if (request === this.conversationRequest) this.error = errorMessage(error);
    }
  }

  async search(query: string): Promise<void> {
    if (!this.getAuth().user) return;
    const request = ++this.searchRequest;
    this.error = "";
    try {
      const results = await searchCommunityUsers(query.trim());
      if (request === this.searchRequest) this.searchResults = results;
    } catch (error) {
      if (request === this.searchRequest) this.error = errorMessage(error);
    }
  }

  async openConversation(user: CommunityUser): Promise<void> {
    this.selectedUser = user;
    this.messagesLoading = true;
    this.error = "";
    const request = ++this.messageRequest;
    try {
      const messages = await listChatMessages(user.id);
      if (request === this.messageRequest) this.messages = messages;
      await this.refreshConversations();
    } catch (error) {
      if (request === this.messageRequest) this.error = errorMessage(error);
    } finally {
      if (request === this.messageRequest) this.messagesLoading = false;
    }
  }

  async refreshMessages(): Promise<void> {
    const user = this.selectedUser;
    if (!user || !this.getAuth().user || this.messagesLoading || this.sending) return;
    const request = ++this.messageRequest;
    try {
      const messages = await listChatMessages(user.id);
      if (request === this.messageRequest) this.messages = messages;
      await this.refreshConversations();
    } catch {
      // Background polling stays quiet; explicit actions surface errors.
    }
  }

  async send(body: string): Promise<boolean> {
    const recipient = this.selectedUser;
    const text = body.trim();
    if (!recipient || !text || this.sending) return false;
    this.sending = true;
    this.error = "";
    try {
      const message = await sendChatMessage(recipient.id, text);
      this.messages = [...this.messages, message];
      await this.refreshConversations();
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      return false;
    } finally {
      this.sending = false;
    }
  }

  async saveProfile(profile: ProfileUpdate): Promise<boolean> {
    if (!this.getAuth().user || this.savingProfile) return false;
    this.savingProfile = true;
    this.error = "";
    try {
      this.getAuth().user = await updateCommunityProfile(profile);
      return true;
    } catch (error) {
      this.error = errorMessage(error);
      return false;
    } finally {
      this.savingProfile = false;
    }
  }

  reset(): void {
    this.conversationRequest += 1;
    this.searchRequest += 1;
    this.messageRequest += 1;
    this.conversations = [];
    this.searchResults = [];
    this.messages = [];
    this.selectedUser = undefined;
    this.error = "";
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { technicalMessage?: unknown; userMessage?: unknown };
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
