/**
 * Hand-written guards for the IPC contract (desktop architecture §7). They
 * run in main only, the one trust boundary: the worker trusts main and the
 * renderer trusts replies. A guard never throws and never coerces: it says
 * yes or no to a structured-clone value.
 *
 * `obj` refuses unknown keys, a missing required key, and anything that is
 * not a plain object (class instances, arrays, `Map`s). `bytes` takes only a
 * `Uint8Array` (what Electron's structured clone delivers for one).
 *
 * No runtime imports (desktop/shared rule, architecture §3.3).
 */

export type Guard<T> = ((value: unknown) => value is T) & {
  /** Set by {@link opt}: `obj` lets the key be absent or `undefined`. */
  readonly optional?: true;
};

export type Infer<G> = G extends Guard<infer T> ? T : never;

/** Wraps a test so that a hostile value (a throwing getter) is a "no". */
const guard = <T>(test: (value: unknown) => boolean): Guard<T> =>
  ((value: unknown) => {
    try {
      return test(value);
    } catch {
      return false;
    }
  }) as Guard<T>;

/** A string of at most `max` UTF-16 code units. */
export const str = (max: number): Guard<string> =>
  guard((value) => typeof value === "string" && value.length <= max);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A lowercase UUID, the only document id main accepts from a renderer. */
export const uuid: Guard<string> = guard(
  (value) => typeof value === "string" && UUID_PATTERN.test(value),
);

/** A safe integer in `[min, max]`. */
export const int = (
  min = 0,
  max: number = Number.MAX_SAFE_INTEGER,
): Guard<number> =>
  guard(
    (value) =>
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max,
  );

export const bool: Guard<boolean> = guard(
  (value) => typeof value === "boolean",
);

/** A `Uint8Array` of at most `max` bytes. */
export const bytes = (max: number): Guard<Uint8Array> =>
  guard((value) => value instanceof Uint8Array && value.byteLength <= max);

export const oneOf = <const T extends readonly string[]>(
  values: T,
): Guard<T[number]> => {
  const allowed = new Set<unknown>(values);
  return guard((value) => allowed.has(value));
};

export const opt = <T>(inner: Guard<T>): Guard<T | undefined> => {
  const wrapped = guard<T | undefined>(
    (value) => value === undefined || inner(value),
  );
  return Object.assign(wrapped, { optional: true as const });
};

/** `null` or `undefined`: a call with no arguments or no result. */
export const none: Guard<null | undefined> = guard(
  (value) => value === null || value === undefined,
);

/** An array of at most `max` items, each passing `item`. */
export const arr = <T>(item: Guard<T>, max: number): Guard<T[]> =>
  guard(
    (value) =>
      Array.isArray(value) &&
      value.length <= max &&
      value.every((entry) => item(entry)),
  );

type Shape = Record<string, Guard<unknown>>;

type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends { readonly optional: true } ? K : never;
}[keyof S];

export type ObjOf<S extends Shape> = {
  [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]>;
} & { [K in OptionalKeys<S>]?: Infer<S[K]> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A plain object with exactly the keys of `shape` (optional ones may be absent). */
export const obj = <S extends Shape>(shape: S): Guard<ObjOf<S>> => {
  const keys = Object.keys(shape);
  return guard((value) => {
    if (!isPlainObject(value)) return false;
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(shape, key)) return false;
    }
    for (const key of keys) {
      const check = shape[key];
      if (!Object.hasOwn(value, key)) {
        if (!check.optional) return false;
        continue;
      }
      if (!check(value[key])) return false;
    }
    return true;
  });
};
