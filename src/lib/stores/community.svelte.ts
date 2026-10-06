import { listChatMessages, listConversations, searchCommunityUsers, sendChatMessage, updateCommunityProfile } from "../api/community";
import type { ChatMessage, CommunityUser, Conversation, ProfileUpdate } from "../types/community";
import type { AuthStore } from "./auth.svelte";
const PAGE_SIZE = 80;
type RequestContext = {
  generation: number;
  account: string | undefined;
};
export class CommunityStore {
  conversations = $state.raw<Conversation[]>([]);
  searchResults = $state.raw<CommunityUser[]>([]);
  messages = $state.raw<ChatMessage[]>([]);
  selectedUser = $state<CommunityUser>();
  loading = $state(false);
  messagesLoading = $state(false);
  olderLoading = $state(false);
  hasOlder = $state(false);
  savingProfile = $state(false);
  sending = $state(false);
  error = $state("");
  private generation = 0;
  private conversationRequest = 0;
  private searchRequest = 0;
  private messageRequest = 0;
  constructor(private readonly getAuth: () => AuthStore) { }
  private context(): RequestContext { return { generation: this.generation, account: this.getAuth().user?.id }; }
  private current(context: RequestContext): boolean {
    return Boolean(context.account && context.generation === this.generation && context.account === this.getAuth().user?.id);
  }
  async initialize(): Promise<void> {
    const context = this.context();
    if (!context.account)
      return;
    this.loading = true;
    this.error = "";
    try {
      await this.refreshConversations();
    }
    finally {
      if (this.current(context))
        this.loading = false;
    }
  }
  async refreshConversations(): Promise<void> {
    const context = this.context();
    if (!context.account)
      return;
    const request = ++this.conversationRequest;
    try {
      const conversations = await listConversations();
      if (this.current(context) && request === this.conversationRequest)
        this.conversations = conversations;
    }
    catch (error) {
      if (this.current(context) && request === this.conversationRequest)
        this.error = errorMessage(error);
    }
  }
  async search(query: string): Promise<void> {
    const context = this.context();
    if (!context.account)
      return;
    const request = ++this.searchRequest;
    this.error = "";
    try {
      const results = await searchCommunityUsers(query.trim());
      if (this.current(context) && request === this.searchRequest)
        this.searchResults = results;
    }
    catch (error) {
      if (this.current(context) && request === this.searchRequest)
        this.error = errorMessage(error);
    }
  }
  async openConversation(user: CommunityUser): Promise<void> {
    const context = this.context();
    if (!context.account)
      return;
    this.selectedUser = user;
    this.messages = [];
    this.hasOlder = this.olderLoading = false;
    this.messagesLoading = true;
    this.error = "";
    const request = ++this.messageRequest;
    try {
      const messages = await listChatMessages(user.id);
      if (!this.current(context) || request !== this.messageRequest)
        return;
      this.messages = mergeMessages(this.messages, messages);
      this.hasOlder = messages.length === PAGE_SIZE;
      await this.refreshConversations();
    }
    catch (error) {
      if (this.current(context) && request === this.messageRequest)
        this.error = errorMessage(error);
    }
    finally {
      if (this.current(context) && request === this.messageRequest)
        this.messagesLoading = false;
    }
  }
  async loadOlder(): Promise<void> {
    const context = this.context();
    const user = this.selectedUser;
    const first = this.messages[0];
    if (!context.account || !user || !first || !this.hasOlder || this.olderLoading || this.messagesLoading)
      return;
    const request = this.messageRequest;
    this.olderLoading = true;
    try {
      const messages = await listChatMessages(user.id, first.id);
      if (!this.current(context) || request !== this.messageRequest || this.selectedUser?.id !== user.id)
        return;
      this.messages = mergeMessages(this.messages, messages);
      this.hasOlder = messages.length === PAGE_SIZE;
    }
    catch (error) {
      if (this.current(context) && request === this.messageRequest)
        this.error = errorMessage(error);
    }
    finally {
      if (this.current(context) && request === this.messageRequest)
        this.olderLoading = false;
    }
  }
  async refreshMessages(): Promise<void> {
    const context = this.context();
    const user = this.selectedUser;
    if (!user || !context.account || this.messagesLoading || this.sending)
      return;
    const request = this.messageRequest;
    try {
      const messages = await listChatMessages(user.id);
      if (!this.current(context) || request !== this.messageRequest || this.selectedUser?.id !== user.id)
        return;
      this.messages = mergeMessages(this.messages, messages);
      await this.refreshConversations();
    }
    catch { /* Explicit actions surface errors; background refresh remains quiet. */ }
  }
  async send(body: string): Promise<boolean> {
    const context = this.context();
    const recipient = this.selectedUser;
    const text = body.trim();
    if (!context.account || !recipient || !text || this.sending)
      return false;
    this.sending = true;
    this.error = "";
    try {
      const message = await sendChatMessage(recipient.id, text);
      if (!this.current(context))
        return false;
      if (this.selectedUser?.id === recipient.id)
        this.messages = mergeMessages(this.messages, [message]);
      await this.refreshConversations();
      return true;
    }
    catch (error) {
      if (this.current(context))
        this.error = errorMessage(error);
      return false;
    }
    finally {
      if (this.current(context))
        this.sending = false;
    }
  }
  async saveProfile(profile: ProfileUpdate): Promise<boolean> {
    const context = this.context();
    if (!context.account || this.savingProfile)
      return false;
    this.savingProfile = true;
    this.error = "";
    try {
      const user = await updateCommunityProfile(profile);
      if (!this.current(context) || user.id !== context.account)
        return false;
      this.getAuth().user = user;
      return true;
    }
    catch (error) {
      if (this.current(context))
        this.error = errorMessage(error);
      return false;
    }
    finally {
      if (this.current(context))
        this.savingProfile = false;
    }
  }
  reset(): void {
    this.generation += 1;
    this.conversationRequest += 1;
    this.searchRequest += 1;
    this.messageRequest += 1;
    this.conversations = [];
    this.searchResults = [];
    this.messages = [];
    this.selectedUser = undefined;
    this.loading = this.messagesLoading = this.olderLoading = this.hasOlder = this.savingProfile = this.sending = false;
    this.error = "";
  }
}
function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming)
    messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as {
      technicalMessage?: unknown;
      userMessage?: unknown;
    };
    if (typeof commandError.userMessage === "string")
      return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string")
      return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
