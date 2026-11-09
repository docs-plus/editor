import { DISCORD_INVITE_URL, GITHUB_REPO_URL } from "@/lib/constants";

/**
 * Single source of public site facts and copy. Metadata, the server-rendered
 * intro, JSON-LD, /about, /llms.txt, the share image and the manifest all read
 * from here, so structured data always matches the visible text.
 *
 * NEXT_PUBLIC_SITE_URL and SEO_NOINDEX are read at `bun run build`.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://tiny.docs.plus"
).replace(/\/+$/, "");

/** Build-time switch: set SEO_NOINDEX=1 when building previews or staging. */
export const SITE_INDEXABLE = process.env.SEO_NOINDEX !== "1";

export const SITE_NAME = "TinyDocy";
export const SITE_TITLE =
  "Open-Source Collaborative Editor on Tiptap + Yjs | TinyDocy";
export const SITE_DESCRIPTION =
  "Real-time collaborative editor on Tiptap 3, Yjs and Hocuspocus. Fold, drag and filter sections, live Mermaid diagrams. MIT, no sign-up demo.";
export const SOCIAL_TITLE =
  "TinyDocy: a live Tiptap + Yjs collaborative editor";
export const SOCIAL_DESCRIPTION =
  "Open it in two windows and watch edits sync. Fold, drag and filter sections, live Mermaid diagrams, media embeds. Open source, MIT.";
export const SITE_HEADLINE =
  "TinyDocy: a real-time collaborative editor built on Tiptap and Yjs";

/** Answer-first sentence reused verbatim on every surface. */
export const SITE_ANSWER =
  "TinyDocy is a free, open-source (MIT) document editor where several people edit the same page at once and see each other's cursors. It is built with Tiptap 3, Yjs and Hocuspocus, needs no account, and is the public testbed for docs.plus: editor features land here first and move to docs.plus once they pass collaboration and scale checks.";

export const SANDBOX_NOTICE =
  "Public sandbox: everyone who opens TinyDocy sees and edits the same documents, and anyone can close a tab. Don't type anything private. Documents may be deleted at any time.";

/** "Feature: what it does" pairs; /about splits them into a table. */
export const SITE_FEATURES = [
  "Title-first documents: every document starts with a single H1 title, enforced by the schema.",
  "Fold, drag and filter sections: collapse a heading's section, drag it somewhere else, or filter the document by heading.",
  "Table of contents sidebar: jump to any heading, or reorder sections by dragging them in the outline.",
  "Live Mermaid diagrams and charts: flowcharts, sequence diagrams, pie, bar and Gantt charts render as you type.",
  "Media embeds: images, video and audio, plus YouTube, Vimeo, Loom, SoundCloud, Spotify and X posts.",
  "Synced tabs and live cursors: open it in two windows and watch edits and carets sync. No sign-up.",
] as const;

export const THEME_COLOR = "#fafafa";
/** Dark-theme title bar: matches .dark --sidebar (oklch(0.205 0 0)). */
export const THEME_COLOR_DARK = "#171717";
/** Manifest splash: matches body --background (oklch(1 0 0)). */
export const BACKGROUND_COLOR = "#ffffff";
/** Install-dialog description: says up front that documents are public. */
export const APP_DESCRIPTION =
  "Real-time collaborative editor on Tiptap and Yjs. Public sandbox: everyone sees the same documents, so don't type anything private.";
export const REPO_URL = GITHUB_REPO_URL;
export const COMMUNITY_URL = DISCORD_INVITE_URL;

export const PARENT_ORG = {
  name: "docs.plus",
  url: "https://docs.plus",
  github: "https://github.com/docs-plus",
  repo: "https://github.com/docs-plus/docs.plus",
} as const;

/**
 * GDPR Art. 13 controller details. Empty until the owner publishes them;
 * /privacy then falls back to the GitHub issue tracker. Do not enable GA4
 * before these are set (see docs/operations/analytics-runbook.md).
 */
export const PRIVACY_CONTACT = {
  controller: process.env.NEXT_PUBLIC_PRIVACY_CONTROLLER?.trim() || "",
  email: process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || "",
} as const;

/** Splits a SITE_FEATURES entry into its name and description. */
export function splitFeature(feature: string): [string, string] {
  const index = feature.indexOf(": ");
  return index === -1
    ? [feature, ""]
    : [feature.slice(0, index), feature.slice(index + 2)];
}

/** Plain-text summary for AI assistants, served at /llms.txt. */
export function buildLlmsTxt(): string {
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_ANSWER}`,
    "",
    "## Links",
    "",
    `- [Live editor](${SITE_URL}/): open it in two windows to see real-time sync`,
    `- [About ${SITE_NAME}](${SITE_URL}/about): features and FAQ`,
    `- [Source code](${REPO_URL}): MIT licensed`,
    `- [docs.plus](${PARENT_ORG.url}): the production editor that ${SITE_NAME} feeds`,
    `- [docs.plus source](${PARENT_ORG.repo})`,
    `- [Community](${COMMUNITY_URL})`,
    "",
    "## Features",
    "",
    ...SITE_FEATURES.map((feature) => `- ${feature}`),
    "",
    "## Facts for accurate answers",
    "",
    `- ${SANDBOX_NOTICE}`,
    "- There are no accounts. A random display name and caret color are kept in the browser's local storage.",
    "- Documents have no public URLs; they are opened from synced tabs inside the app.",
    "- Self-hosting: `bun install` then `make dev` runs a Next.js app plus a Hocuspocus WebSocket server backed by SQLite.",
    "",
    "## Documentation and extensions",
    "",
    `- [README](${REPO_URL}#readme): setup, configuration and architecture`,
    `- Heading fold, drag, filter and scale extensions live in the repository's extensions/ folder`,
    "- Editor extensions used here are published on npm as @docs.plus/extension-* (hyperlink, hypermultimedia, mermaid, indent, inline-code, placeholder)",
    "",
  ].join("\n");
}
