import { describe, expect, it } from "vitest";
import {
  MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH,
  MAX_LANGUAGE_SERVICE_DOCUMENT_LINES,
  usesLanguageServices,
  usesCppLanguageServices,
} from "./languageServicePolicy";

describe("large-file language service policy", () => {
  it("enables supported C++ files and headers while excluding test data and notes", () => {
    for (const path of ["main.cpp", "MAIN.CPP", "main.cc", "value.hpp", "value.h", "impl.inl"]) expect(usesCppLanguageServices(path, { length: 10 })).toBe(true);
    for (const path of ["in.txt", "out.txt", "notes.md", "data.json", ""]) expect(usesCppLanguageServices(path, { length: 10 })).toBe(false);
    expect(usesCppLanguageServices("main.cpp", { length: MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH })).toBe(false);
  });
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
