import type { Database } from "bun:sqlite";

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
  tokenMatchesHash,
} from "@/lib/sharing/share-token";

/**
 * Refusal for an unknown share and for a wrong token alike, so only token
 * holders ever learn a share's state (ended, expired, view-only).
 */
export const SHARE_UNAVAILABLE = "share_unavailable";

/** Over a failed-token or capacity limit: the client pauses and retries. */
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
 * Checks `token` for `shareId`, in this order: the failed-token limits, the
 * row, the token (constant-time, against 32-byte SHA-256 hashes), and only
 * then the share's state. `credential` picks which tokens count: the
 * WebSocket takes `auth_edit` / `auth_view`, owner calls take the owner
 * secret, and the status read takes any of them.
 */
export function authenticateShare(
  context: ShareAuthContext,
  shareId: string,
  token: string | null,
  ip: string,
  credential: Credential,
): ShareAuthResult {
  const now = context.now?.() ?? Date.now();
  if (context.failedTokens.isBlocked(shareId, ip)) {
    return { ok: false, reason: SHARE_BUSY };
  }
  const share = getShare(context.db, shareId);
  const role = share && token ? matchRole(share, token, credential) : null;
  if (!share || !role) {
    context.failedTokens.recordFailure(shareId, ip);
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
