import { parseClientMaxTabsFromEnv } from "@/lib/security/guardrail-config";

/** Document ID for the built-in playground tab. Cannot be deleted via API. */
export const PLAYGROUND_ID = "playground";

/** Client-side cap for tabs per user session. */
export const MAX_TABS_PER_CLIENT = parseClientMaxTabsFromEnv();

/** Outbound links (footer / collab strip). Override per deployment via env. */
export const DISCORD_INVITE_URL =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ||
  "https://discord.com/invite/25JPG38J59";
export const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ||
  "https://github.com/docs-plus/editor";
