export function normalizeSnippetTemplate(template: string): string {
  return template.replaceAll("$0", "${0}");
}
