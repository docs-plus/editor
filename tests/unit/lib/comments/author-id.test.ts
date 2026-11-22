import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type * as AuthorIdModule from "@/lib/comments/author-id";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type Mod = typeof AuthorIdModule;
let m: Mod;

beforeEach(async () => {
  localStorage.clear();
  m = await importFresh<Mod>("@/lib/comments/author-id");
});

afterEach(() => {
  localStorage.clear();
  resetModules();
});

describe("comment author id (§6.1)", () => {
  it("stores nothing until a comment needs it", () => {
    expect(localStorage.getItem(m.AUTHOR_ID_KEY)).toBeNull();
    expect(localStorage.getItem("tinydocy-user")).toBeNull();
  });

  it("mints one 22-character base64url id and keeps it", () => {
    const id = m.getAuthorId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(localStorage.getItem(m.AUTHOR_ID_KEY)).toBe(id);
    expect(m.getAuthorId()).toBe(id);
  });

  it("replaces an invalid stored id", () => {
    localStorage.setItem(m.AUTHOR_ID_KEY, "not-an-id");
    const id = m.getAuthorId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(localStorage.getItem(m.AUTHOR_ID_KEY)).toBe(id);
  });

  it("keeps one id for the session when storage throws", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(m.getAuthorId()).toBe(m.getAuthorId());
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
      else delete (window as { localStorage?: Storage }).localStorage;
    }
  });
});
