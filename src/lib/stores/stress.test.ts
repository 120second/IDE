import { beforeEach, expect, it, vi } from "vitest";
import { defaultVisualProfile } from "../generator/visualRules";
import type { StressEvent, StressSummary } from "../types/stress";

const api = vi.hoisted(() => ({ chooseCppSource: vi.fn(), chooseReplayFile: vi.fn(), exportStressReplay: vi.fn(), replayStressTest: vi.fn(), startStressTest: vi.fn(), stopStressTest: vi.fn() }));
const events = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("../api/stress", () => api);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => events);
import { StressStore } from "./stress.svelte";

function fixture(save = vi.fn().mockResolvedValue(true)) {
  const editor = { activeTab: { path: "D:\\Code\\solution.cpp", dirty: true }, saveActive: save, notice: "save failed" };
  const generator = { seed: "123", loading: false, valid: true, profile: defaultVisualProfile() };
  const settings = { value: { compilerPath: "g++", compilerStandard: "c++20", releaseArgs: ["-O2"], debugArgs: ["-g"], maxOutputBytes: 65536, runTimeoutMs: 1000 } };
  const store = new StressStore(editor as never, generator as never, { running: false, compiling: false } as never, { active: false } as never, settings as never, {} as never);
  store.brutePath = "D:\\Code\\brute.cpp";
  return { editor, store };
}
const summary = (sessionId: string): StressSummary => ({ sessionId, status: "completed", message: "done", nextSeed: "124", stats: { totalCases: 1, passed: 1, failed: 0, elapsedMs: 1, casesPerSecond: 1000 } });

beforeEach(() => {
  vi.resetAllMocks();
  api.stopStressTest.mockResolvedValue(false);
  events.listen.mockResolvedValue(vi.fn());
});

it.each([true, false])("blocks duplicate starts and honors stop while source saving resolves to %s", async (saved) => {
  let finish!: (value: boolean) => void;
  const { store } = fixture(vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })));
  const launch = store.start();
  expect(store.running).toBe(true);
  await store.start();
  await store.stop();
  finish(saved);
  await launch;
  expect(api.startStressTest).not.toHaveBeenCalled();
  expect(store.running).toBe(false);
  expect(store.stopping).toBe(false);
});

it("ignores a pending source save after the store is disposed", async () => {
  let finish!: (value: boolean) => void;
  const { store } = fixture(vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })));
  const launch = store.start();
  store.dispose();
  finish(true);
  await launch;
  expect(api.startStressTest).not.toHaveBeenCalled();
});

it("applies live progress before the final response and ignores another session", async () => {
  let handler!: (event: { payload: StressEvent }) => void;
  events.listen.mockImplementation(async (_: string, receive: typeof handler) => { handler = receive; return vi.fn(); });
  let finish!: (value: StressSummary) => void;
  api.startStressTest.mockImplementation(() => new Promise<StressSummary>(resolve => { finish = resolve; }));
  const { store } = fixture();
  await store.initialize();
  const launch = store.start();
  await vi.waitFor(() => expect(api.startStressTest).toHaveBeenCalledOnce());
  handler({ payload: { kind: "state", sessionId: "other", status: "error", message: "wrong" } });
  expect(store.status).toBe("compiling");
  handler({ payload: { kind: "casesPassed", sessionId: store.sessionId, results: [{ index: 1, seed: "123", solutionTimeMs: 1, bruteTimeMs: 2, stats: summary(store.sessionId).stats }] } });
  expect(store.logs).toHaveLength(1);
  expect(store.stats.passed).toBe(1);
  finish(summary(store.sessionId));
  await launch;
  store.dispose();
});

it("keeps the existing result when the replay picker is cancelled", async () => {
  api.chooseReplayFile.mockResolvedValue(undefined);
  const { store } = fixture();
  store.status = "failed";
  await store.importReplay();
  expect(store.status).toBe("failed");
  expect(api.replayStressTest).not.toHaveBeenCalled();
});

it("uses the local compiler when replaying and retains matching outputs", async () => {
  api.chooseReplayFile.mockResolvedValue("D:\\saved.json");
  api.replayStressTest.mockImplementation(async (_path: string, sessionId: string) => ({ ...summary(sessionId), replayResult: { index: 1, seed: "123", nextSeed: "124", reason: "本次重放输出一致", input: "7\n", solutionOutput: "7\n", bruteOutput: "7\n", solutionStderr: "", bruteStderr: "", solutionTimeMs: 1, bruteTimeMs: 1, stats: summary(sessionId).stats } }));
  const { editor, store } = fixture();
  await store.importReplay();
  expect(api.replayStressTest).toHaveBeenCalledWith("D:\\saved.json", expect.stringContaining("replay-"), "g++");
  expect(store.replayMode).toBe(true);
  expect(store.failure?.reason).toBe("本次重放输出一致");
  expect(editor.saveActive).not.toHaveBeenCalled();
});
