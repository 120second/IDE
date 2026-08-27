import {
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { resolveEditorThemeColors } from "../theme/themes";
import {
  resolveThemePreference,
  type AppSettings,
} from "../types/settings";

export function createAppearanceExtension(settings: Partial<AppSettings>): Extension {
  const variant = resolveThemePreference(settings.theme ?? "system");
  const light = variant === "light";
  const fontFamily = settings.fontFamily ?? "Cascadia Code, JetBrains Mono, Consolas, monospace";
  const fontSize = settings.fontSize ?? 14;
  const lineHeight = settings.lineHeight ?? 1.55;
  const colors = resolveEditorThemeColors({
    colorTheme: settings.colorTheme ?? "signal",
    activeCustomTheme: settings.activeCustomTheme ?? "",
    customThemes: settings.customThemes ?? [],
  }, variant);

  const editorTheme = EditorView.theme(
    {
      "&": {
        height: "100%",
        color: colors.text,
        backgroundColor: "transparent",
        fontSize: `${fontSize}px`,
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily,
        lineHeight: String(lineHeight),
      },
      ".cm-content": {
        minHeight: "100%",
        padding: "12px 0 32px",
        caretColor: colors.cursor,
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.cursor },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: colors.selection,
      },
      ".cm-activeLine": { backgroundColor: colors.activeLine },
      ".cm-gutters": {
        minWidth: "46px",
        color: colors.muted,
        backgroundColor: "transparent",
        borderRight: "1px solid var(--border)",
      },
      ".cm-activeLineGutter": {
        color: colors.text,
        backgroundColor: colors.activeLine,
      },
      ".cm-foldPlaceholder": {
        color: colors.muted,
        backgroundColor: "transparent",
        border: "0",
      },
      ".cm-panels": {
        color: colors.text,
        backgroundColor: "var(--panel-background)",
      },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
      ".cm-searchMatch": { backgroundColor: "rgba(231, 175, 75, 0.28)" },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(78, 133, 209, 0.38)" },
    },
    { dark: !light },
  );

  const highlightStyle = HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: colors.keyword },
    { tag: [tags.typeName, tags.className, tags.namespace], color: colors.type },
    { tag: [tags.string, tags.character, tags.special(tags.string)], color: colors.string },
    { tag: [tags.number, tags.bool, tags.null], color: colors.number },
    { tag: [tags.lineComment, tags.blockComment], color: colors.comment, fontStyle: "italic" },
    { tag: [tags.function(tags.variableName), tags.labelName], color: colors.function },
    { tag: [tags.variableName, tags.propertyName], color: colors.variable },
    { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: colors.function },
    { tag: tags.meta, color: colors.keyword },
  ]);

  return [editorTheme, syntaxHighlighting(highlightStyle)];
}
