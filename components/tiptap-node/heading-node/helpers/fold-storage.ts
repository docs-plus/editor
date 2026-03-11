const STORAGE_PREFIX = "tinydocy-folds-";

export function loadFoldedIds(documentId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${documentId}`);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

export function saveFoldedIds(
  documentId: string,
  foldedIds: Set<string>,
): void {
  try {
    if (foldedIds.size === 0) {
      localStorage.removeItem(`${STORAGE_PREFIX}${documentId}`);
    } else {
      localStorage.setItem(
        `${STORAGE_PREFIX}${documentId}`,
        JSON.stringify([...foldedIds]),
      );
    }
  } catch {
    // localStorage may be full or unavailable
  }
}
