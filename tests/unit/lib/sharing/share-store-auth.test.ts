import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { isTombstoned } from "@/lib/security/activity-store";
import {
  addressKeys,
  createFailedTokenLimiter,
} from "@/lib/sharing/failed-tokens";
import {
  authenticateShare,
  SHARE_BUSY,
  SHARE_UNAVAILABLE,
  SHARE_VIEW_ONLY,
  type ShareAuthContext,
} from "@/lib/sharing/share-auth";
import { mintShareId, shareDocumentName } from "@/lib/sharing/share-name";
import {
  clearOldCreatorIpHashes,
  countActiveShares,
  endShare,
  getShare,
  recordShareStored,
  resetShare,
  setShareViewOnly,
} from "@/lib/sharing/share-store";
import { parseShareHash } from "@/lib/sharing/share-token";
import { createShareDb, seedShare } from "@/tests/helpers/share-db";
import { makeShareSecrets } from "@/tests/helpers/share-secrets";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_MS = 30 * DAY_MS;
const IP = "203.0.113.7";

let db: Database;
let nowMs: number;

function context(overrides: Partial<ShareAuthContext> = {}): ShareAuthContext {
  return {
    db,
    failedTokens: createFailedTokenLimiter({ perShare: 30, perPrefix: 10 }),
    mode: "on",
    expiryMs: EXPIRY_MS,
    now: () => nowMs,
    ...overrides,
  };
}

beforeEach(() => {
  db = createShareDb();
  nowMs = Date.UTC(2026, 10, 22);
});

afterEach(() => db.close());

describe("shares table", () => {
  it("creates a pending share and commits it on the first store", () => {
    const { shareId } = seedShare(db, nowMs);
    expect(getShare(db, shareId)?.status).toBe("pending");
    recordShareStored(db, shareId, 1234, nowMs + 5);
    const share = getShare(db, shareId);
    expect(share?.status).toBe("committed");
    expect(share?.size_bytes).toBe(1234);
    expect(share?.last_edit_at).toBe(nowMs + 5);
  });

  it("ends a share once, with its reason, deleting and tombstoning the document", () => {
    const { shareId } = seedShare(db, nowMs);
    const name = shareDocumentName(shareId);
    db.prepare("INSERT INTO documents (name, data) VALUES (?, ?)").run(
      name,
      new Uint8Array([1]),
    );
    expect(endShare(db, shareId, "removed", nowMs)).toBe(true);
    expect(endShare(db, shareId, "sharing_stopped", nowMs)).toBe(false);
    const share = getShare(db, shareId);
    expect(share?.status).toBe("ended");
    expect(share?.ended_reason).toBe("removed");
    expect(isTombstoned(db, name)).toBe(true);
    expect(
      db.prepare("SELECT 1 FROM documents WHERE name = ?").get(name),
    ).toBeNull();
    // An ended share never comes back: a later store changes nothing.
    recordShareStored(db, shareId, 99, nowMs + 1);
    expect(getShare(db, shareId)?.status).toBe("ended");
  });

  it("refuses an unknown end reason at the database", () => {
    const { shareId } = seedShare(db, nowMs);
    expect(() =>
      db
        .prepare("UPDATE shares SET ended_reason = 'oops' WHERE share_id = ?")
        .run(shareId),
    ).toThrow();
  });

  it("resets: the old share ends as link_reset and the new one keeps the lineage", () => {
    const { shareId } = seedShare(db, nowMs);
    const next = makeShareSecrets();
    const nextId = mintShareId();
    const ok = resetShare(
      db,
      shareId,
      {
        shareId: nextId,
        editHash: parseShareHash(next.hashes.edit_hash) as Buffer,
        viewHash: parseShareHash(next.hashes.view_hash) as Buffer,
        ownerHash: parseShareHash(next.hashes.owner_hash) as Buffer,
        schema: 3,
        createdIpHash: null,
      },
      nowMs,
    );
    expect(ok).toBe(true);
    expect(getShare(db, shareId)?.ended_reason).toBe("link_reset");
    expect(getShare(db, nextId)?.lineage).toBe(
      getShare(db, shareId)?.lineage as string,
    );
  });

  it("counts only shares that have not ended or expired", () => {
    seedShare(db, nowMs);
    seedShare(db, nowMs - 31 * DAY_MS);
    const { shareId } = seedShare(db, nowMs);
    endShare(db, shareId, "sharing_stopped", nowMs);
    expect(countActiveShares(db, nowMs, EXPIRY_MS)).toBe(1);
  });

  it("stops counting a share left pending for over an hour (M3)", () => {
    seedShare(db, nowMs - 61 * 60 * 1000);
    const committed = seedShare(db, nowMs - 2 * DAY_MS);
    recordShareStored(db, committed.shareId, 10, nowMs - DAY_MS);
    seedShare(db, nowMs - 59 * 60 * 1000);
    expect(countActiveShares(db, nowMs, EXPIRY_MS)).toBe(2);
  });

  it("ends a share left pending for over an hour on first contact (M3)", () => {
    const { shareId, secrets } = seedShare(db, nowMs - 61 * 60 * 1000);
    expect(
      authenticateShare(context(), shareId, secrets.authEdit, IP, "connection"),
    ).toEqual({ ok: false, reason: "expired" });
    expect(getShare(db, shareId)?.ended_reason).toBe("expired");
    // Its first store can no longer commit it past the cap.
    recordShareStored(db, shareId, 10, nowMs);
    expect(getShare(db, shareId)?.status).toBe("ended");
  });

  it("clears created_ip_hash after 30 days", () => {
    const old = seedShare(db, nowMs - 31 * DAY_MS);
    const fresh = seedShare(db, nowMs);
    expect(clearOldCreatorIpHashes(db, nowMs - 30 * DAY_MS)).toBe(1);
    expect(getShare(db, old.shareId)?.created_ip_hash).toBeNull();
    expect(getShare(db, fresh.shareId)?.created_ip_hash).toBe("ip-hash");
  });
});

describe("share authentication refusal matrix", () => {
  it("accepts the edit token as a writer and the view token as read-only", () => {
    const { shareId, secrets } = seedShare(db, nowMs);
    const edit = authenticateShare(
      context(),
      shareId,
      secrets.authEdit,
      IP,
      "connection",
    );
    expect(edit).toMatchObject({ ok: true, role: "edit", readOnly: false });
    const view = authenticateShare(
      context(),
      shareId,
      secrets.authView,
      IP,
      "connection",
    );
    expect(view).toMatchObject({ ok: true, role: "view", readOnly: true });
  });

  it("refuses guessing: an unknown share and a wrong token look the same", () => {
    const { shareId } = seedShare(db, nowMs);
    const wrong = makeShareSecrets();
    const guessed = authenticateShare(
      context(),
      mintShareId(),
      wrong.authEdit,
      IP,
      "connection",
    );
    const wrongToken = authenticateShare(
      context(),
      shareId,
      wrong.authEdit,
      IP,
      "connection",
    );
    expect(guessed).toEqual({ ok: false, reason: SHARE_UNAVAILABLE });
    expect(wrongToken).toEqual({ ok: false, reason: SHARE_UNAVAILABLE });
  });

  it("refuses the owner secret, a raw link secret and an empty token on a connection", () => {
    const { shareId, secrets } = seedShare(db, nowMs);
    for (const token of [
      secrets.ownerToken,
      secrets.e.toString("base64url"),
      secrets.view.toString("base64url"),
      "",
      null,
    ]) {
      expect(
        authenticateShare(context(), shareId, token, IP, "connection"),
      ).toEqual({ ok: false, reason: SHARE_UNAVAILABLE });
    }
  });

  it("accepts the owner secret only for owner calls", () => {
    const { shareId, secrets } = seedShare(db, nowMs);
    expect(
      authenticateShare(context(), shareId, secrets.ownerToken, IP, "owner"),
    ).toMatchObject({ ok: true, role: "owner" });
    expect(
      authenticateShare(context(), shareId, secrets.authEdit, IP, "owner"),
    ).toEqual({ ok: false, reason: SHARE_UNAVAILABLE });
  });

  it("reports deleted (stopped), removed and reset shares to token holders only", () => {
    for (const reason of [
      "sharing_stopped",
      "removed",
      "link_reset",
    ] as const) {
      const { shareId, secrets } = seedShare(db, nowMs);
      endShare(db, shareId, reason, nowMs);
      expect(
        authenticateShare(
          context(),
          shareId,
          secrets.authView,
          IP,
          "connection",
        ),
      ).toEqual({ ok: false, reason });
      expect(
        authenticateShare(
          context(),
          shareId,
          makeShareSecrets().authView,
          IP,
          "connection",
        ),
      ).toEqual({ ok: false, reason: SHARE_UNAVAILABLE });
    }
  });

  it("ends an expired share on first contact and reports expired", () => {
    const { shareId, secrets } = seedShare(db, nowMs - 31 * DAY_MS);
    const ended: string[] = [];
    const result = authenticateShare(
      context({ onEnded: (id) => ended.push(id) }),
      shareId,
      secrets.authEdit,
      IP,
      "connection",
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(getShare(db, shareId)?.ended_reason).toBe("expired");
    expect(ended).toEqual([shareId]);
  });

  it("tells edit-token holders view_only after Make view-only, and keeps viewers", () => {
    const { shareId, secrets } = seedShare(db, nowMs);
    setShareViewOnly(db, shareId);
    expect(
      authenticateShare(context(), shareId, secrets.authEdit, IP, "connection"),
    ).toEqual({ ok: false, reason: SHARE_VIEW_ONLY });
    expect(
      authenticateShare(context(), shareId, secrets.authView, IP, "connection"),
    ).toMatchObject({ ok: true, readOnly: true });
  });

  it("makes every connection read-only when HOCUS_SHARES=readonly", () => {
    const { shareId, secrets } = seedShare(db, nowMs);
    expect(
      authenticateShare(
        context({ mode: "readonly" }),
        shareId,
        secrets.authEdit,
        IP,
        "connection",
      ),
    ).toMatchObject({ ok: true, role: "edit", readOnly: true });
  });

  it("pauses a share as busy after too many failed tokens, per share_id", () => {
    const { shareId, secrets } = seedShare(db, nowMs);
    const ctx = context({
      failedTokens: createFailedTokenLimiter({ perShare: 3, perPrefix: 100 }),
    });
    for (let i = 0; i < 3; i++) {
      const ip = `198.51.100.${i}`;
      authenticateShare(
        ctx,
        shareId,
        makeShareSecrets().authEdit,
        ip,
        "connection",
      );
    }
    // Wrong tokens now pause the share; a right token still gets in (M1).
    expect(
      authenticateShare(
        ctx,
        shareId,
        makeShareSecrets().authEdit,
        IP,
        "connection",
      ),
    ).toEqual({ ok: false, reason: SHARE_BUSY });
    expect(
      authenticateShare(ctx, shareId, secrets.authEdit, IP, "connection"),
    ).toMatchObject({ ok: true, role: "edit" });
  });
});

describe("failed-token keys", () => {
  it("keys IPv4 by address and IPv6 by /64 and /48", () => {
    expect(addressKeys("203.0.113.7")).toEqual(["ip:203.0.113.7"]);
    expect(addressKeys("2001:db8:a:b::/64")).toEqual([
      "ip:2001:db8:a:b::/64",
      "p48:2001:db8:a::/48",
    ]);
  });

  it("blocks a /48 after failures spread over its /64s", () => {
    let t = 0;
    const limiter = createFailedTokenLimiter({
      perShare: 100,
      perPrefix: 3,
      now: () => t,
    });
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure(`2001:db8:a:${i}::/64`, mintShareId());
    }
    expect(limiter.isAddressBlocked("2001:db8:a:ff::/64")).toBe(true);
    expect(limiter.isAddressBlocked("2001:db8:b:0::/64")).toBe(false);
    t = 61_000;
    expect(limiter.isAddressBlocked("2001:db8:a:ff::/64")).toBe(false);
  });
});

describe("failed-token key table (M2)", () => {
  it("checks never add keys; only a recorded failure does", () => {
    const limiter = createFailedTokenLimiter({
      perShare: 3,
      perPrefix: 3,
      maxKeys: 4,
      maxShareKeys: 4,
    });
    for (let i = 0; i < 50; i++) {
      expect(limiter.isAddressBlocked(`2001:db8:a:${i}::/64`)).toBe(false);
      expect(limiter.isShareBlocked(mintShareId())).toBe(false);
    }
    // The tables are still empty, so a real failure is still counted.
    const shareId = mintShareId();
    for (let i = 0; i < 3; i++) limiter.recordFailure(IP, shareId);
    expect(limiter.isShareBlocked(shareId)).toBe(true);
    expect(limiter.isAddressBlocked(IP)).toBe(true);
  });

  it("a full address table blocks new addresses and logs it, once per window", () => {
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (line: string) => warnings.push(line);
    try {
      const limiter = createFailedTokenLimiter({
        perShare: 100,
        perPrefix: 100,
        maxKeys: 3,
        now: () => nowMs,
      });
      for (let i = 0; i < 3; i++) limiter.recordFailure(`198.51.100.${i}`);
      // Tracked addresses are judged on their own count.
      expect(limiter.isAddressBlocked("198.51.100.0")).toBe(false);
      expect(limiter.isAddressBlocked("198.51.100.99")).toBe(true);
      expect(limiter.isAddressBlocked("198.51.100.98")).toBe(true);
      const events = warnings.filter((line) =>
        line.includes("share_failed_token_table_full"),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toContain('"table":"addresses"');
    } finally {
      console.warn = warn;
    }
  });

  it("unknown share ids take no share-key slot; a full share table fails closed", () => {
    const ctx = context({
      failedTokens: createFailedTokenLimiter({
        perShare: 100,
        perPrefix: 1000,
        maxShareKeys: 1,
        now: () => nowMs,
      }),
    });
    const wrong = () => makeShareSecrets().authEdit;
    for (let i = 0; i < 50; i++) {
      authenticateShare(ctx, mintShareId(), wrong(), IP, "connection");
    }
    const first = seedShare(db, nowMs);
    const second = seedShare(db, nowMs);
    // The flood left the one slot free for a real share.
    expect(
      authenticateShare(ctx, first.shareId, wrong(), IP, "connection"),
    ).toEqual({ ok: false, reason: SHARE_UNAVAILABLE });
    // Now full: wrong tokens on an untracked share pause as busy ...
    expect(
      authenticateShare(ctx, second.shareId, wrong(), IP, "connection"),
    ).toEqual({ ok: false, reason: SHARE_BUSY });
    // ... and a right token still gets in.
    expect(
      authenticateShare(
        ctx,
        second.shareId,
        second.secrets.authEdit,
        IP,
        "connection",
      ),
    ).toMatchObject({ ok: true });
  });

  it("a flood of random share ids from one /48 never makes a real share busy", () => {
    const { shareId, secrets } = seedShare(db, nowMs);
    const ctx = context({
      failedTokens: createFailedTokenLimiter({
        perShare: 30,
        perPrefix: 10,
        maxKeys: 20,
        now: () => nowMs,
      }),
    });
    for (let i = 0; i < 500; i++) {
      authenticateShare(
        ctx,
        mintShareId(),
        makeShareSecrets().authEdit,
        `2001:db8:a:${i % 4000}::/64`,
        "connection",
      );
    }
    expect(
      authenticateShare(ctx, shareId, secrets.authEdit, IP, "connection"),
    ).toMatchObject({ ok: true, role: "edit" });
    // A wrong token elsewhere is refused as unknown, not as busy.
    expect(
      authenticateShare(
        ctx,
        shareId,
        makeShareSecrets().authEdit,
        "198.51.100.9",
        "connection",
      ),
    ).toEqual({ ok: false, reason: SHARE_UNAVAILABLE });
  });
});
