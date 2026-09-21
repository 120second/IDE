import { describe, expect, it } from "vitest";
import { shouldShowTestcaseEmptyState, testcaseEditorToggle } from "./testcaseEditorState";

describe("testcase editor row toggle", () => {
  it("collapses when the open row is clicked again", () => {
    expect(testcaseEditorToggle(true, 2, 2)).toBe("collapse");
  });

  it("resumes the retained draft when the same row is reopened", () => {
    expect(testcaseEditorToggle(false, 2, 2)).toBe("resume");
  });

  it("loads a fresh draft when another row is selected", () => {
    expect(testcaseEditorToggle(true, 2, 3)).toBe("replace");
  });
});

describe("testcase empty state", () => {
  it("hides the empty prompt while the create editor is open", () => {
    expect(shouldShowTestcaseEmptyState(true, false, 0)).toBe(false);
  });

  it("shows the prompt only after loading with no editor and no cases", () => {
    expect(shouldShowTestcaseEmptyState(false, false, 0)).toBe(true);
    expect(shouldShowTestcaseEmptyState(false, true, 0)).toBe(false);
    expect(shouldShowTestcaseEmptyState(false, false, 1)).toBe(false);
  });
});
