import { describe, expect, it } from "vitest";
import { testcaseEditorToggle } from "./testcaseEditorState";

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
