export {
  bindLocalCopy,
  createIndexedDbBackend,
  createMemoryBackend,
  type DocStoreBackend,
  LOCAL_ORIGIN,
  type LocalBinding,
  LocalDocStore,
  OFFLINE_CACHE_EPOCH,
  OFFLINE_DOC_MAX_AGE_DAYS,
  OFFLINE_MAX_DOCS,
  storeKey,
} from "./local-doc-store";
export {
  clearOfflineData,
  getLocalDocStore,
  OFFLINE_CACHE_ENABLED,
  OFFLINE_EDIT_BUDGET_BYTES,
  removeLocalCopy,
  sweepLocalCopies,
} from "./offline-cache";
