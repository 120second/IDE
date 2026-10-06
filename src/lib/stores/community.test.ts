import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../types/auth";

const communityApi = vi.hoisted(() => ({
  listChatMessages: vi.fn(),
  listConversations: vi.fn(),
  searchCommunityUsers: vi.fn(),
  sendChatMessage: vi.fn(),
  updateCommunityProfile: vi.fn(),
}));

vi.mock("../api/community", () => communityApi);

import { CommunityStore } from "./community.svelte";
import type { AuthStore } from "./auth.svelte";

const currentUser: AuthUser = {
  id: "alice-id",
  username: "alice",
  email: "alice@example.com",
  displayName: "Alice",
  bio: "",
  location: "",
  avatarDataUrl: "",
  createdAt: "2026-09-01T00:00:00Z",
};

const bob = {
  id: "bob-id",
  username: "bob",
  displayName: "Bob",
  bio: "Learning graphs",
  location: "",
  avatarDataUrl: "",
  createdAt: "2026-09-02T00:00:00Z",
};

describe("CommunityStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communityApi.listConversations.mockResolvedValue([]);
    communityApi.listChatMessages.mockResolvedValue([]);
    communityApi.searchCommunityUsers.mockResolvedValue([]);
  });

  it("loads conversations and opens a direct message", async () => {
    const auth = { user: currentUser } as AuthStore;
    const store = new CommunityStore(() => auth);

    await store.initialize();
    await store.openConversation(bob);

    expect(communityApi.listConversations).toHaveBeenCalled();
    expect(communityApi.listChatMessages).toHaveBeenCalledWith("bob-id");
    expect(store.selectedUser).toEqual(bob);
  });

  it("appends a sent message and updates the current profile", async () => {
    const auth = { user: currentUser } as AuthStore;
    const store = new CommunityStore(() => auth);
    const sent = {
      id: "message-id",
      senderId: "alice-id",
      recipientId: "bob-id",
      body: "Hello",
      createdAt: "2026-09-27T00:00:00Z",
    };
    communityApi.sendChatMessage.mockResolvedValue(sent);
    communityApi.updateCommunityProfile.mockResolvedValue({ ...currentUser, bio: "Updated" });
    store.selectedUser = bob;

    expect(await store.send("  Hello  ")).toBe(true);
    expect(communityApi.sendChatMessage).toHaveBeenCalledWith("bob-id", "Hello");
    expect(store.messages).toEqual([sent]);

    expect(await store.saveProfile({ displayName: "Alice", bio: "Updated", location: "", avatarDataUrl: "" })).toBe(true);
    expect(auth.user?.bio).toBe("Updated");
  });
});
