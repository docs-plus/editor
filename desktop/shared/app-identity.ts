/**
 * Install identifiers and the app origin (desktop architecture D-A11; plan
 * D33). Everything that names the app on disk or to the OS reads from here,
 * so a rename after the trademark search touches one module. The first
 * signed Gate 3 build freezes these values.
 */

/** The privileged scheme the renderer is served from. */
export const APP_SCHEME = "app";
export const APP_HOST = "tinydocy";
/**
 * `app://tinydocy`. Compare with `${url.protocol}//${url.host}`, never
 * `url.origin`: Node reports `"null"` for a non-special scheme (spike S1).
 */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Deep links: `tinydocy://` and `tinydocy://local/<uuid>`. */
export const DEEP_LINK_SCHEME = "tinydocy";

/** File types the shell accepts from `argv` and `open-file` (import is P2.8). */
export const OPENABLE_EXTENSIONS = {
  ".md": "md",
  ".html": "html",
  ".tinydoc": "tinydoc",
} as const;

export type OpenableKind =
  (typeof OPENABLE_EXTENSIONS)[keyof typeof OPENABLE_EXTENSIONS];

/**
 * The Referer main sets on YouTube player frames, which arrive with none or
 * an `app:` one: YouTube refuses an embed without a web Referer (Error 153,
 * spike S1). The website's origin, the same value the web app sends.
 */
export const EMBED_REFERER = "https://tiny.docs.plus/";
