/**
 * The share-consent line about document links (search-linking design §4.4
 * "Shared (Live)" and §8 "Share consent with links"). The P4.4 consent
 * window counts the links-only pass's rows and shows the line when the
 * document links to any of your documents.
 */
import type { LinkRow } from "@/lib/links/extract-links";
import { LINK_COPY } from "@/lib/links/link-copy";

/** Distinct documents linked, so links to two headings of one count once. */
export function countLinkedDocuments(rows: readonly LinkRow[]): number {
  return new Set(rows.map((row) => row.key)).size;
}

/** The line itself is §8 copy (`LINK_COPY.consent`); null at 0. */
export function consentLinksLine(count: number): string | null {
  return count > 0 ? LINK_COPY.consent(count) : null;
}
