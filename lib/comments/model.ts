/**
 * The comments data model (comments design §4.1): one flat root `Y.Map`
 * named `comments` whose values are plain JSON (`ContentAny`), never
 * nested Y types. One key per thread head, anchors, status and message,
 * so concurrent replies never clobber each other and every struct stays
 * one hop from its root (the server validator, P4.2f-2, relies on it).
 *
 * Shared by the client, the server validator and the import guard, so it
 * imports nothing at runtime.
 */
import type { CARET_COLORS } from "@/lib/user-identity";

/** The root map's name in the Y.Doc. */
export const COMMENTS_ROOT = "comments";

/**
 * The origin of every comment write. The editor's undo manager tracks only
 * the sync plugin's origin on the text fragment, so ⌘Z never unposts,
 * unresolves or re-deletes a comment (§9.1).
 */
export const COMMENT_ORIGIN = "tinydocy-comments";

/** The thread head version this client writes and fully understands. */
export const THREAD_VERSION = 1;

/** 22 characters of base64url: 128 random bits. */
export type Id = string;
export type CaretColor = (typeof CARET_COLORS)[number];

/** `n`: 1–40 characters after cleaning; `k`: one of `CARET_COLORS`. */
export interface Author {
  id: Id;
  n: string;
  k: CaretColor;
}

/** `q`: the quoted text (≤ 280); `sg`: a suggested replacement (P4.12). */
export interface ThreadHead {
  v: number;
  q: string;
  c: number;
  au: Author;
  sg?: string;
}

/**
 * Encoded `Y.RelativePosition`s, each ≤ 64 bytes, item- or type-based,
 * never name-based. `ps`/`pe`: the pair before the last re-anchor, the
 * fallback that covers undo (§5.2).
 */
export interface Anchors {
  s: Uint8Array;
  e: Uint8Array;
  ps?: Uint8Array;
  pe?: Uint8Array;
}

/** `ap`: resolved by Apply (P4.12). */
export interface Status {
  r: boolean;
  at: number;
  by: Author;
  ap?: true;
}

/**
 * A posted message, or the marker a delete leaves ("Reply deleted"). The
 * marker keeps the ORIGINAL `au` and `c`, so a sharer's delete passes the
 * server's same-author overwrite check.
 */
export type Message =
  | { au: Author; b: string; c: number; ed?: number }
  | { au: Author; c: number; del: true };

export type CommentValue = ThreadHead | Anchors | Status | Message;

const ID = "[A-Za-z0-9_-]{22}";
export const ID_PATTERN = new RegExp(`^${ID}$`);
/** Head, anchors and status keys. */
export const THREAD_KEY_PATTERN = new RegExp(`^(t|a|s):${ID}$`);
export const MESSAGE_KEY_PATTERN = new RegExp(`^m:${ID}:${ID}$`);

export const threadKey = (tid: Id) => `t:${tid}`;
export const anchorKey = (tid: Id) => `a:${tid}`;
export const statusKey = (tid: Id) => `s:${tid}`;
/** The opening message has `mid === tid`. */
export const messageKey = (tid: Id, mid: Id) => `m:${tid}:${mid}`;

export type ParsedKey =
  | { kind: "t" | "a" | "s"; tid: Id }
  | { kind: "m"; tid: Id; mid: Id };

/** The key's kind and ids, or `null` for any key outside the model. */
export function parseKey(key: string): ParsedKey | null {
  if (THREAD_KEY_PATTERN.test(key)) {
    return { kind: key[0] as "t" | "a" | "s", tid: key.slice(2) };
  }
  if (MESSAGE_KEY_PATTERN.test(key)) {
    return { kind: "m", tid: key.slice(2, 24), mid: key.slice(25) };
  }
  return null;
}

/**
 * A new id: 128 random bits as 22 base64url characters (the same form as
 * the author id in `lib/user-identity.ts`, which can't share this module:
 * it is in the editor chunk and this one in the lazy comments chunk).
 */
export function newId(): Id {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .slice(0, 22);
}

export const isDeletedMessage = (
  message: Message,
): message is Extract<Message, { del: true }> => "del" in message;
