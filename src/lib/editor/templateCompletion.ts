import {
  snippet,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { TemplateDetail } from "../types/templates";
import { normalizeSnippetTemplate } from "./snippets";

export function buildTemplateCompletionResult(
  from: number,
  templates: readonly TemplateDetail[],
  onPreview: (template: TemplateDetail, completionFrom: number, completionTo: number) => void,
  isPreviewOpen: (id: number) => boolean,
  onPicked: (id: number) => void,
): CompletionResult | null {
  if (templates.length === 0) return null;

  const options: Completion[] = templates.map((template) => {
    const applySnippet = snippet(normalizeSnippetTemplate(template.code));
    let previewed = false;
    const aliases = template.aliases.length > 0
      ? `别名：${template.aliases.join("、")}`
      : "";
    const info = [template.description, aliases].filter(Boolean).join("\n");

    return {
      label: template.trigger.trim() || template.name,
      detail: `模板 · ${template.name}`,
      info: info || undefined,
      type: "text",
      boost: 99,
      apply: (view, completion, completionFrom, completionTo) => {
        if (!previewed || !isPreviewOpen(template.id)) {
          previewed = true;
          onPreview(template, completionFrom, completionTo);
          view.focus();
          return;
        }
        applySnippet(view, completion, completionFrom, completionTo);
        onPicked(template.id);
      },
    };
  });

  return {
    from,
    options,
    // Results were already matched and ranked by the template service. CodeMirror
    // intentionally places unfiltered results before results from other sources.
    filter: false,
  };
}

export function templateReferenceCode(template: string): string {
  return template
    .replace(/\$\{\d+:([^{}]*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$\d+/g, "");
}
