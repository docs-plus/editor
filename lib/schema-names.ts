/** y-prosemirror stores overlapping marks under `<name>--<8-char hash>`. */
export const HASHED_MARK_SUFFIX = /--[a-zA-Z0-9+/=]{8}$/;

/** Mark name of a stored Yjs text attribute key, without the hash suffix. */
export function markNameFromKey(key: string): string {
  return key.replace(HASHED_MARK_SUFFIX, "");
}
