import type * as Y from "yjs";

import { isValidTabEntry } from "@/lib/tab-api";

/**
 * Deletes malformed, duplicate and deleted (tombstoned) entries from a
 * shared tab list in one transaction and returns how many were removed.
 * Clients sanitize on read as well; this keeps stored state clean for every
 * later visitor, and stops an offline client from re-adding a closed tab.
 */
export function repairTabsArray(
  tabs: Y.Array<unknown>,
  isDeleted: (id: string) => boolean = () => false,
): number {
  const seen = new Set<string>();
  const invalid: number[] = [];
  tabs.toArray().forEach((entry, index) => {
    if (!isValidTabEntry(entry) || seen.has(entry.id) || isDeleted(entry.id)) {
      invalid.push(index);
      return;
    }
    seen.add(entry.id);
  });
  if (invalid.length === 0) return 0;
  const apply = () => {
    for (const index of invalid.reverse()) tabs.delete(index, 1);
  };
  if (tabs.doc) tabs.doc.transact(apply);
  else apply();
  return invalid.length;
}
