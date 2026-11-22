/**
 * Pseudo-locales (languages design §3.12): `en-XA` is accented, expanded
 * about 40 % and bracketed ⟦ ⟧; `ar-XB` reverses each text run and forces
 * it right to left. Placeholders, ICU syntax and tags survive untouched.
 */
import { describe, expect, it } from "bun:test";

import {
  formatMessage,
  messageArguments,
  parseMessage,
} from "@/lib/i18n/format";
import { printMessage, pseudoMessage } from "@/scripts/i18n/pseudo";

const RLO = "\u202E";
const PDF = "\u202C";

describe("printMessage", () => {
  const round = [
    "Trash is empty",
    "Moved “{title}” to {folder}",
    "{count, plural, =0 {No documents} one {# document} other {# documents}}",
    "{platform, select, mac {New Document} other {New document}}",
    "{n, number, percent} at {when, date, medium} {at, time}",
    "Read <link>the backup guide</link>",
    "it''s a '{literal}' {n, plural, other {'#' #}}",
  ];
  for (const message of round) {
    it(`round-trips ${message}`, () => {
      expect(parseMessage(printMessage(parseMessage(message)))).toEqual(
        parseMessage(message),
      );
    });
  }
});

describe("en-XA", () => {
  it("accents, expands and brackets the text", () => {
    const out = pseudoMessage("Trash is empty", "en-XA");
    expect(out.startsWith("⟦")).toBe(true);
    expect(out.endsWith("⟧")).toBe(true);
    expect(out).not.toMatch(/[A-Za-z]/);
    expect(out.length).toBeGreaterThanOrEqual(
      Math.round("Trash is empty".length * 1.4),
    );
  });

  it("keeps placeholders, plural syntax and tags", () => {
    const message =
      "<link>{count, plural, one {# file} other {# files}}</link> in {folder}";
    const out = pseudoMessage(message, "en-XA");
    expect(messageArguments(out)).toEqual(messageArguments(message));
    const text = formatMessage(out, { count: 2, folder: "Work" }, "en");
    expect(text).toContain("2");
    expect(text).toContain("Work");
  });
});

describe("ar-XB", () => {
  it("reverses each text run inside RLO…PDF", () => {
    expect(pseudoMessage("Bold", "ar-XB")).toBe(`${RLO}dloB${PDF}`);
  });

  it("leaves values outside the override", () => {
    const out = pseudoMessage("Hi {name}!", "ar-XB");
    expect(formatMessage(out, { name: "Ana" }, "en")).toBe(
      `${RLO} iH${PDF}Ana${RLO}!${PDF}`,
    );
  });
});
