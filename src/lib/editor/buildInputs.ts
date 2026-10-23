export async function buildContentHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/\r\n|\r/g, "\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildPathKey(path: string): string {
  return path.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}
