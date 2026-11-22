/**
 * P2.7b's `LibraryIndex` contract on the SQLite library (P2.6e): the
 * `RpcLibraryIndex` adapter over the engine on `bun:sqlite`, through the
 * worker's own `dispatch`. The Electron soak's `contract` case runs the
 * same cases on `node:sqlite` in the real worker.
 */
import { afterEach } from "bun:test";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import { Library } from "@/desktop/storage/engine/library";
import { createNodeHost } from "@/desktop/storage/node-host";
import {
  createLibraryContractFactory,
  inProcessTransport,
} from "@/tests/helpers/library-index-harness";
import { createTempDir } from "@/tests/helpers/storage-library";
import { describeLibraryIndexContract } from "@/tests/unit/platform/document-index-contract";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describeLibraryIndexContract(
  "RpcLibraryIndex on the engine (bun:sqlite)",
  createLibraryContractFactory({
    tempDir() {
      const temp = createTempDir("tinydocy-index-");
      return { dir: temp.dir, remove: temp.cleanUp };
    },
    open: (dir, now) =>
      Library.open({
        dir,
        host: createNodeHost({ now }),
        openSqlite: openBunSqlite,
        fullfsync: false,
      }),
    attach(_dir, seeded) {
      if (!seeded) throw new Error("the in-process backend needs the library");
      return inProcessTransport(seeded);
    },
    track: (cleanup) => cleanups.push(cleanup),
  }),
);
