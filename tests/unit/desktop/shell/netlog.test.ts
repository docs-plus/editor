import { describe, expect, test } from "bun:test";

import { hostOf, hostsInNetLog, nonLoopback } from "../../../electron/netlog";

const log = (events: Array<Record<string, unknown>>) =>
  JSON.stringify({
    constants: {},
    events: events.map((params) => ({ type: 1, params })),
  });

describe("net-log hosts", () => {
  test("reads hosts from URLs, host:port pairs and DNS lookups", () => {
    const text = log([
      { url: "https://redirector.gvt1.com/edgedl/chrome/dict/en-us-10-2.bdic" },
      { url: "ws://127.0.0.1:1234/" },
      { host: "wpad" },
      { host: "www.youtube-nocookie.com:443" },
      { original_url: "app://tinydocy/index.html" },
      { location: "http://[::1]:9/" },
      { url: "not a url at all" },
    ]);
    expect(hostsInNetLog(text)).toEqual([
      "127.0.0.1",
      "[::1]",
      "redirector.gvt1.com",
      "wpad",
      "www.youtube-nocookie.com",
    ]);
  });

  test("closes a log cut short by a kill", () => {
    const full = log([{ url: "https://example.com/" }, { host: "wpad" }]);
    const truncated = `${full.slice(0, full.lastIndexOf("]"))},`;
    expect(hostsInNetLog(truncated)).toEqual(["example.com", "wpad"]);
  });

  test("nonLoopback keeps only hosts that leave the machine", () => {
    expect(
      nonLoopback(
        ["127.0.0.1", "localhost", "[::1]", "tinydocy", "wpad", "a.gvt1.com"],
        [/^wpad$/],
      ),
    ).toEqual(["a.gvt1.com"]);
  });

  test("hostOf ignores free text and lowercases", () => {
    expect(hostOf("HTTPS://Example.COM/x")).toBe("example.com");
    expect(hostOf("two words")).toBeNull();
    expect(hostOf("app://tinydocy/")).toBeNull();
  });
});
