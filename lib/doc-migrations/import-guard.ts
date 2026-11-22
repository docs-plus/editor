/**
 * The import guard (plan P2.6; architecture §3.3): checks a document's
 * state before it enters the library from a `.tinydoc`, a web download or a
 * backup. It rejects and never repairs; the import migrations
 * ({@link import("./index")}) run only on a state that passed.
 *
 * Refused:
 * - **size:** over {@link IMPORT_MAX_BYTES} (`import_too_large`);
 * - **not Yjs:** bytes that don't decode (`corrupt`);
 * - **unknown names:** a node or mark this build's schema doesn't know
 *   (`unknown_schema`). y-prosemirror would delete such content the moment
 *   the editor binds. The legacy `link` and `code` marks are allowed: the
 *   import migrations rename them;
 * - **unknown roots:** a top-level type other than the editor fragment
 *   (`unknown_schema`). Comments add their `comments` root here, with their
 *   validator, in P4.11.
 *
 * Pure: Yjs and the schema name lists only, so main imports it.
 */
import * as Y from "yjs";

import {
  isAllowedMarkKey,
  isAllowedNodeName,
  markNameFromKey,
} from "@/lib/schema-names";

/** The editor fragment, `EDITOR_FRAGMENT_NAME` in `lib/yjs-mark-migration.ts`. */
const EDITOR_ROOT = "default";

/**
 * 64 MiB: far above any document the editor stays responsive with, and
 * low enough that a hostile file can't exhaust the worker's memory while it
 * is decoded.
 */
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;

export const IMPORT_ROOTS: readonly string[] = [EDITOR_ROOT];

export type ImportVerdict =
  | { ok: true }
  | {
      ok: false;
      code: "import_too_large" | "corrupt" | "unknown_schema";
      /** Up to five offending names, for the dialog and the log. */
      names: string[];
    };

export type ImportGuardOptions = {
  maxBytes?: number;
  roots?: readonly string[];
};

const MAX_NAMES = 5;

export function checkImport(
  state: Uint8Array,
  {
    maxBytes = IMPORT_MAX_BYTES,
    roots = IMPORT_ROOTS,
  }: ImportGuardOptions = {},
): ImportVerdict {
  if (state.byteLength > maxBytes)
    return { ok: false, code: "import_too_large", names: [] };
  const names = new Set<string>();
  const note = (name: string) => {
    if (names.size < MAX_NAMES) names.add(name.slice(0, 64));
  };
  const doc = new Y.Doc();
  try {
    for (const struct of Y.decodeUpdate(state).structs) {
      if (!(struct instanceof Y.Item)) continue;
      const { content } = struct;
      if (
        content instanceof Y.ContentType &&
        content.type instanceof Y.XmlElement &&
        !isAllowedNodeName(content.type.nodeName)
      )
        note(content.type.nodeName);
      else if (
        content instanceof Y.ContentFormat &&
        !isAllowedMarkKey(content.key)
      )
        note(markNameFromKey(content.key));
    }
    Y.applyUpdate(doc, state);
    for (const root of doc.share.keys()) if (!roots.includes(root)) note(root);
  } catch {
    return { ok: false, code: "corrupt", names: [] };
  } finally {
    doc.destroy();
  }
  return names.size === 0
    ? { ok: true }
    : { ok: false, code: "unknown_schema", names: [...names] };
}
