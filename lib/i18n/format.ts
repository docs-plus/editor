/**
 * The ICU MessageFormat 1 subset (languages design §3.4), for lazy chunks
 * only: `{name}`, `plural` (`=n`, the CLDR categories and `#`), `select`,
 * `number` (`percent`, `compact`, `integer`), `date` / `time` (`short`,
 * `medium`, `long`, `full`) and rich tags (`<link>…</link>`).
 *
 * Not supported, and rejected by the parser: `selectordinal`, nested
 * plurals and `offset:`. The editor chunk never imports this module
 * (`tests/unit/i18n/editor-chunk-imports.test.ts`); `t-core.ts` covers
 * `{name}` alone, and `check.ts` keeps the `core` namespace to that.
 */
import { lookup, shouldIsolate, uiLocale } from "@/lib/i18n/t-core";

export class MessageSyntaxError extends Error {
  constructor(message: string, source: string) {
    super(`${message} in ${JSON.stringify(source)}`);
    this.name = "MessageSyntaxError";
  }
}

type NumberStyle = "percent" | "compact" | "integer";
type DateStyle = "short" | "medium" | "long" | "full";

export type MessageNode =
  | { type: "text"; value: string }
  | { type: "arg"; name: string }
  | { type: "number"; name: string; style: NumberStyle | null }
  | { type: "date" | "time"; name: string; style: DateStyle }
  | {
      type: "plural" | "select";
      name: string;
      options: Record<string, MessageNode[]>;
    }
  | { type: "pound" }
  | { type: "tag"; name: string; children: MessageNode[] };

const NUMBER_STYLES = new Set(["percent", "compact", "integer"]);
const DATE_STYLES = new Set(["short", "medium", "long", "full"]);
const PLURAL_CATEGORIES = new Set([
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
]);
const NAME = /[A-Za-z_][\w-]*/y;
const OPEN_TAG = /<([A-Za-z][\w-]*)>/y;
const CLOSE_TAG = /<\/([A-Za-z][\w-]*)>/y;

/** Parses a message into nodes. Throws {@link MessageSyntaxError}. */
export function parseMessage(source: string): MessageNode[] {
  let i = 0;
  const fail = (why: string): never => {
    throw new MessageSyntaxError(`${why} at ${i}`, source);
  };
  const skipSpace = () => {
    while (i < source.length && /\s/.test(source[i])) i++;
  };
  const sticky = (re: RegExp): RegExpExecArray | null => {
    re.lastIndex = i;
    const match = re.exec(source);
    if (match) i = re.lastIndex;
    return match;
  };
  const name = (): string => sticky(NAME)?.[0] ?? fail("expected a name");

  /** Reads nodes until `}` (inside an option), a closing tag, or the end. */
  const nodes = (inPlural: boolean, inOption: boolean, tag: string | null) => {
    const out: MessageNode[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push({ type: "text", value: text });
      text = "";
    };
    while (i < source.length) {
      const ch = source[i];
      // Tags start with "<", which no other branch reads, so matching here
      // (which moves `i` past the tag) is safe.
      const close = ch === "<" ? sticky(CLOSE_TAG) : null;
      const open = ch === "<" && !close ? sticky(OPEN_TAG) : null;
      if (ch === "'") {
        const next = source[i + 1];
        if (next === "'") {
          text += "'";
          i += 2;
        } else if (next === "{" || next === "}" || (next === "#" && inPlural)) {
          // A quoted literal runs to the next lone apostrophe.
          i++;
          while (i < source.length) {
            if (source[i] === "'" && source[i + 1] === "'") {
              text += "'";
              i += 2;
            } else if (source[i] === "'") {
              i++;
              break;
            } else text += source[i++];
          }
        } else {
          text += ch;
          i++;
        }
      } else if (ch === "{") {
        flush();
        i++;
        out.push(argument(inPlural));
      } else if (ch === "}") {
        if (!inOption) fail("unmatched }");
        flush();
        return out;
      } else if (ch === "#" && inPlural) {
        flush();
        out.push({ type: "pound" });
        i++;
      } else if (close) {
        if (close[1] !== tag) fail(`unexpected </${close[1]}>`);
        flush();
        return out;
      } else if (open) {
        flush();
        out.push({
          type: "tag",
          name: open[1],
          children: nodes(inPlural, false, open[1]),
        });
      } else {
        text += ch;
        i++;
      }
    }
    if (inOption) fail("unclosed {");
    if (tag) fail(`unclosed <${tag}>`);
    flush();
    return out;
  };

  const argument = (inPlural: boolean): MessageNode => {
    skipSpace();
    const argName = name();
    skipSpace();
    if (source[i] === "}") {
      i++;
      return { type: "arg", name: argName };
    }
    if (source[i] !== ",") fail("expected , or }");
    i++;
    skipSpace();
    const kind = name();
    skipSpace();
    if (kind === "number" || kind === "date" || kind === "time") {
      let style: string | null = null;
      if (source[i] === ",") {
        i++;
        skipSpace();
        style = name();
        skipSpace();
      }
      if (source[i] !== "}") fail("expected }");
      i++;
      if (kind === "number") {
        if (style !== null && !NUMBER_STYLES.has(style)) {
          fail(`unsupported number style ${style}`);
        }
        return {
          type: "number",
          name: argName,
          style: style as NumberStyle | null,
        };
      }
      if (style !== null && !DATE_STYLES.has(style)) {
        fail(`unsupported ${kind} style ${style}`);
      }
      return {
        type: kind,
        name: argName,
        style: (style ?? "medium") as DateStyle,
      };
    }
    if (kind !== "plural" && kind !== "select")
      fail(`unsupported type ${kind}`);
    if (kind === "plural" && inPlural) fail("nested plural");
    if (source[i] !== ",") fail("expected ,");
    i++;
    const options: Record<string, MessageNode[]> = {};
    for (;;) {
      skipSpace();
      if (source[i] === "}") {
        i++;
        break;
      }
      let key: string;
      if (source[i] === "=") {
        i++;
        key = `=${sticky(/\d+/y)?.[0] ?? fail("expected a number")}`;
        if (kind !== "plural") fail("=n outside plural");
      } else {
        key = name();
        if (key.startsWith("offset")) fail("offset is not supported");
        if (kind === "plural" && !PLURAL_CATEGORIES.has(key)) {
          fail(`unknown plural category ${key}`);
        }
      }
      skipSpace();
      if (source[i] !== "{") fail("expected {");
      i++;
      options[key] = nodes(inPlural || kind === "plural", true, null);
      i++; // the option's closing }
    }
    if (!options.other) fail(`${kind} needs an other option`);
    const type = kind === "plural" ? "plural" : "select";
    return { type, name: argName, options };
  };

  return nodes(false, false, null);
}

const parsed = new Map<string, MessageNode[]>();
function parseCached(message: string): MessageNode[] {
  let nodes = parsed.get(message);
  if (!nodes) {
    nodes = parseMessage(message);
    parsed.set(message, nodes);
  }
  return nodes;
}

const intlCache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let value = intlCache.get(key) as T | undefined;
  if (value === undefined) {
    value = make();
    intlCache.set(key, value);
  }
  return value;
}
const numberFormat = (locale: string, style: NumberStyle | null) =>
  cached(`n|${locale}|${style}`, () => {
    const options: Intl.NumberFormatOptions =
      style === "percent"
        ? { style: "percent" }
        : style === "compact"
          ? { notation: "compact" }
          : style === "integer"
            ? { maximumFractionDigits: 0 }
            : {};
    return new Intl.NumberFormat(locale, options);
  });
const dateFormat = (locale: string, kind: "date" | "time", style: DateStyle) =>
  cached(
    `${kind}|${locale}|${style}`,
    () =>
      new Intl.DateTimeFormat(
        locale,
        kind === "date" ? { dateStyle: style } : { timeStyle: style },
      ),
  );
const pluralRules = (locale: string) =>
  cached(`p|${locale}`, () => new Intl.PluralRules(locale));

export type MessageValues = Record<string, unknown>;
export interface FormatOptions {
  /** Wrap `{name}` values in FSI…PDI (U+2068…U+2069). */
  isolate?: boolean;
}

function render<T>(
  nodes: readonly MessageNode[],
  values: MessageValues,
  locale: string,
  options: FormatOptions,
  count: number | null,
  out: (string | T)[],
): void {
  const push = (part: string | T) => {
    const last = out.length - 1;
    if (typeof part === "string" && typeof out[last] === "string") {
      out[last] = (out[last] as string) + part;
    } else out.push(part);
  };
  // Own properties only, so `{toString}` or `<constructor>` in a message
  // never reaches Object.prototype. A missing value stays visible as
  // `{name}` (never "NaN" or today's date).
  const has = (name: string) => Object.hasOwn(values, name);
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        push(node.value);
        break;
      case "arg": {
        if (!has(node.name)) {
          push(`{${node.name}}`);
          break;
        }
        const text = String(values[node.name]);
        push(options.isolate ? `\u2068${text}\u2069` : text);
        break;
      }
      case "number":
        push(
          has(node.name)
            ? numberFormat(locale, node.style).format(Number(values[node.name]))
            : `{${node.name}}`,
        );
        break;
      case "date":
      case "time":
        push(
          has(node.name)
            ? dateFormat(locale, node.type, node.style).format(
                values[node.name] as Date | number,
              )
            : `{${node.name}}`,
        );
        break;
      case "pound":
        push(count === null ? "#" : numberFormat(locale, null).format(count));
        break;
      case "plural": {
        const n = has(node.name) ? Number(values[node.name]) : Number.NaN;
        const exact = node.options[`=${n}`];
        const branch =
          exact ??
          node.options[pluralRules(locale).select(n)] ??
          node.options.other;
        render(branch, values, locale, options, has(node.name) ? n : null, out);
        break;
      }
      case "select": {
        const key = String(values[node.name]);
        const branch = Object.hasOwn(node.options, key)
          ? node.options[key]
          : node.options.other;
        render(branch, values, locale, options, count, out);
        break;
      }
      case "tag": {
        const children: (string | T)[] = [];
        render(node.children, values, locale, options, count, children);
        const renderer = has(node.name) ? values[node.name] : undefined;
        if (typeof renderer !== "function") {
          for (const child of children) push(child);
          break;
        }
        const allText = children.every((child) => typeof child === "string");
        push(renderer(allText ? children.join("") : children) as T);
        break;
      }
    }
  }
}

/**
 * Formats a message into parts: strings, and whatever the tag renderers in
 * `values` return (React elements in components). Adjacent strings merge.
 */
export function formatMessageParts<T = unknown>(
  message: string,
  values: MessageValues,
  locale: string,
  options: FormatOptions = {},
): (string | T)[] {
  const out: (string | T)[] = [];
  render(parseCached(message), values, locale, options, null, out);
  return out;
}

/** Formats a message to plain text; tags keep only their text. */
export function formatMessage(
  message: string,
  values: MessageValues,
  locale: string,
  options: FormatOptions = {},
): string {
  return formatMessageParts<never>(
    message,
    Object.fromEntries(
      Object.entries(values).filter(([, v]) => typeof v !== "function"),
    ),
    locale,
    options,
  ).join("");
}

/**
 * The full-ICU `t()` for lazy chunks: the active catalog's message, else
 * the English source, formatted in the interface locale.
 *
 * A translation that fails to parse (a hand-edited catalog that skipped
 * `bun run i18n:check`) renders the English instead of throwing during a
 * React render. `parseCached` keeps only successes, so such a message is
 * parsed again on each call until it is fixed. English itself can't fail:
 * `check.ts` parses every English message.
 */
export function t(
  key: string,
  english: string,
  values: MessageValues = {},
): string {
  const options = { isolate: shouldIsolate() };
  const translated = lookup(key);
  if (translated !== undefined) {
    try {
      return formatMessage(translated, values, uiLocale(), options);
    } catch (error) {
      if (!(error instanceof MessageSyntaxError)) throw error;
      if (process.env.NODE_ENV === "development") {
        console.warn(`i18n: "${key}" is not valid ICU; showing English`);
      }
    }
  }
  return formatMessage(english, values, uiLocale(), options);
}

function walk(
  nodes: readonly MessageNode[],
  visit: (node: MessageNode) => void,
) {
  for (const node of nodes) {
    visit(node);
    if (node.type === "plural" || node.type === "select") {
      for (const branch of Object.values(node.options)) walk(branch, visit);
    } else if (node.type === "tag") walk(node.children, visit);
  }
}

/** Argument names in a message; tags are listed as `<name>`. */
export function messageArguments(message: string): Set<string> {
  const names = new Set<string>();
  walk(parseMessage(message), (node) => {
    if (node.type === "tag") names.add(`<${node.name}>`);
    else if ("name" in node) names.add(node.name);
  });
  return names;
}

/** Every plural in a message, with the CLDR categories (not `=n`) it lists. */
export function pluralCategoriesUsed(
  message: string,
): { name: string; categories: string[] }[] {
  const found: { name: string; categories: string[] }[] = [];
  walk(parseMessage(message), (node) => {
    if (node.type === "plural") {
      found.push({
        name: node.name,
        categories: Object.keys(node.options).filter(
          (key) => !key.startsWith("="),
        ),
      });
    }
  });
  return found;
}

/** Whether a message uses only text and `{name}` (what `t-core` formats). */
export function isSimpleMessage(message: string): boolean {
  let simple = true;
  walk(parseMessage(message), (node) => {
    if (node.type !== "text" && node.type !== "arg") simple = false;
  });
  return simple;
}
