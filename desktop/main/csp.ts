/**
 * The desktop CSP (plan §7 "Desktop CSP"; spike S1 §3.1.3, §5 item 4),
 * built by main for every HTML response:
 * - `script-src 'self'` plus the SHA-256 of each inline script in that page
 *   (Next's inline bootstrap scripts); no `'unsafe-inline'`, no `blob:`;
 * - `style-src-elem 'self'` plus hashes, including Tiptap's injected base
 *   stylesheet (its text is fixed per Tiptap version, hashed at build);
 *   `style-src-attr 'unsafe-inline'` (the pre-registered S1 amendment:
 *   ProseMirror and node views set `style` attributes);
 * - `img-src 'self'`: no `data:` icons remain (#120) and remote images are
 *   placeholders until the user loads them (D10);
 * - `connect-src 'self'` plus the default sync server only;
 * - the media players' frame hosts, without X's (#99: link cards).
 */
import { createHash } from "node:crypto";

import { MEDIA_FRAME_HOSTS } from "../../lib/security/content-security-policy";

/** X hosts never appear on desktop: posts render as static link cards. */
const X_HOSTS = new Set([
  "https://platform.twitter.com",
  "https://syndication.twitter.com",
]);

export const DESKTOP_FRAME_HOSTS = MEDIA_FRAME_HOSTS.filter(
  (host) => !X_HOSTS.has(host),
);

const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
const INLINE_STYLE = /<style[^>]*>([\s\S]*?)<\/style>/gi;

export function sha256Source(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

export type InlineHashes = { scripts: string[]; styles: string[] };

/** Hashes the exact text of every `src`-less `<script>` and every `<style>`. */
export function hashInline(html: string): InlineHashes {
  return {
    scripts: [...html.matchAll(INLINE_SCRIPT)].map((m) => sha256Source(m[1])),
    styles: [...html.matchAll(INLINE_STYLE)].map((m) => sha256Source(m[1])),
  };
}

export type DesktopCspOptions = {
  /** The default sync server, e.g. `wss://ws.tiny.docs.plus`. */
  syncUrl: string;
  hashes: InlineHashes;
  /** Hashes of styles injected at runtime (Tiptap's base CSS). */
  runtimeStyleHashes: readonly string[];
};

const unique = (list: readonly string[]) => [...new Set(list)];

export function buildDesktopCsp({
  syncUrl,
  hashes,
  runtimeStyleHashes,
}: DesktopCspOptions): string {
  const scripts = ["'self'", ...unique(hashes.scripts)].join(" ");
  const styles = [
    "'self'",
    ...unique([...hashes.styles, ...runtimeStyleHashes]),
  ].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    `style-src ${styles}`,
    `style-src-elem ${styles}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self'",
    "media-src 'self'",
    "font-src 'self'",
    `connect-src 'self' ${syncUrl}`,
    "worker-src 'self'",
    `frame-src ${DESKTOP_FRAME_HOSTS.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * The CSP for every non-HTML response (SEC-008). A script, stylesheet,
 * font or image loaded by a page is governed by that page's CSP; this one
 * applies only when a response becomes a document or a worker of its own:
 * an SVG opened directly, or a script started as a worker.
 * - Nothing loads but same-origin files; no inline script, no connections
 *   beyond the app's origin, no frames, forms or plugins.
 * - An SVG is also sandboxed (an opaque origin with scripts off), so a
 *   document made of one can't act as the app.
 */
export function buildResourceCsp(contentType: string): string {
  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ];
  if (contentType.startsWith("image/svg+xml")) directives.push("sandbox");
  return directives.join("; ");
}
