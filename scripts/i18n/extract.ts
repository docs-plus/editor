/**
 * Writes the English catalogs (languages design §3.2, §3.11):
 * `bun run i18n:extract`.
 *
 * - **`t()` calls** in any source file that imports `t` from
 *   `@/lib/i18n/t-core` or `@/lib/i18n/format`. The key and the English
 *   must be string literals. A `// i18n: …` comment on the line before a
 *   call becomes a translator note.
 * - **The action registry** (`lib/editor-actions`): each action's label and
 *   search keywords, under `action.<id>.label` and `action.<id>.keywords`.
 *
 * Output: `locales/en/<ns>.json` and `locales/en/<ns>.notes.json`, sorted.
 * `check.ts` fails when the checked-in files differ from what this writes.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { parseMessage } from "@/lib/i18n/format";
import {
  LOCALES_DIR,
  type Namespace,
  NOTES_SUFFIX,
  namespaceOf,
  SOURCE_LOCALE_DIR,
  serializeCatalog,
} from "@/scripts/i18n/catalog";

/** Where `t()` calls may live. */
export const SOURCE_DIRS = [
  "app",
  "components",
  "desktop",
  "extensions",
  "hooks",
  "lib",
];
const SKIP = [/(^|\/)node_modules\//, /^lib\/i18n\//, /\.d\.ts$/];
const SOURCE = /\.(ts|tsx)$/;
const IMPORTS_T =
  /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["']@\/lib\/i18n\/(?:t-core|format)["']/;
const CALL = /(?<![\w.$])t\(/g;
const NOTE = /^\s*\/\/\s*i18n:\s*(.+?)\s*$/;

export interface ExtractableAction {
  readonly id: string;
  readonly label: string;
  readonly keywords?: readonly string[];
}

export interface Extraction {
  catalogs: Map<Namespace, Record<string, string>>;
  notes: Map<Namespace, Record<string, string>>;
  errors: string[];
}

/** Reads a string literal at `i` ("…", '…' or `…` without `${`). */
function readLiteral(
  src: string,
  i: number,
): { value: string; end: number } | null {
  const quote = src[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let j = i + 1;
  let value = "";
  while (j < src.length && src[j] !== quote) {
    const ch = src[j];
    if (ch === "\\") {
      const next = src[j + 1];
      const unicode = /^u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(
        src.slice(j + 1, j + 10),
      );
      if (unicode) {
        value += String.fromCodePoint(
          Number.parseInt(unicode[1] ?? unicode[2], 16),
        );
        j += 1 + unicode[0].length;
        continue;
      }
      value += ESCAPES[next] ?? next;
      j += 2;
    } else {
      if (quote === "`" && ch === "$" && src[j + 1] === "{") return null;
      if (quote !== "`" && ch === "\n") return null;
      value += ch;
      j++;
    }
  }
  return j < src.length ? { value, end: j + 1 } : null;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

const skipSpace = (src: string, i: number) => {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
};

/** The `(key, english)` literals of the call whose `(` ends at `i`. */
function readCall(
  src: string,
  i: number,
): { key: string; english: string } | null {
  const key = readLiteral(src, skipSpace(src, i));
  if (!key) return null;
  let j = skipSpace(src, key.end);
  if (src[j] !== ",") return null;
  const english = readLiteral(src, skipSpace(src, j + 1));
  if (!english) return null;
  j = skipSpace(src, english.end);
  if (src[j] !== "," && src[j] !== ")") return null;
  return { key: key.value, english: english.value };
}

function sourceFiles(root: string): string[] {
  return SOURCE_DIRS.filter((dir) => existsSync(join(root, dir)))
    .flatMap((dir) =>
      readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && SOURCE.test(entry.name))
        .map((entry) => relative(root, join(entry.parentPath, entry.name))),
    )
    .filter((file) => !SKIP.some((re) => re.test(file)))
    .sort();
}

export function extractMessages(
  root: string,
  { actions }: { actions: readonly ExtractableAction[] },
): Extraction {
  const catalogs = new Map<Namespace, Record<string, string>>();
  const notes = new Map<Namespace, Record<string, string>>();
  const errors: string[] = [];
  const where = new Map<string, string>();

  const add = (key: string, english: string, at: string, note?: string) => {
    const ns = namespaceOf(key);
    if (!ns) {
      errors.push(`${at}: key "${key}" must start with a namespace`);
      return;
    }
    try {
      parseMessage(english);
    } catch (error) {
      errors.push(`${at}: "${key}": ${(error as Error).message}`);
      return;
    }
    const catalog = catalogs.get(ns) ?? {};
    if (Object.hasOwn(catalog, key) && catalog[key] !== english) {
      errors.push(`${at}: "${key}" has different English at ${where.get(key)}`);
      return;
    }
    catalog[key] = english;
    catalogs.set(ns, catalog);
    where.set(key, at);
    if (note) notes.set(ns, { ...notes.get(ns), [key]: note });
  };

  for (const file of sourceFiles(root)) {
    const src = readFileSync(join(root, file), "utf8");
    if (!IMPORTS_T.test(src)) continue;
    const lines = src.split("\n");
    for (const match of src.matchAll(CALL)) {
      const start = match.index ?? 0;
      const line = src.slice(0, start).split("\n").length;
      const at = `${file}:${line}`;
      const call = readCall(src, start + match[0].length);
      if (!call) {
        errors.push(`${at}: t() needs a literal key and literal English text`);
        continue;
      }
      add(call.key, call.english, at, lines[line - 2]?.match(NOTE)?.[1]);
    }
  }

  for (const action of actions) {
    const at = `lib/editor-actions (${action.id})`;
    add(`action.${action.id}.label`, action.label, at);
    if (action.keywords?.some((word) => word.includes(","))) {
      errors.push(`${at}: a keyword contains a comma, the catalog separator`);
    } else if (action.keywords?.length) {
      add(`action.${action.id}.keywords`, action.keywords.join(", "), at);
    }
  }

  return { catalogs, notes, errors };
}

/** Writes `locales/en`, removing catalogs and notes no longer produced. */
export function writeExtraction(root: string, extraction: Extraction): void {
  const dir = join(root, LOCALES_DIR, SOURCE_LOCALE_DIR);
  mkdirSync(dir, { recursive: true });
  const wanted = new Set<string>();
  for (const [ns, catalog] of extraction.catalogs) {
    wanted.add(`${ns}.json`);
    writeFileSync(join(dir, `${ns}.json`), serializeCatalog(catalog));
  }
  for (const [ns, catalog] of extraction.notes) {
    wanted.add(`${ns}${NOTES_SUFFIX}`);
    writeFileSync(join(dir, `${ns}${NOTES_SUFFIX}`), serializeCatalog(catalog));
  }
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json") && !wanted.has(name)) rmSync(join(dir, name));
  }
}

/** The registry, loaded in Bun (it imports no DOM). */
export async function registryActions(): Promise<
  readonly (ExtractableAction & { readonly shortcut?: string })[]
> {
  const { editorActions } = await import("@/lib/editor-actions");
  return editorActions.list();
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..", "..");
  const extraction = extractMessages(root, {
    actions: await registryActions(),
  });
  if (extraction.errors.length) {
    console.error(extraction.errors.join("\n"));
    process.exit(1);
  }
  writeExtraction(root, extraction);
  const counts = [...extraction.catalogs]
    .map(([ns, catalog]) => `${ns} ${Object.keys(catalog).length}`)
    .join(", ");
  console.log(`locales/en: ${counts}`);
}
