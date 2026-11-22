/**
 * The comment author id (comments design §6.1, made per document by the
 * offline data-model revision, SEC-002): the first 128 bits of
 * HMAC-SHA-256(deviceSecret, lineage) as 22 base64url characters. The same
 * browser gets the same id in every copy of one document (same lineage),
 * and unrelated ids in different documents, so two shares can't be tied to
 * one person by their comments.
 *
 * `deviceSecret` is 128 random bits kept in this browser under
 * `tinydocy-author`, minted on first use. It never enters a Y.Doc,
 * awareness, a URL or analytics; only the derived id is stored with a
 * comment. The id says "same browser", not who someone is: anyone holding
 * an edit link can copy it ("Names aren't verified.").
 *
 * Its own key, not inside `tinydocy-user`: a field there would put code in
 * `lib/user-identity.ts`, which is in the editor chunk, while this module
 * is in the lazy comments chunk and costs the editor nothing. "Forget my
 * choices" leaves it, as it leaves the name and colour.
 */
import { ID_PATTERN, type Id, newId } from "@/lib/comments/model";

export const DEVICE_SECRET_KEY = "tinydocy-author";

/** Domain separation, so the secret can key other derivations later. */
const CONTEXT = "tinydocy comment author v1\0";

/** Kept for the session when storage is blocked or full. */
let memorySecret: string | null = null;
/** Ids made without WebCrypto (an insecure context), per lineage. */
const sessionIds = new Map<string, Id>();

function readStored(): string | null {
  try {
    const stored = window.localStorage.getItem(DEVICE_SECRET_KEY);
    return stored && ID_PATTERN.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The stored device secret, minting and storing one on first use. */
function deviceSecret(): string {
  const stored = typeof window === "undefined" ? null : readStored();
  if (stored) {
    memorySecret = stored;
    return stored;
  }
  memorySecret ??= newId();
  try {
    window.localStorage.setItem(DEVICE_SECRET_KEY, memorySecret);
  } catch {
    // Blocked or full: the secret, and so every id, lasts for this session.
  }
  return memorySecret;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * This browser's author id in the document of `lineage` (the document's
 * frozen lineage: desktop `docs.lineage`, or a share's). Resolve it once
 * when comments mount; the store reads it synchronously at each write.
 *
 * WebCrypto exists only in a secure context (https, localhost, the
 * desktop app). Elsewhere, such as a LAN address over http, the id is
 * random for this session and lineage: still unlinkable across documents,
 * but after a reload the writer no longer owns its earlier messages.
 */
export async function authorIdFor(lineage: string): Promise<Id> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    let id = sessionIds.get(lineage);
    if (!id) {
      id = newId();
      sessionIds.set(lineage, id);
    }
    return id;
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(deviceSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await subtle.sign("HMAC", key, encoder.encode(CONTEXT + lineage));
  return base64url(new Uint8Array(mac).subarray(0, 16));
}
