import { expect } from "@playwright/test";

/** One assertion + cast — avoids duplicate `expect` + `if (!x) throw` in specs. */
export function assertTruthy<T>(value: T | null | undefined, label: string): T {
  expect(value, label).toBeTruthy();
  return value as T;
}
