/**
 * Anchors (comments design §5): a thread's range as a pair of Yjs relative
 * positions. The start sticks to the first quoted character (`assoc 0`),
 * the end to the last (`assoc −1`), so typing just outside the range is
 * left out and typing inside it, or a collaborator's insert inside it, is
 * included.
 */
import type { AnchorBinding, CommentsDeps } from "@/lib/comments/deps";
import { CLIENT_LIMITS } from "@/lib/comments/limits";
import type { Anchors } from "@/lib/comments/model";

export interface CommentRange {
  from: number;
  to: number;
}

type RelativePosition = ReturnType<
  CommentsDeps["Y"]["createRelativePositionFromTypeIndex"]
>;

function encode(deps: CommentsDeps, position: RelativePosition) {
  const bytes = deps.Y.encodeRelativePosition(position);
  // Never name-based, and within the server's 64-byte bound.
  return position.tname === null &&
    bytes.byteLength <= CLIENT_LIMITS.anchorBytes
    ? bytes
    : null;
}

/**
 * The encoded `{ s, e }` of `[from, to)` in the current document, or
 * `null` when a position can't be made (a binding that isn't synced yet,
 * an empty range). y-tiptap makes `assoc −1` positions only, so the start
 * is rebuilt at `assoc 0` from its decoded type and index.
 */
export function createAnchorPair(
  deps: CommentsDeps,
  binding: AnchorBinding,
  { from, to }: CommentRange,
): Pick<Anchors, "s" | "e"> | null {
  if (from >= to) return null;
  try {
    const { doc, type, mapping } = binding;
    const before = deps.absolutePositionToRelativePosition(from, type, mapping);
    const start = deps.Y.createAbsolutePositionFromRelativePosition(
      before,
      doc,
    );
    if (!start) return null;
    const s = encode(
      deps,
      deps.Y.createRelativePositionFromTypeIndex(start.type, start.index, 0),
    );
    const e = encode(
      deps,
      deps.absolutePositionToRelativePosition(to, type, mapping),
    );
    return s && e ? { s, e } : null;
  } catch {
    return null;
  }
}

/** One encoded position as a document position, or `null`. */
function resolvePosition(
  deps: CommentsDeps,
  binding: AnchorBinding,
  bytes: Uint8Array,
): number | null {
  try {
    const position = deps.Y.decodeRelativePosition(bytes);
    // Resolving a name-based position calls `doc.get(tname)`, which would
    // create a stray root on this client.
    if (position.tname !== null) return null;
    return deps.relativePositionToAbsolutePosition(
      binding.doc,
      binding.type,
      position,
      binding.mapping,
    );
  } catch {
    return null;
  }
}

/**
 * Whether the character (or type) an encoded position sticks to still
 * exists, following undo's re-creations (`redone`) as Yjs does.
 */
function isLive(
  deps: CommentsDeps,
  doc: AnchorBinding["doc"],
  bytes: Uint8Array,
) {
  try {
    const { item: id, type } = deps.Y.decodeRelativePosition(bytes);
    let item = deps.Y.getItem(
      doc.store,
      (id ?? type) as NonNullable<typeof id>,
    );
    for (let hops = 0; item.redone && hops < 64; hops++) {
      item = deps.Y.getItem(doc.store, item.redone);
    }
    return !item.deleted;
  } catch {
    return false;
  }
}

/**
 * Whether an encoded position resolves only through THIS client's undo
 * history: its character is deleted, and this client's undo or redo
 * re-created it (`redone`, which Yjs never sends to other clients).
 */
function onlyLiveHere(
  deps: CommentsDeps,
  doc: AnchorBinding["doc"],
  bytes: Uint8Array | undefined,
) {
  if (!bytes) return false;
  try {
    const { item: id, type } = deps.Y.decodeRelativePosition(bytes);
    const item = deps.Y.getItem(
      doc.store,
      (id ?? type) as NonNullable<typeof id>,
    );
    return item.deleted && item.redone !== null;
  } catch {
    return false;
  }
}

/**
 * Whether any of a thread's anchors resolves only on this client (see
 * `onlyLiveHere`): the client that undid must write anchors everyone else
 * can resolve, or the thread stays Detached (or short) for them.
 */
export const anchorsOnlyLiveHere = (
  deps: CommentsDeps,
  doc: AnchorBinding["doc"],
  { s, e, ps, pe }: Anchors,
): boolean =>
  onlyLiveHere(deps, doc, s) ||
  onlyLiveHere(deps, doc, e) ||
  onlyLiveHere(deps, doc, ps) ||
  onlyLiveHere(deps, doc, pe);

const isLivePair = (
  deps: CommentsDeps,
  doc: AnchorBinding["doc"],
  s: Uint8Array,
  e: Uint8Array,
) => isLive(deps, doc, s) && isLive(deps, doc, e);

/** A pair as a non-empty range, or `null` (detached or collapsed). */
export function resolvePair(
  deps: CommentsDeps,
  binding: AnchorBinding,
  s: Uint8Array,
  e: Uint8Array,
): CommentRange | null {
  const from = resolvePosition(deps, binding, s);
  if (from === null) return null;
  const to = resolvePosition(deps, binding, e);
  return to !== null && from < to ? { from, to } : null;
}

/**
 * §5.2: the current pair, else the pair before the last re-anchor (which
 * covers undoing a structural edit), else `null`: Detached.
 */
export function resolveAnchors(
  deps: CommentsDeps,
  binding: AnchorBinding,
  { s, e, ps, pe }: Anchors,
): CommentRange | null {
  const current = resolvePair(deps, binding, s, e);
  if (!ps || !pe) return current;
  // Undo deleted a character the current pair sticks to and brought back
  // every character of the earlier pair (a join or move undone after a
  // re-anchor): the earlier pair is the thread's text again.
  if (
    current &&
    (isLivePair(deps, binding.doc, s, e) ||
      !isLivePair(deps, binding.doc, ps, pe))
  ) {
    return current;
  }
  return resolvePair(deps, binding, ps, pe) ?? current;
}

export const sameRange = (
  a: CommentRange | null | undefined,
  b: CommentRange | null | undefined,
): boolean => (a && b ? a.from === b.from && a.to === b.to : !a && !b);
