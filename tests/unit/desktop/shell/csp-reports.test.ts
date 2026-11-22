import { expect, test } from "bun:test";

import {
  CSP_REPORT_WINDOW_MS,
  CSP_REPORTS_PER_WINDOW,
  reportToken,
} from "@/desktop/main/csp-reports";
import { FixedWindowLimiter } from "@/desktop/main/rate-limit";

test("CSP reports carry only a directive or scheme token", () => {
  for (const ok of ["img-src", "style-src-elem", "https:", "inline", "eval"])
    expect(reportToken(ok)).toBe(ok);
  for (const bad of [
    "https://evil.example/x",
    "a b",
    "x".repeat(41),
    "",
    7,
    null,
    { toString: () => "img-src" },
  ])
    expect(reportToken(bad)).toBe("?");
});

test("SEC-010: a flood of reports keeps the cap and logs one drop per window per minute", () => {
  const clock = { t: 0 };
  const limiter = new FixedWindowLimiter(
    CSP_REPORTS_PER_WINDOW,
    CSP_REPORT_WINDOW_MS,
    () => clock.t,
  );
  const verdicts = Array.from({ length: 10_000 }, () => limiter.take(1));
  expect(verdicts.filter((v) => v === "ok")).toHaveLength(
    CSP_REPORTS_PER_WINDOW,
  );
  expect(verdicts.filter((v) => v === "first_drop")).toHaveLength(1);
  expect(limiter.take(2)).toBe("ok");
  clock.t += CSP_REPORT_WINDOW_MS;
  expect(limiter.take(1)).toBe("ok");
});
