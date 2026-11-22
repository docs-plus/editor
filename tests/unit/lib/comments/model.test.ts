import { describe, expect, it } from "bun:test";

import {
  cleanAuthorName,
  cleanBody,
  cleanLine,
  cleanQuote,
} from "@/lib/comments/clean";
import { CLIENT_LIMITS, SERVER_LIMITS } from "@/lib/comments/limits";
import { entryBytes, liveBytes, utf8Length } from "@/lib/comments/measure";
import {
  anchorKey,
  messageKey,
  newId,
  parseKey,
  statusKey,
  threadKey,
} from "@/lib/comments/model";
import type * as Permissions from "@/lib/comments/permissions";
import { canComment, commentsAllowedIn } from "@/lib/comments/permissions";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

const RLO = String.fromCharCode(0x202e);
const ISOLATE = String.fromCharCode(0x2066);
const BELL = String.fromCharCode(7);
const FAMILY = String.fromCodePoint(0x1f469, 0x200d, 0x1f467);
const COMPOSED = String.fromCharCode(0xe9);
const DECOMPOSED = `e${String.fromCharCode(0x301)}`;
const EURO = String.fromCharCode(0x20ac);
const LONE = `a${String.fromCharCode(0xd800)}`;

describe("keys and ids (§4.1)", () => {
  it("mints 22-character base64url ids, all different", () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("parses its own keys and nothing else", () => {
    const tid = newId();
    const mid = newId();
    expect(parseKey(threadKey(tid))).toEqual({ kind: "t", tid });
    expect(parseKey(anchorKey(tid))).toEqual({ kind: "a", tid });
    expect(parseKey(statusKey(tid))).toEqual({ kind: "s", tid });
    expect(parseKey(messageKey(tid, mid))).toEqual({ kind: "m", tid, mid });
    for (const key of [
      "t:short",
      `x:${tid}`,
      `m:${tid}`,
      `${threadKey(tid)}x`,
      "",
    ]) {
      expect(parseKey(key)).toBeNull();
    }
  });
});

describe("cleaning (§4.3)", () => {
  it("keeps line breaks in bodies and drops bidi and control characters", () => {
    expect(
      cleanBody(`  one${RLO}\n${BELL}two${ISOLATE}  \n\n\n\nthree  `),
    ).toBe("one\ntwo\n\nthree");
  });

  it("normalises to NFC", () => {
    expect(cleanBody(DECOMPOSED)).toBe(COMPOSED);
  });

  it("makes names one line and cuts them to 40 units at a grapheme boundary", () => {
    expect(cleanLine(`Ann${RLO}\nLee`)).toBe("Ann Lee");
    const long = FAMILY.repeat(20);
    const name = cleanAuthorName(long);
    expect(name.length).toBeLessThanOrEqual(CLIENT_LIMITS.name);
    expect(name).toBe(FAMILY.repeat(Math.floor(40 / FAMILY.length)));
  });

  it("cuts a long quote to 280 with an ellipsis", () => {
    const quote = cleanQuote("word ".repeat(100));
    expect(quote.length).toBeLessThanOrEqual(CLIENT_LIMITS.quote);
    expect(quote.endsWith("…")).toBe(true);
  });
});

describe("limits (§4.2)", () => {
  it("keeps every client limit at or under the server's", () => {
    for (const key of Object.keys(
      CLIENT_LIMITS,
    ) as (keyof typeof CLIENT_LIMITS)[]) {
      expect(CLIENT_LIMITS[key]).toBeLessThanOrEqual(SERVER_LIMITS[key]);
    }
  });
});

describe("measure (§4.2)", () => {
  it("counts UTF-8 bytes without allocating", () => {
    for (const text of ["abc", COMPOSED, EURO, FAMILY, LONE]) {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
    }
  });

  it("counts live values only: an overwrite replaces, a delete removes", () => {
    const map = new Map<string, unknown>();
    const key = anchorKey(newId());
    map.set(key, { s: new Uint8Array(10), e: new Uint8Array(10) });
    const once = liveBytes(map);
    for (let index = 0; index < 1000; index++) {
      map.set(key, { s: new Uint8Array(10), e: new Uint8Array(10) });
    }
    expect(liveBytes(map)).toBe(once);
    expect(once).toBe(entryBytes(key, map.get(key)));
    map.delete(key);
    expect(liveBytes(map)).toBe(0);
  });
});

describe("canComment() (§6.2, §6.3)", () => {
  const base = {
    role: "edit",
    kind: "local",
    readOnlyReason: null,
    feature: "on",
  } as const;

  it("is on for edit links, owners and Local, library and live documents", () => {
    expect(canComment(base)).toBe(true);
    expect(canComment({ ...base, role: "owner", kind: "library" })).toBe(true);
    expect(canComment({ ...base, kind: "share" })).toBe(true);
  });

  it("is off for view links, the sandbox, the Playground and the tab list", () => {
    expect(canComment({ ...base, role: "view" })).toBe(false);
    for (const kind of ["sandbox", "playground", "tabs"] as const) {
      expect(commentsAllowedIn(kind)).toBe(false);
      expect(canComment({ ...base, kind })).toBe(false);
    }
  });

  it("allows reading mode, and no other read-only reason", () => {
    expect(canComment({ ...base, readOnlyReason: "reading" })).toBe(true);
    expect(canComment({ ...base, readOnlyReason: "document_too_large" })).toBe(
      false,
    );
  });

  it("is off while the feature switch is off", () => {
    expect(canComment({ ...base, feature: "off" })).toBe(false);
  });

  it("lands dark: NEXT_PUBLIC_COMMENTS defaults to off", async () => {
    const saved = process.env.NEXT_PUBLIC_COMMENTS;
    try {
      delete process.env.NEXT_PUBLIC_COMMENTS;
      const off = await importFresh<typeof Permissions>(
        "@/lib/comments/permissions",
      );
      expect(off.COMMENTS_FEATURE).toBe("off");
      expect(
        off.canComment({ role: "owner", kind: "local", readOnlyReason: null }),
      ).toBe(false);
      process.env.NEXT_PUBLIC_COMMENTS = "1";
      const other = await importFresh<typeof Permissions>(
        "@/lib/comments/permissions",
      );
      expect(other.COMMENTS_FEATURE).toBe("off");
      process.env.NEXT_PUBLIC_COMMENTS = "on";
      const on = await importFresh<typeof Permissions>(
        "@/lib/comments/permissions",
      );
      expect(on.COMMENTS_FEATURE).toBe("on");
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_COMMENTS;
      else process.env.NEXT_PUBLIC_COMMENTS = saved;
      resetModules();
    }
  });
});
