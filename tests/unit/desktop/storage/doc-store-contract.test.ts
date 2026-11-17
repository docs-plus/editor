/**
 * P2.1's shared `DocStore` contract (architecture §11) on the storage
 * engine over `bun:sqlite`, through the same dispatch the worker uses. The
 * Electron soak's `contract` case runs it again on `node:sqlite` inside the
 * real worker.
 */
import { describe, it } from "bun:test";

import type { Library } from "@/desktop/storage/engine/library";
import { defineDocStoreContract } from "@/tests/helpers/doc-store-contract";
import { createEngineDocStore } from "@/tests/helpers/engine-doc-store";
import {
  createClock,
  createTempDir,
  createTestHost,
  openTestLibrary,
} from "@/tests/helpers/storage-library";

defineDocStoreContract(
  { describe, it },
  "DocStore contract on the engine (bun:sqlite)",
  {
    exclusiveOpen: true,
    async createLibrary() {
      const temp = createTempDir();
      const library: Library = openTestLibrary(
        temp.dir,
        createTestHost(createClock()),
      );
      let clients = 0;
      return {
        connect: () => createEngineDocStore(library, `client-${++clients}`),
        async createDoc(docId, schema) {
          library.createDoc({ id: docId, schema });
        },
        async dispose() {
          library.shutdown();
          temp.cleanUp();
        },
      };
    },
  },
);
