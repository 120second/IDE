import { describe, expect, it } from "vitest";
import {
  MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH,
  MAX_LANGUAGE_SERVICE_DOCUMENT_LINES,
  usesLanguageServices,
} from "./languageServicePolicy";

describe("large-file language service policy", () => {
  it("keeps normal documents enabled", () => {
    expect(usesLanguageServices({ length: MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH - 1 })).toBe(true);
  });

  it("disables documents at and above the bounded threshold", () => {
    expect(usesLanguageServices({ length: MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH })).toBe(false);
    expect(usesLanguageServices({ length: MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH * 8 })).toBe(false);
  });

  it("disables very high line counts even when character count is small", () => {
    expect(usesLanguageServices({
      length: MAX_LANGUAGE_SERVICE_DOCUMENT_LINES,
      lines: MAX_LANGUAGE_SERVICE_DOCUMENT_LINES,
    })).toBe(false);
  });
});
