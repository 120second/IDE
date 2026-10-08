import {
  generateVisualCases,
  loadGeneratorProfile,
  saveGeneratorProfile,
} from "../api/generator";
import { defaultVisualProfile, validateVisualProfile } from "../generator/visualRules";
import { normalizeSavedExpressions } from "../generator/valueExpression";
import type {
  GeneratedCase,
  GeneratorStrategy,
  TreeShape,
  VisualDiagnostic,
  VisualGeneratorProfile,
  VisualNode,
} from "../types/generator";

export class GeneratorStore {
  nodes = $state.raw<VisualNode[]>(defaultVisualProfile().nodes);
  strategy = $state<GeneratorStrategy>("random");
  treeShape = $state<TreeShape>("mixed");
  seed = $state("16574989564519419765");
  seedLocked = $state(false);
  count = $state(1);
  cases = $state.raw<GeneratedCase[]>([]);
  selectedIndex = $state(0);
  diagnostics = $state.raw<VisualDiagnostic[]>([]);
  sourcePath = $state("");
  loading = $state(false);
  generating = $state(false);
  saving = $state(false);
  error = $state("");
  editorRequested = $state(false);

  private sourceRequest = 0;
  private revision = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.revalidate();
  }

  get selectedCase(): GeneratedCase | undefined {
    return this.cases[this.selectedIndex];
  }

  get valid(): boolean {
    return this.diagnostics.length === 0;
  }

  get profile(): VisualGeneratorProfile {
    return {
      version: 1,
      nodes: this.nodes,
      strategy: this.strategy,
      treeShape: this.treeShape,
      seed: this.seed,
      seedLocked: this.seedLocked,
    };
  }

  async syncSource(sourcePath?: string): Promise<void> {
    const source = sourcePath ?? "";
    if (source === this.sourcePath) return;
    const request = ++this.sourceRequest;
    if (this.saveTimer && this.sourcePath) {
      const previousSource = this.sourcePath;
      const previousProfile = structuredClone(this.profile);
      this.cancelScheduledSave();
      try {
        await saveGeneratorProfile(previousSource, previousProfile);
      } catch (error) {
        if (request === this.sourceRequest) this.error = errorMessage(error);
      }
    } else {
      this.cancelScheduledSave();
    }
    if (request !== this.sourceRequest) return;
    this.sourcePath = source;
    this.saving = false;
    this.revision += 1;
    this.error = "";
    this.clearPreview();
    if (!source) {
      this.loading = false;
      this.applyProfile(defaultVisualProfile());
      return;
    }
    this.loading = true;
    try {
      const profile = await loadGeneratorProfile(source);
      if (request !== this.sourceRequest) return;
      this.applyProfile(profile ?? defaultVisualProfile());
    } catch (error) {
      if (request !== this.sourceRequest) return;
      this.error = errorMessage(error);
      this.applyProfile(defaultVisualProfile());
    } finally {
      if (request === this.sourceRequest) this.loading = false;
    }
  }

  setNodes(nodes: VisualNode[]): void {
    this.nodes = nodes;
    this.changed();
  }

  setStrategy(strategy: GeneratorStrategy): void {
    this.strategy = strategy;
    this.changed();
  }

  setTreeShape(shape: TreeShape): void {
    this.treeShape = shape;
    this.changed();
  }

  setSeed(seed: string): void {
    this.seed = seed;
    this.seedLocked = true;
    this.changed();
  }

  setSeedLocked(locked: boolean): void {
    this.seedLocked = locked;
    this.revalidate();
    if (!locked && this.diagnostics.some((item) => item.nodeId === "profile" && item.message.includes("种子"))) this.randomizeSeed();
    this.scheduleSave();
  }

  useSeed(seed: string): void {
    this.revision += 1;
    this.seed = seed;
    this.seedLocked = true;
    this.revalidate();
    this.scheduleSave();
  }

  async generate(amount = 1): Promise<GeneratedCase | undefined> {
    if (this.generating || this.loading) return undefined;
    if (!this.seedLocked) this.randomizeSeed();
    this.revalidate();
    if (!this.valid) return undefined;
    this.generating = true;
    const request = this.sourceRequest;
    const revision = this.revision;
    const profile = structuredClone(this.profile);
    this.error = "";
    try {
      const result = await generateVisualCases({ profile, count: amount });
      if (request !== this.sourceRequest || revision !== this.revision) return undefined;
      this.diagnostics = result.diagnostics;
      if (result.diagnostics.length) {
        this.clearPreview();
        return undefined;
      }
      this.cases = result.cases;
      this.selectedIndex = 0;
      return result.cases[0];
    } catch (error) {
      if (request !== this.sourceRequest || revision !== this.revision) return undefined;
      this.error = errorMessage(error);
      return undefined;
    } finally {
      this.generating = false;
    }
  }

  randomizeSeed(): void {
    const words = new Uint32Array(2);
    crypto.getRandomValues(words);
    this.seed = ((BigInt(words[0]) << 32n) | BigInt(words[1])).toString();
    this.changed();
  }

  requestEditor(): void {
    this.editorRequested = true;
  }

  consumeEditorRequest(): boolean {
    const requested = this.editorRequested;
    this.editorRequested = false;
    return requested;
  }

  clearPreview(): void {
    this.cases = [];
    this.selectedIndex = 0;
  }

  dispose(): void {
    if (this.saveTimer && this.sourcePath) {
      const source = this.sourcePath;
      const profile = structuredClone(this.profile);
      this.cancelScheduledSave();
      void saveGeneratorProfile(source, profile).catch(() => undefined);
    } else {
      this.cancelScheduledSave();
    }
  }

  private applyProfile(profile: VisualGeneratorProfile): void {
    this.nodes = normalizeSavedExpressions(profile.nodes);
    this.strategy = profile.strategy;
    this.treeShape = profile.treeShape;
    this.seed = profile.seed;
    this.seedLocked = profile.seedLocked ?? false;
    this.revalidate();
    this.clearPreview();
  }

  private changed(): void {
    this.revision += 1;
    this.revalidate();
    this.clearPreview();
    this.scheduleSave();
  }

  private revalidate(): void {
    this.diagnostics = validateVisualProfile(this.profile);
  }

  private scheduleSave(): void {
    this.cancelScheduledSave();
    if (!this.sourcePath) return;
    const source = this.sourcePath;
    const profile = structuredClone(this.profile);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      if (source !== this.sourcePath) return;
      this.saving = true;
      void saveGeneratorProfile(source, profile)
        .catch((error: unknown) => {
          this.error = errorMessage(error);
        })
        .finally(() => {
          if (source === this.sourcePath) this.saving = false;
        });
    }, 400);
  }

  private cancelScheduledSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error) {
    const commandError = error as { userMessage?: unknown; technicalMessage?: unknown };
    if (typeof commandError.userMessage === "string") return commandError.userMessage;
    if (typeof commandError.technicalMessage === "string") return commandError.technicalMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
