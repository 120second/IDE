import {
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { createMinimapExtension } from "./minimap";
import { resolveEditorThemeColors } from "../theme/themes";
import {
  resolveThemePreference,
  type AppSettings,
} from "../types/settings";

export function editorAppearanceKey(settings: Partial<AppSettings>): string {
  const variant = resolveThemePreference(settings.theme ?? "system");
  const colors = resolveEditorThemeColors({
    colorTheme: settings.colorTheme ?? "signal",
    editorTheme: settings.editorTheme ?? "inherit",
    activeCustomTheme: settings.activeCustomTheme ?? "",
    customThemes: settings.customThemes ?? [],
  }, variant);
  return JSON.stringify([variant, colors, settings.interfaceStyle, settings.fontFamily, settings.fontSize, settings.lineHeight]);
}

export function createAppearanceExtension(settings: Partial<AppSettings>): Extension {
  const variant = resolveThemePreference(settings.theme ?? "system");
  const light = variant === "light";
  const fontFamily = settings.fontFamily ?? "Cascadia Code, JetBrains Mono, Consolas, monospace";
  const fontSize = settings.fontSize ?? 14;
  const lineHeight = settings.lineHeight ?? 1.55;
  let colors = resolveEditorThemeColors({
    colorTheme: settings.colorTheme ?? "signal",
    editorTheme: settings.editorTheme ?? "inherit",
    activeCustomTheme: settings.activeCustomTheme ?? "",
    customThemes: settings.customThemes ?? [],
  }, variant);

  if (settings.interfaceStyle === "classic" && (!settings.editorTheme || settings.editorTheme === "inherit") && !light) {
    colors = { ...colors, text: "#d4d4d4", muted: "#85858c", activeLine: "#ffffff06", selection: "#264f78", keyword: "#c586c0", type: "#4ec9b0", function: "#dcdcaa", comment: "#6a9955", string: "#ce9178", number: "#b5cea8", variable: "#d4d4d4" };
  }
  if (settings.interfaceStyle === "sublime" && (!settings.editorTheme || settings.editorTheme === "inherit")) {
    colors = light
      ? { ...colors, text: "#303c49", muted: "#64778a", activeLine: "#e7edf3", selection: "#d5e4ee", cursor: "#a76829", keyword: "#875b9c", type: "#875b9c", function: "#497bad", comment: "#727e8d", string: "#4c7d3c", number: "#a76829", variable: "#303c49" }
      : { ...colors, text: "#f8f8f2", muted: "#a6a799", activeLine: "#ffffff06", selection: "#73776170", cursor: "#f8f8f2", keyword: "#f92672", type: "#a6e22e", function: "#a6e22e", comment: "#999b8b", string: "#e6db74", number: "#ae81ff", variable: "#f8f8f2" };
  }

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
      ".cm-lintRange-error, .cm-lintRange-warning": {
        backgroundImage: "none",
        textDecorationLine: "underline",
        textDecorationStyle: "wavy",
        textDecorationThickness: "2px",
        textUnderlineOffset: "3px",
      },
      ".cm-lintRange-error": {
        textDecorationColor: "var(--danger)",
        backgroundColor: "color-mix(in srgb, var(--danger) 12%, transparent)",
      },
      ".cm-lintRange-warning": {
        textDecorationColor: "var(--warning)",
        backgroundColor: "color-mix(in srgb, var(--warning) 10%, transparent)",
      },
      ".cm-lintPoint-error:after": { borderBottom: "6px solid var(--danger)" },
      ".cm-lintPoint-warning:after": { borderBottom: "6px solid var(--warning)" },
      ".cm-lint-marker-error, .cm-lint-marker-warning": {
        width: "13px", height: "13px", margin: "3px 2px",
        borderRadius: "2px", backgroundImage: "none",
        color: "var(--background)", fontFamily: "sans-serif", fontSize: "11px", fontWeight: "bold",
        lineHeight: "13px", textAlign: "center",
      },
      ".cm-lint-marker-error": { backgroundColor: "var(--danger)" },
      ".cm-lint-marker-warning": { backgroundColor: "var(--warning)" },
      ".cm-lint-marker-error:after, .cm-lint-marker-warning:after": { content: '"!"' },
      ".cm-diagnostic-error": { borderLeftColor: "var(--danger)" },
      ".cm-diagnostic-warning": { borderLeftColor: "var(--warning)" },
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

  return [editorTheme, syntaxHighlighting(highlightStyle), ...(settings.interfaceStyle === "classic" ? [createMinimapExtension()] : [])];
}
