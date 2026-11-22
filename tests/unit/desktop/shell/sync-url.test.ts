import { expect, test } from "bun:test";

import { validateSyncUrl } from "@/desktop/build/sync-url";

test("accepts a bare wss origin, and ws only in test builds", () => {
  expect(validateSyncUrl("wss://ws.tiny.docs.plus", "release")).toBe(
    "wss://ws.tiny.docs.plus",
  );
  expect(validateSyncUrl(" ws://127.0.0.1:1234/ ", "test")).toBe(
    "ws://127.0.0.1:1234",
  );
  expect(() => validateSyncUrl("ws://127.0.0.1:1234", "release")).toThrow();
});

test("refuses anything that could add a CSP directive or source", () => {
  for (const bad of [
    "wss://a.example; script-src *",
    "wss://a.example https://evil.example",
    "wss://a.example,evil",
    "https://a.example",
    "javascript:alert(1)",
    "wss://user:pw@a.example",
    "wss://a.example/path",
    "wss://a.example?x=1",
    "wss://*.example.com",
    "wss://*",
    "wss://a_b.example",
    "wss://-a.example",
    "not a url",
    "",
  ])
    expect(() => validateSyncUrl(bad, "test")).toThrow();
});
