import { invoke } from "@tauri-apps/api/core";
import type {
  GenerateRequest,
  GenerateResult,
  GeneratorValidation,
  VisualGenerateRequest,
  VisualGenerateResult,
  VisualGeneratorProfile,
  VisualValidationResult,
} from "../types/generator";

export function validateGeneratorDsl(dsl: string): Promise<GeneratorValidation> {
  return invoke<GeneratorValidation>("validate_generator_dsl", { dsl });
}

export function generateRandomCases(request: GenerateRequest): Promise<GenerateResult> {
  return invoke<GenerateResult>("generate_random_cases", { request });
}

export function validateVisualGenerator(profile: VisualGeneratorProfile): Promise<VisualValidationResult> {
  return invoke<VisualValidationResult>("validate_visual_generator", { profile });
}

export function generateVisualCases(request: VisualGenerateRequest): Promise<VisualGenerateResult> {
  return invoke<VisualGenerateResult>("generate_visual_cases", { request });
}

export function loadGeneratorProfile(sourcePath: string): Promise<VisualGeneratorProfile | undefined> {
  return invoke<VisualGeneratorProfile | null>("load_generator_profile", { sourcePath })
    .then((profile) => profile ?? undefined);
}

export function saveGeneratorProfile(
  sourcePath: string,
  profile: VisualGeneratorProfile,
): Promise<VisualGeneratorProfile> {
  return invoke<VisualGeneratorProfile>("save_generator_profile", { sourcePath, profile });
}
