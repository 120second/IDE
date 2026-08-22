export const MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH = 2 * 1024 * 1024;
export const MAX_LANGUAGE_SERVICE_DOCUMENT_LINES = 100_000;

export function usesLanguageServices(document: {
  readonly length: number;
  readonly lines?: number;
}): boolean {
  return document.length < MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH
    && (document.lines === undefined || document.lines < MAX_LANGUAGE_SERVICE_DOCUMENT_LINES);
}
