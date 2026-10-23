export const MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH = 2 * 1024 * 1024;
export const MAX_LANGUAGE_SERVICE_DOCUMENT_LINES = 100_000;

export function isCppHeader(path: string): boolean {
  return /\.(?:h|hh|hpp|hxx|h\+\+|tpp|ipp|inl|inc|tcc)$/i.test(path);
}

export function isCppDocument(path: string): boolean {
  return /\.(?:cpp|cc|cxx|c\+\+)$/i.test(path) || isCppHeader(path);
}

export function usesCppLanguageServices(path: string, document: { readonly length: number; readonly lines?: number }): boolean {
  return isCppDocument(path) && usesLanguageServices(document);
}

export function usesLanguageServices(document: {
  readonly length: number;
  readonly lines?: number;
}): boolean {
  return document.length < MAX_LANGUAGE_SERVICE_DOCUMENT_LENGTH
    && (document.lines === undefined || document.lines < MAX_LANGUAGE_SERVICE_DOCUMENT_LINES);
}
