import { describe, expect, it } from "bun:test";

import { getHocuspocusWsUrl } from "@/lib/hocuspocus";
import { CLIENT_BUILD, withClientVersion } from "@/lib/schema-version";

describe("withClientVersion", () => {
  it("adds schema=2 and build without touching host or path", () => {
    const url = new URL(withClientVersion("wss://ws.example/collab?x=1"));
    expect(url.searchParams.get("schema")).toBe("2");
    expect(url.searchParams.get("build")).toBe(CLIENT_BUILD);
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.host).toBe("ws.example");
    expect(url.pathname).toBe("/collab");
  });

  it("lets e2e override the schema value", () => {
    window.__HOCUS_SCHEMA = "1";
    expect(
      new URL(withClientVersion("ws://127.0.0.1:1234")).searchParams.get(
        "schema",
      ),
    ).toBe("1");
    delete window.__HOCUS_SCHEMA;
  });

  it("leaves the URL that offline keys are scoped by unchanged", () => {
    expect(getHocuspocusWsUrl()).not.toContain("schema=");
  });
});
