import { parseClientMaxTabsFromEnv } from "@/lib/security/guardrail-config";

/** Document ID for the built-in playground tab. Cannot be deleted via API. */
export const PLAYGROUND_ID = "playground";

/** Client-side cap for tabs per user session. */
export const MAX_TABS_PER_CLIENT = parseClientMaxTabsFromEnv();
