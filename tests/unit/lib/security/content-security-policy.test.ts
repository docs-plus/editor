import { describe, expect, it } from "vitest";

import { GA_CONNECT_HOSTS, GA_SCRIPT_HOSTS } from "@/lib/analytics-config";
import { buildContentSecurityPolicy } from "@/lib/security/content-security-policy";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.split(" ")
    .slice(1) ?? [];

const base = { nodeEnv: "production", hocusUrl: "wss://ws.example.test" };

describe("buildContentSecurityPolicy", () => {
  it("ships no Google hosts without a measurement ID", () => {
    const csp = buildContentSecurityPolicy({ ...base, gaMeasurementId: null });
    expect(csp).not.toMatch(/google/);
    expect(directive(csp, "connect-src")).toEqual([
      "'self'",
      "wss://ws.example.test",
      "https://publish.x.com",
    ]);
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("adds exactly the GA4 hosts when analytics is configured", () => {
    const csp = buildContentSecurityPolicy({
      ...base,
      gaMeasurementId: "G-TEST1234",
    });
    expect(directive(csp, "script-src")).toEqual(
      expect.arrayContaining(GA_SCRIPT_HOSTS),
    );
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining(GA_CONNECT_HOSTS),
    );
    expect(directive(csp, "frame-src").join(" ")).not.toMatch(/google/);
    expect(directive(csp, "img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https:",
    ]);
  });

  it("keeps the hardening directives", () => {
    const csp = buildContentSecurityPolicy({ ...base, gaMeasurementId: null });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("pins the service worker and manifest to this origin", () => {
    const csp = buildContentSecurityPolicy({ ...base, gaMeasurementId: null });
    expect(directive(csp, "worker-src")).toEqual(["'self'"]);
    expect(directive(csp, "manifest-src")).toEqual(["'self'"]);
  });

  it("allows eval only in development", () => {
    const csp = buildContentSecurityPolicy({
      ...base,
      nodeEnv: "development",
      gaMeasurementId: null,
    });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
  });
});
