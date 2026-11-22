/**
 * Every comment thread in a bare `Y.Doc`, with no editor, schema or DOM
 * (offline data-model revision §4.5, I12): what repair reports (Detached
 * and orphaned threads, never deleting them) and what a later additive
 * `comment_index` derives from. Read-only: it never creates a root or
 * writes to the document.
 *
 * Not imported by the lazy comments chunk, which reaches Yjs only through
 * `CommentsDeps` (contract A16); this module imports Yjs directly.
 */
import * as Y from "yjs";

import { COMMENTS_ROOT, parseKey } from "@/lib/comments/model";
import { readThreads, type Thread } from "@/lib/comments/threads";

/** The editor's fragment (`Collaboration`'s default `field`). */
const DOCUMENT_FRAGMENT = "default";

export interface ListedThread extends Thread {
  /**
   * Neither anchor pair spans any text: the editor shows it Detached
   * (comments design §5.2) until someone re-attaches it.
   */
  detached: boolean;
}

export interface ThreadListing {
  /** Threads with a head, in creation order. */
  threads: ListedThread[];
  /**
   * Keys of anchors, status and messages whose thread head is gone (a
   * reply that raced a delete). The server drops them when it loads a
   * document; repair only reports them.
   */
  orphans: string[];
}

/**
 * Where each type's content starts, as ProseMirror counts positions (an
 * element opens and closes with one each; text counts its characters), and
 * each child's size. Leaf atoms count 2 instead of 1 without a schema,
 * which keeps every order and so every "spans text" answer the same.
 */
function measure(fragment: Y.XmlFragment) {
  const starts = new Map<Y.AbstractType<unknown>, number>();
  const sizes = new Map<Y.AbstractType<unknown>, number>();
  let pos = 0;
  const walk = (type: Y.XmlFragment | Y.XmlElement) => {
    starts.set(type as Y.AbstractType<unknown>, pos);
    for (const child of type.toArray()) {
      const start = pos;
      if (child instanceof Y.XmlText) {
        starts.set(child as Y.AbstractType<unknown>, pos);
        pos += child.length;
      } else if (child instanceof Y.XmlElement) {
        pos += 1;
        walk(child);
        pos += 1;
      }
      sizes.set(child as Y.AbstractType<unknown>, pos - start);
    }
  };
  walk(fragment);
  return { starts, sizes };
}

type Measured = ReturnType<typeof measure>;

function position(
  doc: Y.Doc,
  { starts, sizes }: Measured,
  bytes: Uint8Array,
): number | null {
  try {
    const relative = Y.decodeRelativePosition(bytes);
    // Resolving a name-based position calls `doc.get(tname)`, which would
    // create a root; anchors are never name-based.
    if (relative.tname !== null) return null;
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      relative,
      doc,
    );
    if (!absolute) return null;
    const type = absolute.type as Y.AbstractType<unknown>;
    const start = starts.get(type);
    if (start === undefined) return null;
    if (type instanceof Y.XmlText) return start + absolute.index;
    let offset = start;
    const children = (type as unknown as Y.XmlElement).toArray();
    for (const child of children.slice(0, absolute.index)) {
      offset += sizes.get(child as Y.AbstractType<unknown>) ?? 0;
    }
    return offset;
  } catch {
    return null;
  }
}

const spansText = (
  doc: Y.Doc,
  measured: Measured,
  s: Uint8Array | undefined,
  e: Uint8Array | undefined,
) => {
  if (!s || !e) return false;
  const from = position(doc, measured, s);
  const to = position(doc, measured, e);
  return from !== null && to !== null && from < to;
};

/** Every thread in `doc`, and the orphaned keys, without changing `doc`. */
export function listThreads(doc: Y.Doc): ThreadListing {
  if (!doc.share.has(COMMENTS_ROOT)) return { threads: [], orphans: [] };
  const map = doc.getMap(COMMENTS_ROOT);
  let measured: Measured | null = null;
  try {
    if (doc.share.has(DOCUMENT_FRAGMENT)) {
      measured = measure(doc.getXmlFragment(DOCUMENT_FRAGMENT));
    }
  } catch {
    // Not a fragment (a damaged document): every thread is Detached.
  }
  const threads = readThreads(map).map((thread) => {
    const a = thread.anchors;
    const attached =
      !!measured &&
      !!a &&
      (spansText(doc, measured, a.s, a.e) ||
        spansText(doc, measured, a.ps, a.pe));
    return { ...thread, detached: !attached };
  });
  const heads = new Set(threads.map((thread) => thread.tid));
  const orphans: string[] = [];
  map.forEach((_value, key) => {
    const parsed = parseKey(key);
    if (parsed && !heads.has(parsed.tid)) orphans.push(key);
  });
  return { threads, orphans: orphans.sort() };
}
