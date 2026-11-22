/**
 * Bidi isolation for plain text (languages design §3.5, §4.6). In React,
 * user text in chrome uses the native `<bdi>` element (or `dir="auto"`);
 * these helpers are for strings that leave React: native menus, dialogs,
 * window titles, notifications and filenames.
 */

/** FSI…PDI: isolates text whose direction comes from its own content. */
export const fsi = (text: string): string => `\u2068${text}\u2069`;

/** LRI…PDI: keeps a shortcut such as "Ctrl+Shift+V" left to right. */
export const lri = (text: string): string => `\u2066${text}\u2069`;

/**
 * LRM, RLM, ALM, the embeddings and overrides (U+202A–U+202E) and the
 * isolates (U+2066–U+2069). ZWNJ (U+200C) and ZWJ (U+200D) are not bidi
 * controls: Persian words and emoji sequences need them.
 */
const BIDI_CONTROLS = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

/**
 * Removes bidi controls, so a title such as "report\u202Efdp.exe" can't
 * spoof a file extension in an exported filename (OWASP: untrusted input in
 * filenames). Applies in every interface language.
 */
export const stripBidiControls = (text: string): string =>
  text.replace(BIDI_CONTROLS, "");
