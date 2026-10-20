import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ checkAppUpdate: vi.fn(), openUpdateUrl: vi.fn(), getVersion: vi.fn() }));
vi.mock("../api/updates", () => api);
vi.mock("@tauri-apps/api/app", () => ({ getVersion: api.getVersion }));

import { UpdatesStore } from "./updates.svelte";

describe("update checks", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("uses the native version and reports an available release", async () => {
    const store = new UpdatesStore();
    api.getVersion.mockResolvedValue("0.1.1-dev.5");
    await store.loadVersion();
    expect(store.version).toBe("0.1.1-dev.5");
    const result = { currentVersion: "0.1.1-dev.5", status: "updateAvailable", release: { version: "0.1.1-dev.6" } };
    api.checkAppUpdate.mockResolvedValue(result);
    await store.check();
    expect(store.result).toEqual(result);
    expect(store.checkedAt).toBeInstanceOf(Date);
    expect(store.checking).toBe(false);
  });

  it("does not keep a previous up-to-date result when the next check fails and supports retry", async () => {
    const store = new UpdatesStore();
    api.checkAppUpdate.mockResolvedValue({ currentVersion: "0.1.1", status: "upToDate", release: null });
    await store.check();
    api.checkAppUpdate.mockRejectedValue("检查更新超时，请检查网络后重试。");
    await store.check();
    expect(store.error).toContain("超时");
    expect(store.result).toBeUndefined();
    expect(store.checkedAt).toBeUndefined();
    expect(store.checking).toBe(false);
    api.checkAppUpdate.mockResolvedValue({ currentVersion: "0.1.1", status: "noRelease", release: null });
    await store.check();
    expect(store.error).toBe("");
    expect(store.result?.status).toBe("noRelease");
  });

  it("allows only one check at a time", async () => {
    let finish!: (result: unknown) => void;
    api.checkAppUpdate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const store = new UpdatesStore();
    const pending = store.check();
    await store.check();
    expect(api.checkAppUpdate).toHaveBeenCalledTimes(1);
    expect(store.checking).toBe(true);
    finish({ currentVersion: "0.1.1", status: "upToDate", release: null });
    await pending;
    expect(store.checking).toBe(false);
  });

  it("never downloads without a click and shows browser-open failures separately", async () => {
    const store = new UpdatesStore();
    api.checkAppUpdate.mockResolvedValue({ currentVersion: "0.1.1", status: "updateAvailable", release: { pageUrl: "https://github.com/120second/IDE/releases" } });
    await store.check();
    expect(api.openUpdateUrl).not.toHaveBeenCalled();
    api.openUpdateUrl.mockRejectedValue(new Error("无法打开浏览器"));
    await store.open("https://github.com/120second/IDE/releases");
    expect(store.openError).toBe("无法打开浏览器");
    expect(store.result?.status).toBe("updateAvailable");
    expect(store.opening).toBe(false);
  });
});
