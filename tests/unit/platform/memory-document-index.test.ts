import { MemoryDocumentIndex } from "@/tests/helpers/memory-document-index";
import {
  describeDocumentIndexContract,
  describeLibraryIndexContract,
} from "@/tests/unit/platform/document-index-contract";

describeDocumentIndexContract("MemoryDocumentIndex", (options) => {
  const index = new MemoryDocumentIndex(options);
  return {
    index,
    fixed: [],
    load: () => index.load(),
    purge: () => index.purgeTrash(),
  };
});

describeLibraryIndexContract("MemoryDocumentIndex", (options) => {
  const index = new MemoryDocumentIndex(options);
  return {
    index,
    load: () => index.load(),
    purge: () => index.purgeTrash(),
  };
});
