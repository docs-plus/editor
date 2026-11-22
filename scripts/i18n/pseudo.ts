/**
 * Builds the pseudo-locales from the English catalogs (languages design
 * §3.12): `bun run i18n:pseudo` writes `locales/pseudo/<locale>/<ns>.json`
 * (ignored by git; dev, CI and preview builds only, behind
 * `NEXT_PUBLIC_PSEUDO_LOCALES=1`).
 *
 * - `en-XA`: every letter accented, about 40 % longer, inside ⟦ ⟧. Chrome
 *   text without ⟦ ⟧ is a hard-coded string; clipped text is truncation.
 * - `ar-XB`: each text run reversed inside RLO…PDF, so it reads as English
 *   but lays out right to left and finds mirroring bugs.
 *
 * Only text runs change: placeholders, ICU syntax and tags stay intact.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type MessageNode, parseMessage } from "@/lib/i18n/format";
import {
  LOCALES_DIR,
  PSEUDO_DIR,
  readLocale,
  SOURCE_LOCALE_DIR,
  serializeCatalog,
} from "@/scripts/i18n/catalog";

export type PseudoLocale = "en-XA" | "ar-XB";

/** Text that would otherwise read as syntax, quoted ICU-style. */
function printText(text: string, inPlural: boolean): string {
  let out = "";
  let quoted = "";
  const special = (ch: string) =>
    ch === "{" || ch === "}" || (ch === "#" && inPlural);
  for (const ch of text) {
    if (special(ch)) {
      quoted += ch;
      continue;
    }
    if (quoted) {
      out += `'${quoted}'`;
      quoted = "";
    }
    out += ch === "'" ? "''" : ch;
  }
  return quoted ? `${out}'${quoted}'` : out;
}

/** Prints nodes back to ICU MessageFormat (the inverse of `parseMessage`). */
export function printMessage(
  nodes: readonly MessageNode[],
  inPlural = false,
): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return printText(node.value, inPlural);
        case "arg":
          return `{${node.name}}`;
        case "number":
          return node.style
            ? `{${node.name}, number, ${node.style}}`
            : `{${node.name}, number}`;
        case "date":
        case "time":
          return `{${node.name}, ${node.type}, ${node.style}}`;
        case "pound":
          return "#";
        case "tag":
          return `<${node.name}>${printMessage(node.children, inPlural)}</${node.name}>`;
        case "plural":
        case "select": {
          const nested = inPlural || node.type === "plural";
          const options = Object.entries(node.options)
            .map(([key, branch]) => `${key} {${printMessage(branch, nested)}}`)
            .join(" ");
          return `{${node.name}, ${node.type}, ${options}}`;
        }
        default:
          return node satisfies never;
      }
    })
    .join("");
}

const ACCENTS: Record<string, string> = Object.fromEntries([
  ..."abcdefghijklmnopqrstuvwxyz"
    .split("")
    .map((ch, i) => [ch, "àƀçđéƒĝĥíĵķļɱñöƥʠŕšţûṽŵẋýž"[i]]),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    .split("")
    .map((ch, i) => [ch, "ÀƁÇĐÉƑĜĤÍĴĶĻṀÑÖƤɊŔŠŢÛṼŴẊÝŽ"[i]]),
]);
const accent = (text: string) =>
  Array.from(text, (ch) => ACCENTS[ch] ?? ch).join("");
const FILLER = accent("one two three four five six seven eight nine ten ");

function mapText(
  nodes: readonly MessageNode[],
  change: (text: string) => string,
): MessageNode[] {
  return nodes.map((node) => {
    if (node.type === "text") return { ...node, value: change(node.value) };
    if (node.type === "tag") {
      return { ...node, children: mapText(node.children, change) };
    }
    if (node.type === "plural" || node.type === "select") {
      return {
        ...node,
        options: Object.fromEntries(
          Object.entries(node.options).map(([key, branch]) => [
            key,
            mapText(branch, change),
          ]),
        ),
      };
    }
    return node;
  });
}

/** One English message in a pseudo-locale. */
export function pseudoMessage(message: string, locale: PseudoLocale): string {
  const nodes = parseMessage(message);
  if (locale === "ar-XB") {
    return printMessage(
      mapText(
        nodes,
        (text) => `\u202E${Array.from(text).reverse().join("")}\u202C`,
      ),
    );
  }
  let length = 0;
  const accented = mapText(nodes, (text) => {
    length += text.length;
    return accent(text);
  });
  const pad = FILLER.repeat(Math.ceil(length / FILLER.length) + 1)
    .slice(0, Math.ceil(length * 0.4))
    .trimEnd();
  return `⟦${printMessage(accented)}${pad ? ` ${pad}` : ""}⟧`;
}

export const PSEUDO_LOCALE_IDS: readonly PseudoLocale[] = ["en-XA", "ar-XB"];

/** Writes every pseudo-locale catalog from `locales/en`. */
export function writePseudo(root: string): void {
  const english = readLocale(root, SOURCE_LOCALE_DIR);
  const base = join(root, LOCALES_DIR, PSEUDO_DIR);
  rmSync(base, { recursive: true, force: true });
  for (const locale of PSEUDO_LOCALE_IDS) {
    mkdirSync(join(base, locale), { recursive: true });
    for (const [ns, catalog] of english) {
      const out = Object.fromEntries(
        Object.entries(catalog).map(([key, message]) => [
          key,
          pseudoMessage(String(message), locale),
        ]),
      );
      writeFileSync(join(base, locale, `${ns}.json`), serializeCatalog(out));
    }
  }
}

if (import.meta.main) {
  writePseudo(join(import.meta.dir, "..", ".."));
  console.log(`locales/pseudo: ${PSEUDO_LOCALE_IDS.join(", ")}`);
}
