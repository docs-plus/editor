/**
 * A test stand-in for the server's comments validator (comments design
 * §7.3; the real one is P4.2f-2's `lib/comments/validate.ts`): checks
 * every struct an update adds to the `comments` root, the way the server
 * will, using the shared per-entry check and caps.
 * - Content: `ContentAny` with one value, or `ContentDeleted`.
 * - Key: from `parentSub` for a new key, or for an overwrite (which
 *   encodes an origin, not a parent) from the origin item, in the update
 *   or already on the server.
 * - Value: `checkEntry` with the server's limits; caps on the result.
 * - Overwrites: never of a `t:` key; an `m:` overwrite keeps `au` and `c`.
 */
import * as Y from "yjs";

import { checkEntry } from "@/lib/comments/entry-check";
import { SERVER_LIMITS } from "@/lib/comments/limits";
import { countComments, overCap } from "@/lib/comments/measure";
import { COMMENTS_ROOT } from "@/lib/comments/model";

type Struct = ReturnType<typeof Y.decodeUpdate>["structs"][number];

const idKey = (id: Y.ID) => `${id.client}:${id.clock}`;

interface Located {
  root: string | null;
  key: string | null;
}

/** The root and key of the item with `id`, in the update or on `server`. */
function locate(
  id: Y.ID,
  inUpdate: Map<string, Y.Item>,
  server: Y.Doc,
  depth = 0,
): Located {
  if (depth > 64) return { root: null, key: null };
  const own = inUpdate.get(idKey(id));
  if (own) return locateItem(own, inUpdate, server, depth + 1);
  try {
    const item = Y.getItem(server.store, id);
    if (item instanceof Y.Item) {
      const parent = item.parent as Y.AbstractType<unknown> | null;
      const root =
        parent && parent._item === null ? Y.findRootTypeKey(parent) : null;
      return { root, key: item.parentSub };
    }
  } catch {
    // Not on the server.
  }
  return { root: null, key: null };
}

function locateItem(
  item: Y.Item,
  inUpdate: Map<string, Y.Item>,
  server: Y.Doc,
  depth: number,
): Located {
  if (typeof item.parent === "string") {
    return { root: item.parent, key: item.parentSub };
  }
  if (item.origin) return locate(item.origin, inUpdate, server, depth);
  return { root: null, key: null };
}

/** Why `server` must reject `update`, or `null`; applies it when accepted. */
export function checkCommentUpdate(
  update: Uint8Array,
  server: Y.Doc,
  now: number,
): string | null {
  const { structs } = Y.decodeUpdate(update);
  const items = new Map<string, Y.Item>();
  for (const struct of structs as Struct[]) {
    if (struct instanceof Y.Item) items.set(idKey(struct.id), struct);
  }
  const map = server.getMap(COMMENTS_ROOT);
  for (const item of items.values()) {
    const { root, key } = locateItem(item, items, server, 0);
    // Other roots (the editor fragment) are the schema guard's.
    if (root !== COMMENTS_ROOT) continue;
    if (key === null) return "map shape";
    const content = item.content;
    if (content instanceof Y.ContentDeleted) continue;
    if (!(content instanceof Y.ContentAny) || content.arr.length !== 1) {
      return "content type";
    }
    const value = content.arr[0];
    const reason = checkEntry(key, value, { limits: SERVER_LIMITS, now });
    if (reason) return `${key}: ${reason}`;
    const old = map.get(key) as Record<string, unknown> | undefined;
    if (old && typeof item.parent !== "string") {
      if (key.startsWith("t:")) return "head overwrite";
      if (key.startsWith("m:")) {
        const next = value as Record<string, unknown>;
        const oldAuthor = old.au as { id: string };
        const nextAuthor = next.au as { id: string };
        if (oldAuthor.id !== nextAuthor.id || old.c !== next.c) {
          return "message overwrite";
        }
      }
    }
  }
  // Caps count net live keys after the update, so measure it on a copy and
  // apply it only when it fits.
  const probe = new Y.Doc();
  Y.applyUpdate(probe, Y.encodeStateAsUpdate(server));
  Y.applyUpdate(probe, update);
  const before = countComments(map);
  const after = countComments(probe.getMap(COMMENTS_ROOT));
  probe.destroy();
  const grew =
    after.threads > before.threads ||
    after.messages > before.messages ||
    after.maxPerThread > before.maxPerThread ||
    after.bytes > before.bytes;
  const cap = overCap(after, SERVER_LIMITS);
  if (grew && cap) return `comments_full: ${cap}`;
  Y.applyUpdate(server, update);
  return null;
}
