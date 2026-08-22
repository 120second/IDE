import { Text } from "@codemirror/state";

export type LineEnding = "lf" | "crlf" | "cr";

export interface EditorDocument {
  text: Text;
  eol: LineEnding;
}

const LINE_BREAK = /\r\n|\r|\n/g;

export function detectLineEnding(content: string): LineEnding {
  const counts: Record<LineEnding, number> = { lf: 0, crlf: 0, cr: 0 };
  const firstSeen: LineEnding[] = [];
  for (const match of content.matchAll(LINE_BREAK)) {
    const ending: LineEnding = match[0] === "\r\n" ? "crlf" : match[0] === "\r" ? "cr" : "lf";
    if (counts[ending] === 0) firstSeen.push(ending);
    counts[ending]++;
  }
  if (firstSeen.length === 0) return "lf";
  return firstSeen.reduce((selected, ending) =>
    counts[ending] > counts[selected] ? ending : selected
  );
}

export function lineEndingText(lineEnding: LineEnding): string {
  if (lineEnding === "crlf") return "\r\n";
  if (lineEnding === "cr") return "\r";
  return "\n";
}

export function editorText(content: string): Text {
  return Text.of(content.split(LINE_BREAK));
}

export function editorDocument(content: string): EditorDocument {
  if (!content.includes("\r")) {
    return { text: Text.of(content.split("\n")), eol: "lf" };
  }
  if (!content.includes("\n")) {
    return { text: Text.of(content.split("\r")), eol: "cr" };
  }
  return {
    text: Text.of(content.split(LINE_BREAK)),
    eol: detectLineEnding(content),
  };
}
