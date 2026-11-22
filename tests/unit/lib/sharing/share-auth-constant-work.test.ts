import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { createFailedTokenLimiter } from "@/lib/sharing/failed-tokens";
import { mintShareId } from "@/lib/sharing/share-name";
import * as shareToken from "@/lib/sharing/share-token";
import { createShareDb, seedShare } from "@/tests/helpers/share-db";
import { makeShareSecrets } from "@/tests/helpers/share-secrets";

const realTokenMatchesHash = shareToken.tokenMatchesHash;
let comparisons = 0;
mock.module("@/lib/sharing/share-token", () => ({
  ...shareToken,
  tokenMatchesHash: (...args: Parameters<typeof realTokenMatchesHash>) => {
    comparisons++;
    return realTokenMatchesHash(...args);
  },
}));
// Loaded after the mock: static imports are hoisted above `mock.module`.
const { authenticateShare } = await import("@/lib/sharing/share-auth");

let db: ReturnType<typeof createShareDb>;

beforeEach(() => {
  db = createShareDb();
  comparisons = 0;
});

afterEach(() => db.close());

/**
 * L1: an unknown share id must cost the same digest comparisons as a known
 * one with a wrong token, so response time does not tell whether a share
 * exists. Pinned by counting comparisons, not by timing.
 */
describe("share auth does the same work for unknown and known shares", () => {
  for (const credential of ["connection", "owner", "any"] as const) {
    it(`compares digests when the row is missing (${credential})`, () => {
      const context = {
        db,
        mode: "on" as const,
        expiryMs: 30 * 24 * 60 * 60 * 1000,
        failedTokens: createFailedTokenLimiter({
          perShare: 1000,
          perPrefix: 1000,
        }),
      };
      const { shareId } = seedShare(db);
      const wrong = makeShareSecrets();
      const token = credential === "owner" ? wrong.ownerToken : wrong.authEdit;

      authenticateShare(context, shareId, token, "203.0.113.1", credential);
      const known = comparisons;
      comparisons = 0;
      authenticateShare(
        context,
        mintShareId(),
        token,
        "203.0.113.1",
        credential,
      );
      expect(known).toBeGreaterThan(0);
      expect(comparisons).toBe(known);
    });
  }
});
