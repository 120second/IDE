export type TestcaseEditorToggle = "collapse" | "resume" | "replace";

export function testcaseEditorToggle(
  formOpen: boolean,
  editingId: number | undefined,
  targetId: number,
): TestcaseEditorToggle {
  if (editingId !== targetId) return "replace";
  return formOpen ? "collapse" : "resume";
}

export function shouldShowTestcaseEmptyState(
  formOpen: boolean,
  loading: boolean,
  testcaseCount: number,
): boolean {
  return !formOpen && !loading && testcaseCount === 0;
}
