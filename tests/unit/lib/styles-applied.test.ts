import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { stylesApplied } from "@/lib/styles-applied";

/** A stand-in for a `CSSStyleSheet`: only its identity matters. */
const fakeSheet = () => ({}) as CSSStyleSheet;

describe("stylesApplied", () => {
  const original = Object.getOwnPropertyDescriptor(document, "styleSheets");
  let active: CSSStyleSheet[];
  let links: HTMLLinkElement[];

  /** A `<link rel=stylesheet>` whose `sheet` is `sheet` (null: loading or failed). */
  function addLink(sheet: CSSStyleSheet | null) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    Object.defineProperty(link, "sheet", {
      configurable: true,
      writable: true,
      value: sheet,
    });
    document.head.append(link);
    links.push(link);
    return link;
  }

  /** Settles once `promise` has, or after `ms`; true when it had. */
  const settlesWithin = (promise: Promise<void>, ms: number) =>
    Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);

  beforeEach(() => {
    active = [];
    links = [];
    // WebKit lists only the sheets that apply here.
    Object.defineProperty(document, "styleSheets", {
      configurable: true,
      get: () => active,
    });
  });

  afterEach(() => {
    for (const link of links) link.remove();
    if (original) Object.defineProperty(document, "styleSheets", original);
    else delete (document as { styleSheets?: unknown }).styleSheets;
  });

  it("resolves at once when every loaded sheet applies", async () => {
    const sheet = fakeSheet();
    addLink(sheet);
    active.push(sheet);
    expect(await settlesWithin(stylesApplied(10_000), 0)).toBe(true);
  });

  it("never waits for a sheet still loading, or one that failed", async () => {
    addLink(null);
    expect(await settlesWithin(stylesApplied(10_000), 0)).toBe(true);
  });

  it("waits while a loaded sheet does not apply yet", async () => {
    const sheet = fakeSheet();
    addLink(sheet);
    const applied = stylesApplied(10_000);
    expect(await settlesWithin(applied, 50)).toBe(false);
    active.push(sheet);
    expect(await settlesWithin(applied, 1_000)).toBe(true);
  });

  it("gives up after its timeout", async () => {
    addLink(fakeSheet());
    const applied = stylesApplied(60);
    expect(await settlesWithin(applied, 20)).toBe(false);
    expect(await settlesWithin(applied, 1_000)).toBe(true);
  });
});
