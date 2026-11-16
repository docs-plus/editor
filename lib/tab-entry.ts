import { PLAYGROUND_ID } from "@/lib/constants";
import { isValidUserDocumentId } from "@/lib/security/doc-id-validator";

/**
 * One entry of the shared tab list (`tabs` Y.Array) and its validation. Free
 * of client code, so the server (the tab-list repair in Hocus and the
 * closed-documents store) imports it without reaching `lib/tab-api`.
 */

export type Tab = {
  id: string;
  title: string;
  createdAt: number;
};

export function isTab(value: unknown): value is Tab {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as Tab).id === "string" &&
    "title" in value &&
    typeof (value as Tab).title === "string" &&
    "createdAt" in value &&
    typeof (value as Tab).createdAt === "number"
  );
}

export const MAX_TAB_TITLE_LENGTH = 200;

/**
 * True for an entry any client may render: a well-formed tab whose id is the
 * playground or a valid user document id. The tab list is shared and writable
 * by every anonymous visitor, so nothing in it is trusted.
 */
export function isValidTabEntry(value: unknown): value is Tab {
  return (
    isTab(value) &&
    Number.isFinite(value.createdAt) &&
    (value.id === PLAYGROUND_ID || isValidUserDocumentId(value.id))
  );
}
