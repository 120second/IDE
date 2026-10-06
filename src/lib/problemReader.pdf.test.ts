import { afterEach, expect, it, vi } from "vitest";
import { saveProblemPdf } from "./problemReader";
afterEach(() => vi.unstubAllGlobals());
it("waits for transaction commit and reports abort even after the blob request succeeds", async () => {
  const put = vi.fn();
  const close = vi.fn();
  const transaction = {
    objectStore: () => ({ put }),
    oncomplete: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    error: new Error("quota exceeded"),
  };
  vi.stubGlobal("indexedDB", { open: () => {
      const request = { result: { transaction: () => transaction, close }, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } });
  let settled = false;
  const result = saveProblemPdf("a", new Blob(["PDF"]));
  const assertion = expect(result).rejects.toThrow("quota exceeded");
  void result.then(() => { settled = true; }, () => { settled = true; });
  await vi.waitFor(() => expect(put).toHaveBeenCalled());
  expect(settled).toBe(false);
  transaction.onabort?.();
  await assertion;
  expect(close).toHaveBeenCalledOnce();
});
