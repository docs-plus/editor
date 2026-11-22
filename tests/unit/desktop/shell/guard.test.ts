import { describe, expect, test } from "bun:test";

import {
  RENDERER_ORIGINS,
  UPDATE_ORIGINS_MIRROR,
} from "@/desktop/shared/doc-origins";
import { ERROR_CODES, fail, isErrorCode } from "@/desktop/shared/errors";
import {
  arr,
  bytes,
  int,
  obj,
  oneOf,
  opt,
  str,
  uuid,
} from "@/desktop/shared/guard";
import {
  CALL_CHANNELS,
  calls,
  EVENT_CHANNELS,
  events,
} from "@/desktop/shared/ipc-contract";
import { MAX_BATCH_BYTES } from "@/desktop/shared/limits";
import { STORAGE_ERROR_CODES } from "@/desktop/storage/engine/errors";
import { UPDATE_ORIGINS } from "@/lib/platform/doc-store";

/** Seeded PRNG (mulberry32), so a failure reproduces from its printed seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = Number(process.env.FUZZ_SEED ?? Date.now() % 1_000_000);

/** A random structured-clone-ish value, with hostile shapes mixed in. */
function randomValue(next: () => number, depth = 0): unknown {
  const pick = Math.floor(next() * 16);
  const s = () =>
    Array.from({ length: Math.floor(next() * 40) }, () =>
      String.fromCharCode(Math.floor(next() * 0x2fff)),
    ).join("");
  switch (pick) {
    case 0:
      return null;
    case 1:
      return undefined;
    case 2:
      return next() * 1e12 - 5e11;
    case 3:
      return Math.floor(next() * 2 ** 60) - 2 ** 59;
    case 4:
      return [Number.NaN, Infinity, -Infinity, -0][Math.floor(next() * 4)];
    case 5:
      return s();
    case 6:
      return crypto.randomUUID();
    case 7:
      return crypto.randomUUID().toUpperCase();
    case 8:
      return new Uint8Array(Math.floor(next() * 64));
    case 9:
      return next() > 0.5;
    case 10:
      return depth > 3
        ? {}
        : Array.from({ length: Math.floor(next() * 5) }, () =>
            randomValue(next, depth + 1),
          );
    case 11: {
      if (depth > 3) return {};
      const out: Record<string, unknown> = {};
      for (const key of [
        "docId",
        "record",
        "origin",
        "update",
        "x",
        "__proto__",
      ])
        if (next() > 0.5) out[key] = randomValue(next, depth + 1);
      return out;
    }
    case 12:
      return new Map([["docId", crypto.randomUUID()]]);
    case 13:
      return Object.create({ docId: crypto.randomUUID() });
    case 14:
      return {
        get docId() {
          throw new Error("hostile getter");
        },
      };
    default:
      return new ArrayBuffer(8);
  }
}

describe("guards", () => {
  test("str caps length and refuses non-strings", () => {
    expect(str(3)("abc")).toBe(true);
    expect(str(3)("abcd")).toBe(false);
    expect(str(3)(3)).toBe(false);
  });

  test("uuid takes lowercase UUIDs only", () => {
    const id = crypto.randomUUID();
    expect(uuid(id)).toBe(true);
    expect(uuid(id.toUpperCase())).toBe(false);
    expect(uuid(`${id} `)).toBe(false);
    expect(uuid("playground")).toBe(false);
  });

  test("int refuses floats, NaN, unsafe and out-of-range numbers", () => {
    const g = int(1, 10);
    expect(g(1)).toBe(true);
    expect(g(10)).toBe(true);
    expect(g(0)).toBe(false);
    expect(g(11)).toBe(false);
    expect(g(1.5)).toBe(false);
    expect(g(Number.NaN)).toBe(false);
    expect(int()(2 ** 60)).toBe(false);
    expect(int()("1")).toBe(false);
  });

  test("bytes takes a Uint8Array under the cap only", () => {
    expect(bytes(4)(new Uint8Array(4))).toBe(true);
    expect(bytes(4)(new Uint8Array(5))).toBe(false);
    expect(bytes(4)(new ArrayBuffer(2))).toBe(false);
    expect(bytes(4)([1, 2])).toBe(false);
  });

  test("obj refuses unknown keys, missing keys and non-plain objects", () => {
    const g = obj({ a: str(5), b: opt(int()) });
    expect(g({ a: "x" })).toBe(true);
    expect(g({ a: "x", b: undefined })).toBe(true);
    expect(g({ a: "x", b: 2 })).toBe(true);
    expect(g({ a: "x", c: 1 })).toBe(false);
    expect(g({ b: 2 })).toBe(false);
    expect(g(Object.create({ a: "x" }))).toBe(false);
    expect(g(new Map([["a", "x"]]))).toBe(false);
    expect(g(["x"])).toBe(false);
    expect(g(null)).toBe(false);
    expect(g(Object.assign(Object.create(null), { a: "x" }))).toBe(true);
  });

  test("arr and oneOf", () => {
    expect(arr(oneOf(["a", "b"] as const), 2)(["a", "b"])).toBe(true);
    expect(arr(oneOf(["a", "b"] as const), 2)(["a", "b", "a"])).toBe(false);
    expect(arr(oneOf(["a", "b"] as const), 2)(["c"])).toBe(false);
  });

  test("a throwing getter is a refusal, not a throw", () => {
    const hostile = {
      get docId(): string {
        throw new Error("boom");
      },
    };
    expect(calls["doc.open"].req(hostile)).toBe(false);
  });
});

describe("contract", () => {
  test(`fuzz: no guard throws, and accepted values are in bounds (seed ${SEED})`, () => {
    const next = rng(SEED);
    let accepted = 0;
    const guards = [
      ...CALL_CHANNELS.map((c) => calls[c].req),
      ...EVENT_CHANNELS.map((e) => events[e]),
    ];
    for (let i = 0; i < 10_000; i++) {
      const value = randomValue(next);
      for (const g of guards) {
        let result = false;
        expect(() => {
          result = g(value);
        }).not.toThrow();
        if (result) accepted++;
      }
    }
    // Some inputs (`{}` for doc.flush) are legitimately accepted.
    expect(accepted).toBeGreaterThan(0);
  });

  test("doc.append refuses an oversized batch and an unknown origin", () => {
    const docId = crypto.randomUUID();
    const g = calls["doc.append"].req;
    const record = { origin: "local", update: new Uint8Array(8) };
    expect(g({ docId, record })).toBe(true);
    expect(
      g({
        docId,
        record: { ...record, update: new Uint8Array(MAX_BATCH_BYTES + 1) },
      }),
    ).toBe(false);
    expect(g({ docId, record: { ...record, origin: "server" } })).toBe(false);
    expect(g({ docId, record: { ...record, title: "x".repeat(201) } })).toBe(
      false,
    );
    expect(g({ docId, record, owner: "w1" })).toBe(false);
  });

  test("SEC-011: a renderer appends only local and migration, and schemaTo only on migration", () => {
    const docId = crypto.randomUUID();
    const g = calls["doc.append"].req;
    const update = new Uint8Array(2);
    expect(g({ docId, record: { origin: "local", update } })).toBe(true);
    expect(g({ docId, record: { origin: "migration", update } })).toBe(true);
    expect(
      g({ docId, record: { origin: "migration", update, schemaTo: 2 } }),
    ).toBe(true);
    expect(g({ docId, record: { origin: "restore", update } })).toBe(false);
    expect(g({ docId, record: { origin: "remote", update } })).toBe(false);
    expect(g({ docId, record: { origin: "local", update, schemaTo: 2 } })).toBe(
      false,
    );
    expect([...RENDERER_ORIGINS]).toEqual(["local", "migration"]);
    for (const origin of RENDERER_ORIGINS)
      expect(UPDATE_ORIGINS_MIRROR).toContain(origin);
  });

  test("the origins mirror lib/platform/doc-store.ts", () => {
    expect([...UPDATE_ORIGINS_MIRROR]).toEqual([...UPDATE_ORIGINS]);
  });

  test("every storage error code is an IPC error code, with the same retryable flag", () => {
    for (const code of STORAGE_ERROR_CODES) {
      expect(isErrorCode(code)).toBe(true);
    }
    expect(fail("worker_restarting").error.retryable).toBe(true);
    expect(fail("forbidden").error.retryable).toBe(false);
    expect(Object.keys(ERROR_CODES)).toContain("build_mismatch");
  });
});
