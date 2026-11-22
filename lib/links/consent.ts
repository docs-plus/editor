/**
 * The share-consent line about document links (search-linking design §4.4
 * "Shared (Live)", §4.7 and §8 "Share consent with links", D-O8). Links to
 * documents that aren't shared become plain text by default
 * (`stripPrivateDocLinks`); the consent window says how many, counted by
 * `countPrivateDocLinks` (the same walk, so the numbers agree), and
 * [Keep Links] (`LINK_COPY.keepLinks`) keeps them.
 */
import { LINK_COPY } from "@/lib/links/link-copy";

/** The line itself is §8 copy (`LINK_COPY.consent`); null at 0. */
export function consentLinksLine(count: number): string | null {
  return count > 0 ? LINK_COPY.consent(count) : null;
}
