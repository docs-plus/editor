import { HOCUS_ALLOW_ISOLATED_TABS_DOCS } from "@/lib/security/guardrail-config";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_ID_LENGTH = 64;

export const PLAYGROUND_DOC = "playground";
export const TABS_DOC = "global-tabs";
const ISOLATED_TABS_DOC_REGEX = /^global-tabs-[A-Za-z0-9_-]{1,128}$/;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasPathTraversal(value: string): boolean {
  return value.includes("../") || value.includes("..\\");
}

/** Shared documents every visitor loads: exempt from creation limits and retention. */
export function isSystemDocumentId(name: string): boolean {
  return name === PLAYGROUND_DOC || name === TABS_DOC;
}

/** Reserved names that clients may never create, delete or reuse as user docs. */
function isReservedName(name: string): boolean {
  return isSystemDocumentId(name) || name.startsWith(`${TABS_DOC}-`);
}

export function isValidUserDocumentId(id: string): boolean {
  if (!id || id.length > MAX_ID_LENGTH) return false;
  if (hasControlChars(id)) return false;
  if (hasPathTraversal(id)) return false;
  if (isReservedName(id)) return false;
  return UUID_REGEX.test(id) || SAFE_ID_REGEX.test(id);
}

/**
 * Per-test tab lists (`global-tabs-<id>`), accepted only when
 * `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1`. They are ordinary documents for
 * creation limits and retention, but get the tab-list size cap and repair.
 */
export function isIsolatedTabsDocumentId(
  name: string,
  allowIsolated: boolean = HOCUS_ALLOW_ISOLATED_TABS_DOCS,
): boolean {
  return allowIsolated && ISOLATED_TABS_DOC_REGEX.test(name);
}

/** Documents holding a synced tab list (Y.Array "tabs"). */
export function isTabsDocumentId(
  name: string,
  allowIsolated: boolean = HOCUS_ALLOW_ISOLATED_TABS_DOCS,
): boolean {
  return name === TABS_DOC || isIsolatedTabsDocumentId(name, allowIsolated);
}

export function isValidWsDocumentName(
  name: string,
  allowIsolated: boolean = HOCUS_ALLOW_ISOLATED_TABS_DOCS,
): boolean {
  return (
    isValidUserDocumentId(name) ||
    isSystemDocumentId(name) ||
    isIsolatedTabsDocumentId(name, allowIsolated)
  );
}
