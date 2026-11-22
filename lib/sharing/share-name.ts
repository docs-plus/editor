/**
 * Share document names (plan §6 "Share names"). A share's Hocuspocus
 * document is `share:<share_id>`, where the server mints `share_id` as a
 * lowercase UUID v4. No client import: the Hocus process uses this.
 */
export const SHARE_PREFIX = "share:";

/**
 * Reserved for device sync (seam S6b): never a share, never a sandbox
 * document. Sync never uses `share:` names, `MAX_TOTAL_SHARES` or the
 * share expiry.
 */
export const SYNC_PREFIX = "sync:";

const SHARE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A server-minted share id: a lowercase UUID v4, nothing else. */
export function isShareId(value: string): boolean {
  return SHARE_ID_REGEX.test(value);
}

export function shareDocumentName(shareId: string): string {
  return `${SHARE_PREFIX}${shareId}`;
}

/** True for any name in the share namespace, valid or not. */
export function isShareNamespace(name: string): boolean {
  return name.startsWith(SHARE_PREFIX);
}

/** True for names in the reserved device-sync namespace. */
export function isReservedSyncName(name: string): boolean {
  return name.startsWith(SYNC_PREFIX);
}

/** The share id in a valid `share:<uuid v4>` name, else null. */
export function shareIdFromDocumentName(name: string): string | null {
  if (!isShareNamespace(name)) return null;
  const id = name.slice(SHARE_PREFIX.length);
  return isShareId(id) ? id : null;
}

/** Mints a new share id (server only). */
export function mintShareId(): string {
  return crypto.randomUUID();
}
