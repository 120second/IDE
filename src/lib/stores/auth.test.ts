import { beforeEach, describe, expect, it, vi } from "vitest";

const authApi = vi.hoisted(() => ({
  restoreAuth: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("../api/auth", () => authApi);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { AuthStore } from "./auth.svelte";

const user = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  createdAt: "2026-09-23T00:00:00Z",
};

describe("AuthStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.restoreAuth.mockResolvedValue(null);
    authApi.logout.mockResolvedValue(undefined);
  });

  it("restores an existing credential and exposes the user", async () => {
    authApi.restoreAuth.mockResolvedValue(user);
    const store = new AuthStore();

    await store.initialize();

    expect(store.loading).toBe(false);
    expect(store.connection).toBe("online");
    expect(store.user).toEqual(user);
  });

  it("falls back to offline mode when the cloud server is unavailable", async () => {
    authApi.restoreAuth.mockRejectedValue(new Error("server unavailable"));
    const store = new AuthStore();

    await store.initialize();

    expect(store.loading).toBe(false);
    expect(store.connection).toBe("offline");
    expect(store.user).toBeUndefined();
    expect(store.error).toBe("server unavailable");
  });

  it("keeps reset state without persisting secrets in browser storage", async () => {
    authApi.forgotPassword.mockResolvedValue(undefined);
    authApi.resetPassword.mockResolvedValue(undefined);
    const store = new AuthStore();
    await store.initialize();

    expect(await store.sendResetCode("alice@example.com")).toBe(true);
    expect(store.screen).toBe("reset");
    expect(store.resetEmail).toBe("alice@example.com");

    expect(await store.completeReset("alice@example.com", "123456", "new-password")).toBe(true);
    expect(store.screen).toBe("login");
    expect(authApi.resetPassword).toHaveBeenCalledWith(
      "alice@example.com",
      "123456",
      "new-password",
    );
  });

  it("clears the in-memory user after credential-store logout", async () => {
    authApi.restoreAuth.mockResolvedValue(user);
    const store = new AuthStore();
    await store.initialize();

    await store.signOut();

    expect(authApi.logout).toHaveBeenCalledOnce();
    expect(store.user).toBeUndefined();
  });
});
