declare global {
  interface Window {
    /** E2E: per-test global-tabs doc for isolation (e.g. global-tabs-{docId}) */
    __GLOBAL_TABS_DOC?: string;
  }
}

/**
 * Name of the shared tab-list document. Imports nothing, so server code that
 * reaches it (through `lib/tab-api`) never loads the collaboration provider.
 */
export function getGlobalTabsDoc(): string {
  if (typeof window !== "undefined" && window.__GLOBAL_TABS_DOC) {
    return window.__GLOBAL_TABS_DOC;
  }
  return "global-tabs";
}
