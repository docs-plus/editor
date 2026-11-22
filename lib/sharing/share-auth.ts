import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";

import type { FailedTokenLimiter } from "@/lib/sharing/failed-tokens";
import type { SharesMode } from "@/lib/sharing/share-config";
import {
  endShare,
  getShare,
  isShareExpired,
  type ShareEndReason,
  type ShareRow,
} from "@/lib/sharing/share-store";
import {
  AUTH_TOKEN_BYTES,
  decodeBase64url,
  OWNER_SECRET_BYTES,
  SHARE_HASH_BYTES,
  tokenMatchesHash,
} from "@/lib/sharing/share-token";

/**
 * Refusal for an unknown share and for a wrong token alike, so only token
 * holders ever learn a share's state (ended, expired, view-only).
 */
export const SHARE_UNAVAILABLE = "share_unavailable";

/**
 * The caller's address is over a limit (failed tokens, share connections):
 * the client pauses and retries. Never about a specific share.
 */
export const SHARE_BUSY = "busy";

/** An edit token on a share made view-only for everyone. */
export const SHARE_VIEW_ONLY = "view_only";

export type ShareRefusalReason =
  | typeof SHARE_UNAVAILABLE
  | typeof SHARE_BUSY
  | typeof SHARE_VIEW_ONLY
  | ShareEndReason;

export type ShareRole = "owner" | "edit" | "view";

export type ShareAuthResult =
  | { ok: true; share: ShareRow; role: ShareRole; readOnly: boolean }
  | { ok: false; reason: ShareRefusalReason };

export type ShareAuthContext = {
  db: Database;
  failedTokens: FailedTokenLimiter;
  mode: SharesMode;
  expiryMs: number;
  /** Called after a share is ended lazily (expiry), to close its connections. */
  onEnded?: (shareId: string) => void;
  now?: () => number;
};

type Credential = "connection" | "owner" | "any";

/**
 * Compared against when the row is missing, so an unknown share costs the
 * same digest work as a known one with a wrong token (no existence timing
 * oracle). Its random hashes match nothing.
 */
const MISSING_SHARE: ShareRow = {
  share_id: "",
  lineage: "",
  edit_hash: randomBytes(SHARE_HASH_BYTES),
  view_hash: randomBytes(SHARE_HASH_BYTES),
  owner_hash: randomBytes(SHARE_HASH_BYTES),
  status: "ended",
  view_only: 0,
  ended_reason: null,
  created_at: 0,
  last_edit_at: 0,
  ended_at: null,
  created_ip_hash: null,
  size_bytes: 0,
  schema: 0,
};

function matchRole(
  share: ShareRow,
  token: string,
  credential: Credential,
): ShareRole | null {
  if (credential !== "connection") {
    const owner = decodeBase64url(token, OWNER_SECRET_BYTES);
    if (owner && tokenMatchesHash(owner, share.owner_hash)) return "owner";
    if (credential === "owner") return null;
  }
  const auth = decodeBase64url(token, AUTH_TOKEN_BYTES);
  if (tokenMatchesHash(auth, share.edit_hash)) return "edit";
  if (tokenMatchesHash(auth, share.view_hash)) return "view";
  return null;
}

/**
 * Checks `token` for `shareId`, in this order: the address's failed-token
 * limit, the row, the token (constant-time, against 32-byte SHA-256
 * hashes), and only then the share's state. `credential` picks which
 * tokens count: the WebSocket takes `auth_edit` / `auth_view`, owner calls
 * take the owner secret, and the status read takes any of them.
 *
 * Refusals tell a caller without a token nothing about the share: an
 * unknown share, a wrong token and a share over its failed-token limit all
 * answer `share_unavailable`. That limit is back-pressure only: while a
 * share is over it, its edit and view tokens are refused too, but never
 * its owner secret, so the owner can always stop or reset a flooded link.
 * `busy` comes only from limits on the caller's address.
 */
export function authenticateShare(
  context: ShareAuthContext,
  shareId: string,
  token: string | null,
  ip: string,
  credential: Credential,
): ShareAuthResult {
  const now = context.now?.() ?? Date.now();
  const { failedTokens } = context;
  if (failedTokens.isAddressBlocked(ip)) {
    return { ok: false, reason: SHARE_BUSY };
  }
  const share = getShare(context.db, shareId);
  const matched = token
    ? matchRole(share ?? MISSING_SHARE, token, credential)
    : null;
  const role = share ? matched : null;
  if (!share || !role) {
    // Only a share that exists gets a key, so random ids fill no table.
    failedTokens.recordFailure(ip, share ? shareId : undefined);
    return { ok: false, reason: SHARE_UNAVAILABLE };
  }
  if (role !== "owner" && failedTokens.isShareBlocked(shareId)) {
    return { ok: false, reason: SHARE_UNAVAILABLE };
  }
  if (share.status === "ended") {
    return { ok: false, reason: share.ended_reason ?? "sharing_stopped" };
  }
  if (isShareExpired(share, now, context.expiryMs)) {
    if (endShare(context.db, shareId, "expired", now)) {
      context.onEnded?.(shareId);
    }
    return { ok: false, reason: "expired" };
  }
  if (role === "edit" && share.view_only && credential === "connection") {
    return { ok: false, reason: SHARE_VIEW_ONLY };
  }
  const readOnly =
    role === "view" || share.view_only === 1 || context.mode === "readonly";
  return { ok: true, share, role, readOnly };
}
