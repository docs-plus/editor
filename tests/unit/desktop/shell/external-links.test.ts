import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXTERNAL_OPEN_LIMIT,
  EXTERNAL_OPEN_WINDOW_MS,
  ExternalLinkGate,
  externalHttpsUrl,
} from "@/desktop/main/external-links";
import { safeFileCheck } from "@/desktop/main/safe-file";

const request = (over: Partial<Parameters<ExternalLinkGate["decide"]>[0]>) => ({
  windowId: 1,
  url: "https://example.com/",
  fromTopAppFrame: true,
  now: 0,
  ...over,
});

describe("ExternalLinkGate", () => {
  test("opens https from the app's top frame", () => {
    expect(new ExternalLinkGate().decide(request({}))).toEqual({
      action: "open",
      url: "https://example.com/",
    });
  });

  test("refuses anything from an embed or another frame", () => {
    expect(
      new ExternalLinkGate().decide(request({ fromTopAppFrame: false })),
    ).toEqual({ action: "refuse", reason: "frame" });
  });

  test("refuses every scheme but https, and credentials", () => {
    const gate = new ExternalLinkGate();
    for (const url of [
      "http://example.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "tinydocy://local/x",
      "app://tinydocy/",
      "https://user:pw@example.com/",
      "not a url",
    ])
      expect(gate.decide(request({ url }))).toEqual({
        action: "refuse",
        reason: "scheme",
      });
    expect(externalHttpsUrl("HTTPS://Example.com/a b")).toBe(
      "https://example.com/a%20b",
    );
  });

  test("limits opens per window, reports the first refusal of a burst only", () => {
    const gate = new ExternalLinkGate();
    for (let i = 0; i < EXTERNAL_OPEN_LIMIT; i++)
      expect(gate.decide(request({ now: i })).action).toBe("open");
    expect(gate.decide(request({ now: 10 }))).toEqual({
      action: "refuse",
      reason: "rate",
      rateLimitedFirst: true,
    });
    expect(gate.decide(request({ now: 11 }))).toEqual({
      action: "refuse",
      reason: "rate",
      rateLimitedFirst: false,
    });
    // Another window has its own budget.
    expect(gate.decide(request({ windowId: 2, now: 12 })).action).toBe("open");
    // The window frees up once the oldest open ages out.
    expect(
      gate.decide(request({ now: EXTERNAL_OPEN_WINDOW_MS + 1 })).action,
    ).toBe("open");
  });

  test("forget clears a closed window's history", () => {
    const gate = new ExternalLinkGate(1, 1000);
    gate.decide(request({}));
    expect(gate.decide(request({ now: 1 })).action).toBe("refuse");
    gate.forget(1);
    expect(gate.decide(request({ now: 2 })).action).toBe("open");
  });
});

describe("safeFileCheck", () => {
  const root = mkdtempSync(join(tmpdir(), "tinydocy-safe-file-"));
  const outside = mkdtempSync(join(tmpdir(), "tinydocy-outside-"));
  mkdirSync(join(root, "_next"));
  writeFileSync(join(root, "index.html"), "<p>ok</p>");
  writeFileSync(join(root, "_next", "a.js"), "1");
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(join(outside, "secret.txt"), join(root, "leak.txt"));
  symlinkSync(join(root, "index.html"), join(root, "alias.html"));
  symlinkSync(outside, join(root, "linked-dir"));
  const isFile = safeFileCheck(root);

  test("serves regular files under the root", () => {
    expect(isFile("index.html")).toBe(true);
    expect(isFile("_next/a.js")).toBe(true);
  });

  test("never serves through a symlink, inside or outside the root", () => {
    expect(isFile("leak.txt")).toBe(false);
    expect(isFile("alias.html")).toBe(false);
    expect(isFile("linked-dir/secret.txt")).toBe(false);
  });

  test("refuses directories and missing files", () => {
    expect(isFile("_next")).toBe(false);
    expect(isFile("missing.js")).toBe(false);
  });

  test("works when the root itself is reached through a symlink", () => {
    const parent = mkdtempSync(join(tmpdir(), "tinydocy-root-link-"));
    const linkedRoot = join(parent, "renderer");
    symlinkSync(root, linkedRoot);
    expect(safeFileCheck(linkedRoot)("index.html")).toBe(true);
    expect(safeFileCheck(linkedRoot)("leak.txt")).toBe(false);
  });
});
