import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompileResult, Testcase } from "../types/execution";

const executionApi = vi.hoisted(() => ({
  compareTestcaseOutput: vi.fn(),
  compileCurrentFile: vi.fn(),
  createTestcase: vi.fn(),
  deleteTestcase: vi.fn(),
  duplicateTestcase: vi.fn(),
  listTestcases: vi.fn(),
  moveTestcase: vi.fn(),
  runProgram: vi.fn(),
  stopProgram: vi.fn(),
  stopCompilation: vi.fn(),
  updateTestcase: vi.fn(),
}));

vi.mock("../api/execution", () => executionApi);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { ExecutionStore } from "./execution.svelte";

const sourcePath = "D:\\Code\\main.cpp";

function testcase(overrides: Partial<Testcase> = {}): Testcase {
  return {
    id: 1,
    sourcePath,
    kind: "sample",
    name: "样例 1",
    input: "1\n",
    expectedOutput: "1\n",
    enabled: true,
    sortOrder: 0,
    createdAt: "2026-09-25T00:00:00Z",
    updatedAt: "2026-09-25T00:00:00Z",
    ...overrides,
  };
}

function compiled(overrides: Partial<CompileResult> = {}): CompileResult {
  return {
    success: true,
    executablePath: "D:\\Code\\main.exe",
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    outputTruncated: false,
    ...overrides,
  };
}

function fixture(saveActive = vi.fn().mockResolvedValue(true)) {
  const editor = {
    activeTab: { path: sourcePath, dirty: true },
    saveActive,
    notice: "",
  };
  const settings = {
    value: {
      compilerPath: "g++",
      compilerStandard: "c++20",
      releaseArgs: ["-O2"],
      debugArgs: ["-g", "-O0"],
      runTimeoutMs: 2000,
      maxOutputBytes: 2 * 1024 * 1024,
    },
  };
  const shell = { showBottomPanel: vi.fn() };
  const store = new ExecutionStore(editor as never, settings as never, shell as never);
  return { editor, shell, store };
}

describe("execution store coordination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    executionApi.compileCurrentFile.mockResolvedValue(compiled());
    executionApi.listTestcases.mockResolvedValue([]);
  });

  it("does not restore tests after their source is closed during loading", async () => {
    let finish!: (tests: Testcase[]) => void;
    executionApi.listTestcases.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { store } = fixture();
    const pending = store.syncActiveSource(sourcePath);
    await store.syncActiveSource();
    finish([testcase()]);
    await pending;
    expect(store.testcases).toEqual([]);
    expect(store.sourcePath).toBe("");
    expect(store.loadingTestcases).toBe(false);
    store.dispose();
  });

  it("shares in-flight testcase loads and remembers a successful empty list", async () => {
    let finish!: (tests: Testcase[]) => void;
    executionApi.listTestcases.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { store } = fixture();
    const first = store.syncActiveSource(sourcePath);
    const second = store.syncActiveSource(sourcePath);
    finish([]);
    await Promise.all([first, second]);
    await store.syncActiveSource(sourcePath);
    expect(executionApi.listTestcases).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("refuses to compile a testcase from another source", async () => {
    const { store } = fixture();
    await store.runOne(testcase({ sourcePath: "D:\\Code\\other.cpp" }));
    expect(executionApi.compileCurrentFile).not.toHaveBeenCalled();
    expect(store.error).toContain("不一致");
    store.dispose();
  });

  it("still compiles and runs the current file with no testcases", async () => {
    executionApi.runProgram.mockResolvedValue({ status: "exited", stdout: "", stderr: "", exitCode: 0, durationMs: 1, outputTruncated: false });
    const { store } = fixture();
    await store.runCurrent();
    expect(executionApi.compileCurrentFile).toHaveBeenCalledOnce();
    expect(executionApi.runProgram).toHaveBeenCalledOnce();
    store.dispose();
  });

  it.each(["not_cpp", "save_failed"])("visibly explains preflight failure: %s", async (reason) => {
    const { editor, shell, store } = fixture(vi.fn().mockResolvedValue(false));
    if (reason === "not_cpp") editor.activeTab.path = "D:\\Code\\notes.txt";
    await store.compileCurrent();
    expect(store.error).not.toBe("");
    expect(shell.showBottomPanel).toHaveBeenCalledWith("output");
    expect(executionApi.compileCurrentFile).not.toHaveBeenCalled();
    store.dispose();
  });

  it("runs without judging when expected output is empty instead of reporting WA or AC", async () => {
    executionApi.runProgram.mockResolvedValue({ status: "exited", stdout: "42\n", stderr: "", exitCode: 0, durationMs: 1, outputTruncated: false });
    const { store } = fixture();
    await store.runOne(testcase({ expectedOutput: "" }));
    expect(store.results[0].status).toBe("OK");
    expect(executionApi.compareTestcaseOutput).not.toHaveBeenCalled();
    store.dispose();
  });

  it("returns the run result for input/output files without including build logs", async () => {
    const { store } = fixture();
    const result = { clientRunId: "qa", status: "exited", stdout: "5\n", stderr: "", exitCode: 0, durationMs: 5, outputTruncated: false };
    executionApi.runProgram.mockResolvedValue(result);
    expect(await store.runInput("2 3\n", "in.txt → out.txt", sourcePath)).toEqual(result);
    expect(executionApi.runProgram.mock.calls[0][0].stdin).toBe("2 3\n");
    store.dispose();
  });

  it("does not compile another source if the active tab changes before file input runs", async () => {
    const { editor, store } = fixture();
    editor.activeTab.path = "D:\\Code\\other.cpp";
    expect(await store.runInput("old input", "file input", sourcePath)).toBeUndefined();
    expect(executionApi.compileCurrentFile).not.toHaveBeenCalled();
    expect(executionApi.runProgram).not.toHaveBeenCalled();
    expect(store.error).toContain("文件已切换");
    store.dispose();
  });

  it("reserves compilation before awaiting a source save", async () => {
    let finishSave!: (saved: boolean) => void;
    const saveActive = vi.fn(() => new Promise<boolean>((resolve) => { finishSave = resolve; }));
    const { store } = fixture(saveActive);

    const first = store.compileCurrent();
    const duplicate = store.compileCurrent();

    expect(store.compiling).toBe(true);
    expect(saveActive).toHaveBeenCalledTimes(1);
    expect(await duplicate).toBeUndefined();

    finishSave(true);
    await first;

    expect(executionApi.compileCurrentFile).toHaveBeenCalledTimes(1);
    expect(store.compiling).toBe(false);
    store.dispose();
  });

  it("clears a stale result when its testcase data is saved", async () => {
    const original = testcase();
    const changed = testcase({ input: "2\n", expectedOutput: "2\n" });
    executionApi.updateTestcase.mockResolvedValue(changed);
    executionApi.listTestcases.mockResolvedValue([changed]);
    const { store } = fixture();
    store.sourcePath = sourcePath;
    store.testcases = [original];
    store.results = [{
      testcaseId: original.id,
      name: original.name,
      status: "AC",
      durationMs: 1,
      actualOutput: "1\n",
      expectedOutput: "1\n",
      stderr: "",
      exitCode: 0,
    }];

    const saved = await store.saveTestcase({
      sourcePath,
      kind: changed.kind,
      name: changed.name,
      input: changed.input,
      expectedOutput: changed.expectedOutput,
      enabled: changed.enabled,
    }, changed.id);

    expect(saved?.input).toBe("2\n");
    expect(store.testcases).toEqual([changed]);
    expect(store.results).toEqual([]);
    store.dispose();
  });

  it("uses a testcase draft supplied immediately before running", async () => {
    const original = testcase();
    const changed = testcase({ input: "2\n", expectedOutput: "4\n" });
    executionApi.runProgram.mockResolvedValue({
      status: "exited",
      stdout: "4\n",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      outputTruncated: false,
    });
    executionApi.compareTestcaseOutput.mockResolvedValue(true);
    const { store } = fixture();
    store.setBeforeTestRun(async (id) => id === original.id ? changed : undefined);

    await store.runOne(original);

    expect(executionApi.runProgram).toHaveBeenCalledWith(expect.objectContaining({ stdin: "2\n" }));
    expect(executionApi.compareTestcaseOutput).toHaveBeenCalledWith("4\n", "4\n");
    expect(store.results[0]).toMatchObject({ testcaseId: original.id, status: "AC", expectedOutput: "4\n" });
    store.dispose();
  });
});


it.each([true, false])("stops before compilation when a pending source save resolves to %s", async (saved) => {
  executionApi.compileCurrentFile.mockClear();
  let finishSave!: (saved: boolean) => void;
  const { store } = fixture(vi.fn(() => new Promise<boolean>((resolve) => { finishSave = resolve; })));
  const compile = store.compileCurrent();
  await store.stop();
  finishSave(saved);
  expect(await compile).toBeUndefined();
  expect(executionApi.compileCurrentFile).not.toHaveBeenCalled();
  expect(store.compiling).toBe(false);
  expect(store.stopping).toBe(false);
  expect(store.error).toBe("");
  store.dispose();
});
