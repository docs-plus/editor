import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import * as encoding from "lib0/encoding";

import { CLIENT_SCHEMA } from "@/lib/schema-version";
import {
  CLIENT_OUTDATED_REASON,
  classifyClientSchema,
  clientOutdatedError,
  createClientSchemaCounter,
  effectiveMinClientSchema,
  isClientOutdated,
  isGateExempt,
  SCHEMA_FLOOR,
  shouldDropOutdatedFrame,
} from "@/lib/security/client-schema-gate";
import {
  HOCUS_MESSAGE_AUTH,
  readFrameHeader,
} from "@/lib/security/hocus-frame";

/** Hocuspocus frame: varString key, varUint message type, then `rest`. */
function frame(key: string, messageType: number, ...rest: number[]) {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, key);
  encoding.writeVarUint(encoder, messageType);
  for (const value of rest) encoding.writeVarUint(encoder, value);
  return encoding.toUint8Array(encoder);
}

const SYNC = 0;
const DOC = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  mock.restore();
});

describe("readFrameHeader", () => {
  it("reads the document name and message type", () => {
    expect(readFrameHeader(frame(DOC, SYNC, 0))).toEqual({
      documentName: DOC,
      messageType: SYNC,
    });
  });

  it("strips the session id from session-aware keys, as Hocuspocus does", () => {
    expect(readFrameHeader(frame("global-tabs\0abc", 1))).toEqual({
      documentName: "global-tabs",
      messageType: 1,
    });
  });

  it("returns null for frames that do not decode", () => {
    expect(readFrameHeader(Uint8Array.of(255))).toBeNull();
    expect(readFrameHeader(Uint8Array.of(3, 97))).toBeNull();
    expect(readFrameHeader(frame("doc", SYNC).subarray(0, 4))).toBeNull();
    expect(readFrameHeader(new Uint8Array())).toBeNull();
  });
});

describe("SCHEMA_FLOOR", () => {
  it("is 2 and never refuses the current client", () => {
    expect(SCHEMA_FLOOR).toBe(2);
    expect(SCHEMA_FLOOR).toBeLessThanOrEqual(CLIENT_SCHEMA);
  });
  it("the env can raise the effective minimum, never lower it", () => {
    expect([0, 1, 2, 3, 7].map(effectiveMinClientSchema)).toEqual([
      2, 2, 2, 3, 7,
    ]);
  });
  it("the effective minimum always refuses a missing or old schema", () => {
    const min = effectiveMinClientSchema(0);
    for (const raw of [null, "", "abc", "0", "1"])
      expect(isClientOutdated(raw, min)).toBe(true);
    expect(isClientOutdated("2", min)).toBe(false);
  });
});

describe("isClientOutdated", () => {
  const odd = [null, "", " 2", "2.0", "0x2", "1e1", "-2", "abc", "1"];
  it("never refuses at min 0 (log only)", () => {
    for (const raw of [...odd, "2", "3"])
      expect(isClientOutdated(raw, 0)).toBe(false);
  });
  it("refuses everything but an integer ≥ min at min 2", () => {
    for (const raw of odd) expect(isClientOutdated(raw, 2)).toBe(true);
    for (const raw of ["2", "3", "02"])
      expect(isClientOutdated(raw, 2)).toBe(false);
    expect(
      isClientOutdated(
        new URLSearchParams("schema=1&schema=2").get("schema"),
        2,
      ),
    ).toBe(true);
  });
});

it("buckets relative to CLIENT_SCHEMA", () => {
  expect(CLIENT_SCHEMA).toBe(2);
  expect([null, "abc", "1", "2", "3"].map(classifyClientSchema)).toEqual([
    "missing",
    "invalid",
    "low",
    "ok",
    "ok",
  ]);
  expect(["", " 2", "2.0", "-2"].map(classifyClientSchema)).toEqual([
    "invalid",
    "invalid",
    "invalid",
    "invalid",
  ]);
});

it("exempts only the tab lists", () => {
  expect(["global-tabs", "global-tabs-x1"].every(isGateExempt)).toBe(true);
  expect(
    ["playground", crypto.randomUUID(), "global-tabsx"].some(isGateExempt),
  ).toBe(false);
});

it("refuses without an abuse log", () => {
  const warn = spyOn(console, "warn");
  const err = clientOutdatedError();
  expect([err.reason, err.stack]).toEqual([CLIENT_OUTDATED_REASON, ""]);
  expect(err.reason).toBe("client_outdated");
  expect(warn).not.toHaveBeenCalled();
});

it("drops non-Auth frames for gated documents only", () => {
  expect(HOCUS_MESSAGE_AUTH).toBe(2);
  expect(shouldDropOutdatedFrame(frame(DOC, HOCUS_MESSAGE_AUTH, 0))).toBe(
    false,
  );
  expect(shouldDropOutdatedFrame(frame(DOC, SYNC, 0))).toBe(true);
  expect(shouldDropOutdatedFrame(frame("playground", 1))).toBe(true);
  expect(shouldDropOutdatedFrame(frame("global-tabs", SYNC, 0))).toBe(false);
  expect(shouldDropOutdatedFrame(frame("global-tabs\0s1", SYNC, 0))).toBe(
    false,
  );
  expect(shouldDropOutdatedFrame(Uint8Array.of(255))).toBe(true);
});

describe("createClientSchemaCounter", () => {
  it("logs one aggregate line without raw values", () => {
    const lines: string[] = [];
    const counter = createClientSchemaCounter({
      log: (l) => lines.push(l),
      maxBuilds: 1,
    });
    counter.record(new URLSearchParams("schema=abc&build=a b"), false);
    counter.record(new URLSearchParams("schema=1&build=v1"), true);
    counter.record(new URLSearchParams("schema=2&build=v2"), false);
    counter.flush();
    counter.flush();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: "hocus",
      event: "client_schema",
      missing: 0,
      invalid: 1,
      low: 1,
      ok: 1,
      refused: 1,
      builds: { invalid: 1, v1: 1, other: 1 },
    });
    expect(
      Number.isNaN(Date.parse(JSON.parse(lines[0]).window_start)),
    ).toBeFalse();
    expect(lines[0]).not.toContain("abc");
    expect(lines[0]).not.toContain("a b");
    counter.stop();
  });

  it("counts a missing build and rejects build values outside the pattern", () => {
    const lines: string[] = [];
    const counter = createClientSchemaCounter({ log: (l) => lines.push(l) });
    counter.record(new URLSearchParams(""), false);
    counter.record(new URLSearchParams(`build=${"x".repeat(41)}`), false);
    counter.record(new URLSearchParams("build=a%0Ab"), false);
    counter.stop();
    expect(JSON.parse(lines[0])).toMatchObject({
      missing: 3,
      builds: { missing: 1, invalid: 2 },
    });
  });

  it("flushes on its interval and stop() flushes then clears the timer", async () => {
    const lines: string[] = [];
    const counter = createClientSchemaCounter({
      log: (l) => lines.push(l),
      intervalMs: 20,
    });
    counter.record(new URLSearchParams("schema=2&build=v2"), false);
    await Bun.sleep(60);
    expect(lines).toHaveLength(1);
    counter.record(new URLSearchParams("schema=2&build=v2"), false);
    counter.stop();
    expect(lines).toHaveLength(2);
    await Bun.sleep(60);
    expect(lines).toHaveLength(2);
  });
});
