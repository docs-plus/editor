import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Wire format of share tokens and hashes (plan §6 "Link secrets", seam S1).
 * Frozen here because the desktop (P4.4) and the web library (W10) build
 * against it:
 *
 * - Every value is unpadded base64url (RFC 4648 §5).
 * - `auth_edit` and `auth_view` are the 32-byte HKDF outputs; the owner
 *   secret is 16 random bytes (128 bits).
 * - The server hashes the **decoded bytes**, not the text:
 *   `edit_hash = base64url(SHA-256(bytes(auth_edit)))`, and the same for
 *   `view_hash` and `owner_hash`. Each hash is exactly 32 bytes.
 *
 * Unsalted SHA-256 is correct because every input is a high-entropy random
 * token. Tokens are never logged; only `share_id` is.
 */
export const AUTH_TOKEN_BYTES = 32;
export const OWNER_SECRET_BYTES = 16;
export const SHARE_HASH_BYTES = 32;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function base64urlLength(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

/**
 * Decodes an unpadded base64url string of exactly `byteLength` bytes, or
 * returns null. The length is checked on the text first, so oversized input
 * is never decoded, and re-encoding must round-trip (no stray bits).
 */
export function decodeBase64url(
  value: unknown,
  byteLength: number,
): Buffer | null {
  if (typeof value !== "string") return null;
  if (value.length !== base64urlLength(byteLength)) return null;
  if (!BASE64URL.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== byteLength) return null;
  if (bytes.toString("base64url") !== value) return null;
  return bytes;
}

export function encodeBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** SHA-256 of a decoded token's bytes. */
export function hashTokenBytes(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}

/** A stored or submitted hash: 32 bytes as base64url, else null. */
export function parseShareHash(value: unknown): Buffer | null {
  return decodeBase64url(value, SHARE_HASH_BYTES);
}

/**
 * Constant-time check of a presented token against a stored hash. Both
 * sides are 32-byte SHA-256 digests, so `timingSafeEqual` never sees
 * different lengths.
 */
export function tokenMatchesHash(
  token: Uint8Array | null,
  storedHash: Uint8Array | null,
): boolean {
  if (!token || !storedHash || storedHash.byteLength !== SHARE_HASH_BYTES) {
    return false;
  }
  return timingSafeEqual(hashTokenBytes(token), storedHash);
}

/** `Authorization: Bearer <token>`, or null. */
export function readBearerToken(headers: Headers): string | null {
  const value = headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(value.trim());
  return match?.[1] ?? null;
}
