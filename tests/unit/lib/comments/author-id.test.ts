import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";

import type * as AuthorIdModule from "@/lib/comments/author-id";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type Mod = typeof AuthorIdModule;
let m: Mod;

const ID = /^[A-Za-z0-9_-]{22}$/;
const LINEAGE_A = "6f1c2a52-6c39-4a56-9a5e-0d8f8b1f0c11";
const LINEAGE_B = "0b7e9b0c-25a8-4f3f-8d65-61f7c5e2d9aa";

beforeEach(async () => {
  localStorage.clear();
  m = await importFresh<Mod>("@/lib/comments/author-id");
});

afterEach(() => {
  localStorage.clear();
  resetModules();
});

describe("comment author id (§6.1, SEC-002)", () => {
  it("stores nothing until a comment needs it", () => {
    expect(localStorage.getItem(m.DEVICE_SECRET_KEY)).toBeNull();
    expect(localStorage.getItem("tinydocy-user")).toBeNull();
  });

  it("is HMAC-SHA-256(deviceSecret, lineage), 128 bits as base64url", async () => {
    const id = await m.authorIdFor(LINEAGE_A);
    const secret = localStorage.getItem(m.DEVICE_SECRET_KEY);
    expect(secret).toMatch(ID);
    expect(id).toMatch(ID);
    const expected = createHmac("sha256", secret ?? "")
      .update(`tinydocy comment author v1\0${LINEAGE_A}`)
      .digest()
      .subarray(0, 16)
      .toString("base64url");
    expect(id).toBe(expected);
  });

  it("is stable per document and unlinkable across documents", async () => {
    const a = await m.authorIdFor(LINEAGE_A);
    const b = await m.authorIdFor(LINEAGE_B);
    expect(await m.authorIdFor(LINEAGE_A)).toBe(a);
    expect(b).not.toBe(a);
    // Neither id is the secret, so a document never carries it.
    const secret = localStorage.getItem(m.DEVICE_SECRET_KEY);
    expect([a, b]).not.toContain(secret);
  });

  it("survives a reload: the secret is kept in this browser", async () => {
    const before = await m.authorIdFor(LINEAGE_A);
    resetModules();
    const fresh = await importFresh<Mod>("@/lib/comments/author-id");
    expect(await fresh.authorIdFor(LINEAGE_A)).toBe(before);
  });

  it("replaces an invalid stored secret", async () => {
    localStorage.setItem(m.DEVICE_SECRET_KEY, "not-a-secret");
    await m.authorIdFor(LINEAGE_A);
    expect(localStorage.getItem(m.DEVICE_SECRET_KEY)).toMatch(ID);
  });

  it("keeps one secret for the session when storage throws", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(await m.authorIdFor(LINEAGE_A)).toBe(
        await m.authorIdFor(LINEAGE_A),
      );
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
      else delete (window as { localStorage?: Storage }).localStorage;
    }
  });

  it("falls back to a per-session, per-document id without WebCrypto", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: crypto.getRandomValues.bind(crypto) },
    });
    try {
      const a = await m.authorIdFor(LINEAGE_A);
      expect(a).toMatch(ID);
      expect(await m.authorIdFor(LINEAGE_A)).toBe(a);
      expect(await m.authorIdFor(LINEAGE_B)).not.toBe(a);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    }
  });
});
