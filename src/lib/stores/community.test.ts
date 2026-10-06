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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

it("keeps a late send in its original conversation", async () => {
  const auth = { user: currentUser } as AuthStore;
  const store = new CommunityStore(() => auth);
  const pending = deferred<import("../types/community").ChatMessage>();
  communityApi.listChatMessages.mockResolvedValue([]);
  communityApi.listConversations.mockResolvedValue([]);
  communityApi.sendChatMessage.mockReturnValue(pending.promise);
  await store.openConversation(bob);
  const send = store.send("Hello Bob");
  await store.openConversation({ ...bob, id: "carol-id", username: "carol" });
  pending.resolve({ id: "late", senderId: currentUser.id, recipientId: bob.id, body: "Hello Bob", createdAt: "2026-10-06T00:00:00Z" });
  await send;
  expect(store.messages).toEqual([]);
});

it("does not restore a signed-out account from a late profile response", async () => {
  const auth = { user: currentUser } as AuthStore;
  const store = new CommunityStore(() => auth);
  const pending = deferred<AuthUser>();
  communityApi.updateCommunityProfile.mockReturnValue(pending.promise);
  const save = store.saveProfile({ displayName: "Alice", bio: "", location: "", avatarDataUrl: "" });
  auth.user = undefined;
  store.reset();
  pending.resolve({ ...currentUser, bio: "late" });
  expect(await save).toBe(false);
  expect(auth.user).toBeUndefined();
  expect(store.savingProfile).toBe(false);
});

it("retains loaded history and deduplicates background refreshes", async () => {
  const auth = { user: currentUser } as AuthStore;
  const store = new CommunityStore(() => auth);
  communityApi.listConversations.mockResolvedValue([]);
  const recent = Array.from({ length: 80 }, (_, i) => ({ id: `recent-${i}`, senderId: bob.id, recipientId: currentUser.id, body: `${i}`, createdAt: `2026-10-06T00:00:${String(i % 60).padStart(2, "0")}Z` }));
  communityApi.listChatMessages.mockResolvedValueOnce(recent);
  await store.openConversation(bob);
  const first = store.messages[0].id;
  communityApi.listChatMessages.mockResolvedValueOnce([{ ...recent[0], id: "old", createdAt: "2026-09-01T00:00:00Z" }]);
  await store.loadOlder();
  expect(communityApi.listChatMessages).toHaveBeenLastCalledWith(bob.id, first);
  communityApi.listChatMessages.mockResolvedValueOnce(recent);
  await store.refreshMessages();
  expect(store.messages).toHaveLength(81);
  expect(store.messages[0].id).toBe("old");
});
