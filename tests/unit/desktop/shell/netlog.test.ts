import { describe, expect, test } from "bun:test";

import {
  hostOf,
  hostsInNetLog,
  nonLoopback,
  scanNetLog,
} from "../../../electron/netlog";

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
        [
          "127.0.0.1",
          "localhost",
          "[::1]",
          "wpad",
          "wpad.evil.com",
          "a.gvt1.com",
        ],
        ["wpad"],
      ),
    ).toEqual(["wpad.evil.com", "a.gvt1.com"]);
  });

  test("hostOf ignores free text and lowercases", () => {
    expect(hostOf("HTTPS://Example.COM/x")).toBe("example.com");
    expect(hostOf("two words")).toBeNull();
    expect(hostOf("app://tinydocy/")).toBeNull();
  });

  test("userinfo never hides the host, and socket params are read", () => {
    const { hosts, unparsed } = scanNetLog(
      log([
        { url: "https://127.0.0.1@evil.example/x" },
        { url: "wss://user:pw@evil2.example:443/" },
        { remote_address: "93.184.216.34:443" },
        { source_address: "fe80::1" },
        { address_list: ["[2001:db8::1]:443", "10.0.0.5:80"] },
        { host: "under_score.example" },
        { url: "https://[bad" },
      ]),
    );
    expect(hosts).toEqual([
      "10.0.0.5",
      "93.184.216.34",
      "[2001:db8::1]",
      "[fe80::1]",
      "evil.example",
      "evil2.example",
      "under_score.example",
    ]);
    expect(unparsed).toEqual(["https://[bad"]);
  });
});
