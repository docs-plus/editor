/**
 * The share-consent line about document links (search-linking design §4.4
 * "Shared (Live)" and §8 "Share consent with links"). The P4.4 consent
 * window counts the links-only pass's rows and shows the line when the
 * document links to any of your documents.
 */
import type { LinkRow } from "@/lib/links/extract-links";

/** Distinct documents linked, so links to two headings of one count once. */
export function countLinkedDocuments(rows: readonly LinkRow[]): number {
  return new Set(rows.map((row) => row.key)).size;
}

export function consentLinksLine(count: number): string | null {
  if (count <= 0) return null;
  return `This document links to ${count} of your documents. People you share with will see the link text but can't open them.`;
}
