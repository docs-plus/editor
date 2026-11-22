/**
 * Storage keys and the payload version of the preferences (preferences
 * design §5.2). No imports, so the lazy continue chunk can read them
 * without pulling in the schema.
 */

/** The `tinydocy-ui` key: the prefs slots beside the M6 and A15 slots. */
export const UI_STORAGE_KEY = "tinydocy-ui";
/** §5.6: which page look this browser started on, written once at boot. */
export const LOOK_STORAGE_KEY = "tinydocy-look";
/** The continue position (M15) that `rememberPlace` gates. */
export const CONTINUE_STORAGE_KEY = "tinydocy-continue";

/**
 * The one preferences payload version.
 * - Web: `tinydocy-ui` stores it as `v`. Its owner, `remembered-choice`
 *   (`STORAGE_VERSION`, pinned equal by a test), discards a payload with
 *   any other `v` and rewrites it on the next choice, so the boot script
 *   and the store read nothing from another version either.
 * - Desktop: `meta('prefs')` (P2.9b) stores it as `v`. Main reads a newer
 *   `v` field by field through `parsePrefs` and writes nothing until the
 *   user changes a setting, so a downgraded app never drops newer values.
 */
export const PREFS_VERSION = 1;
