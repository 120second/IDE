import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultVisualProfile, createTemplate } from "../generator/visualRules";
import type { VisualGenerateRequest, VisualGenerateResult } from "../types/generator";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("../api/generator", () => ({ generateVisualCases: mocks.generate, loadGeneratorProfile: mocks.load, saveGeneratorProfile: mocks.save }));
import { GeneratorStore } from "./generator.svelte";

const result = (seed: string): VisualGenerateResult => ({ cases: [{ seed, input: "3\n1 2 3\n", sizeBytes: 8, generationTimeMicros: 10 }], diagnostics: [] });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(undefined);
  mocks.generate.mockImplementation(async (request: VisualGenerateRequest) => result(request.profile.seed));
});

describe("generator interaction state", () => {
  it("loads previously saved 3n drafts as working expressions and sends the repaired rule", async () => {
    const profile = defaultVisualProfile();
    profile.nodes = createTemplate("string");
    if (profile.nodes[1].type === "line" && profile.nodes[1].fields[0].type === "string") profile.nodes[1].fields[0].length = { type: "constant", value: "3n" };
    mocks.load.mockResolvedValue(profile);
    const store = new GeneratorStore();
    await store.syncSource("string.cpp");
    expect(store.valid).toBe(true);
    await store.generate();
    const request = mocks.generate.mock.calls[0][0] as VisualGenerateRequest;
    expect(request.profile.nodes[1]).toMatchObject({fields:[{length:{type:"arithmetic",operator:"*",left:{value:"3"},right:{name:"n"}}}]});
    store.dispose();
  });
  it("uses fresh seeds by default and replays an explicitly fixed seed", async () => {
    const store = new GeneratorStore();
    const first = await store.generate();
    const second = await store.generate();
    expect(second?.seed).not.toBe(first?.seed);
    store.setSeed("42");
    expect((await store.generate())?.seed).toBe("42");
    expect((await store.generate())?.seed).toBe("42");
    store.setSeedLocked(false);
    expect((await store.generate())?.seed).not.toBe("42");
    store.dispose();
  });

  it("locks a selected preview seed without throwing away that preview", async () => {
    const store = new GeneratorStore();
    const generated = await store.generate();
    store.useSeed(generated!.seed);
    expect(store.selectedCase).toEqual(generated);
    expect(store.seedLocked).toBe(true);
    expect((await store.generate())?.seed).toBe(generated?.seed);
  });

  it("discards a generation result when its format changes while pending", async () => {
    let resolve!: (value: VisualGenerateResult) => void;
    mocks.generate.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const store = new GeneratorStore();
    const pending = store.generate();
    store.setNodes(createTemplate("tree"));
    resolve(result("42"));
    expect(await pending).toBeUndefined();
    expect(store.cases).toEqual([]);
    expect(store.generating).toBe(false);
  });

  it("discards a generation result when the active source changes", async () => {
    const store = new GeneratorStore();
    await store.syncSource("A.cpp");
    let resolve!: (value: VisualGenerateResult) => void;
    mocks.generate.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = store.generate();
    await store.syncSource("B.cpp");
    resolve(result("42"));
    expect(await pending).toBeUndefined();
    expect(store.sourcePath).toBe("B.cpp");
    expect(store.cases).toEqual([]);
    store.dispose();
  });

  it("does not let a source switch waiting for a save override a later source", async () => {
    const store = new GeneratorStore();
    await store.syncSource("A.cpp");
    store.setNodes(createTemplate("matrix"));
    let resolve!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const first = store.syncSource("B.cpp");
    await store.syncSource("C.cpp");
    resolve();
    await first;
    expect(store.sourcePath).toBe("C.cpp");
    expect(store.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ type: "line" })]));
    store.dispose();
  });

  it("rejects invalid fixed seeds and reversed ranges without sending a request", async () => {
    const store = new GeneratorStore();
    store.setSeed("-1");
    expect(await store.generate()).toBeUndefined();
    expect(mocks.generate).not.toHaveBeenCalled();
    const invalid = defaultVisualProfile();
    if (invalid.nodes[0].type === "line" && invalid.nodes[0].fields[0].type === "integer") {
      invalid.nodes[0].fields[0].minimum = { type: "constant", value: "1000" };
    }
    store.setSeed("42");
    store.setNodes(invalid.nodes);
    expect(await store.generate()).toBeUndefined();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
