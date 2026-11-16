import { createHash } from "node:crypto";

/** YouTube player hosts the desktop allows in `frame-src` (no X hosts). */
export const DESKTOP_FRAME_HOSTS = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.loom.com",
  "https://w.soundcloud.com",
  "https://open.spotify.com",
];

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const INLINE_STYLE = /<style[^>]*>([\s\S]*?)<\/style>/gi;

function sha256(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

export interface InlineHashes {
  scripts: string[];
  styles: string[];
}

/** Hashes the exact text of every `src`-less `<script>` and every `<style>`. */
export function hashInline(html: string): InlineHashes {
  const scripts = [...html.matchAll(INLINE_SCRIPT)].map((m) => sha256(m[1]));
  const styles = [...html.matchAll(INLINE_STYLE)].map((m) => sha256(m[1]));
  return { scripts, styles };
}

export type StyleMode = "strict" | "attr-unsafe-inline";

export interface DesktopCspOptions {
  hocusUrl: string;
  hashes: InlineHashes;
  /**
   * `strict`: `style-src 'self'` plus hashes only.
   * `attr-unsafe-inline`: the pre-registered amendment, `style-src-elem`
   * hashes plus `style-src-attr 'unsafe-inline'`.
   */
  styleMode: StyleMode;
}

export function buildDesktopCsp({
  hocusUrl,
  hashes,
  styleMode,
}: DesktopCspOptions): string {
  const uniq = (list: string[]) => [...new Set(list)];
  const scriptSrc = ["'self'", ...uniq(hashes.scripts)].join(" ");
  const styleElem = ["'self'", ...uniq(hashes.styles)].join(" ");
  const styleDirectives =
    styleMode === "strict"
      ? [`style-src ${styleElem}`]
      : [
          `style-src ${styleElem}`,
          `style-src-elem ${styleElem}`,
          "style-src-attr 'unsafe-inline'",
        ];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    ...styleDirectives,
    // CSS-inlined SVG icons (heading drag, list checkbox, phone sheet) are
    // data: URIs; img-src covers CSS backgrounds and masks.
    "img-src 'self' data:",
    "media-src 'self'",
    "font-src 'self'",
    `connect-src 'self' ${hocusUrl}`,
    "worker-src 'self'",
    `frame-src ${DESKTOP_FRAME_HOSTS.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
