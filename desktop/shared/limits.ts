/**
 * Caps the IPC guards enforce (desktop architecture §7). Main refuses a
 * request over a cap with `invalid_argument`; the renderer's batcher and
 * compaction stay well under them.
 */

/** A whole document's compacted state (`doc.compact`). */
export const MAX_DOC_BYTES = 64 * 1024 * 1024;
/** One merged batch of updates (`doc.append`): far above a 1 s batch. */
export const MAX_BATCH_BYTES = 16 * 1024 * 1024;
/** The title the renderer reads from the first heading (engine `MAX_TITLE_LENGTH`). */
export const MAX_TITLE_LENGTH = 200;
/** The list-view snippet (engine `MAX_SNIPPET_LENGTH`). */
export const MAX_SNIPPET_LENGTH = 300;
/** `docs.schema` values the renderer may migrate to. */
export const MAX_DOC_SCHEMA = 1_000;
/** The IPC build id the preload sends (a git SHA or "dev"). */
export const MAX_BUILD_ID_LENGTH = 64;
