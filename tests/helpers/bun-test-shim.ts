/**
 * Just enough of `bun:test` to run a `describe`/`it` suite outside Bun:
 * the Electron storage harness bundles the `LibraryIndex` contract
 * (`tests/unit/platform/document-index-contract.ts`) with `bun:test`
 * aliased to this file (`desktop/storage-harness/build.ts`).
 *
 * `describe` runs its body at once and `it` collects the case; the host
 * runs them with {@link takeCases}. `expect` has the matchers the contract
 * uses, with `bun:test`'s meaning: `toEqual` ignores properties that are
 * `undefined` and accepts `expect.any(Type)`.
 */
import { isDeepStrictEqual } from "node:util";

export type ShimCase = { name: string; run: () => unknown };

const cases: ShimCase[] = [];
const path: string[] = [];

export function describe(name: string, body: () => void): void {
  path.push(name);
  try {
    body();
  } finally {
    path.pop();
  }
}

export function it(name: string, run: () => unknown): void {
  cases.push({ name: [...path, name].join(" > "), run });
}

export const test = it;

/** The cases collected so far, and forgets them. */
export function takeCases(): ShimCase[] {
  return cases.splice(0);
}

class AnyOf {
  constructor(readonly type: unknown) {}
  matches(value: unknown): boolean {
    switch (this.type) {
      case String:
        return typeof value === "string" || value instanceof String;
      case Number:
        return typeof value === "number" || value instanceof Number;
      case Boolean:
        return typeof value === "boolean";
      case Function:
        return typeof value === "function";
      case Object:
        return value !== null && typeof value === "object";
      default:
        return value instanceof (this.type as new () => unknown);
    }
  }
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof AnyOf)
  );
}

/** `bun:test`'s `toEqual`: undefined properties count as absent. */
function equals(actual: unknown, expected: unknown): boolean {
  if (expected instanceof AnyOf) return expected.matches(actual);
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, at) => equals(actual[at], item))
    );
  }
  if (isPlain(expected) && isPlain(actual)) {
    const keys = (value: Record<string, unknown>) =>
      Object.keys(value).filter((key) => value[key] !== undefined);
    const mine = keys(actual);
    const theirs = keys(expected);
    return (
      mine.length === theirs.length &&
      theirs.every((key) => equals(actual[key], expected[key]))
    );
  }
  return isDeepStrictEqual(actual, expected);
}

/** `toMatchObject`: every expected property matches; extra ones are fine. */
function matchesObject(actual: unknown, expected: unknown): boolean {
  if (isPlain(expected)) {
    return (
      isPlain(actual) &&
      Object.keys(expected).every((key) =>
        matchesObject(actual[key], expected[key]),
      )
    );
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, at) => matchesObject(actual[at], item))
    );
  }
  return equals(actual, expected);
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

type Matchers = {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatchObject(expected: unknown): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeTruthy(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
};

function matchers(actual: unknown, negate: boolean): Matchers {
  const check = (pass: boolean, what: string, ...expected: unknown[]) => {
    if (pass === negate)
      throw new Error(
        `expected ${show(actual)} ${negate ? "not " : ""}${what}${
          expected.length > 0 ? ` ${show(expected[0])}` : ""
        }`,
      );
  };
  return {
    toBe: (expected) => check(Object.is(actual, expected), "to be", expected),
    toEqual: (expected) =>
      check(equals(actual, expected), "to equal", expected),
    toMatchObject: (expected) =>
      check(matchesObject(actual, expected), "to match", expected),
    toContain: (expected) =>
      check(
        (Array.isArray(actual) || typeof actual === "string") &&
          actual.includes(expected as never),
        "to contain",
        expected,
      ),
    toHaveLength: (expected) =>
      check(
        (actual as { length?: unknown } | null)?.length === expected,
        "to have length",
        expected,
      ),
    toBeNull: () => check(actual === null, "to be null"),
    toBeUndefined: () => check(actual === undefined, "to be undefined"),
    toBeTruthy: () => check(Boolean(actual), "to be truthy"),
    toBeGreaterThan: (expected) =>
      check((actual as number) > expected, "to be greater than", expected),
    toBeGreaterThanOrEqual: (expected) =>
      check((actual as number) >= expected, "to be at least", expected),
  };
}

export function expect(actual: unknown): Matchers & { not: Matchers } {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}

/** An asymmetric matcher: any value of `type`. */
expect.any = (type: unknown): never => new AnyOf(type) as never;
