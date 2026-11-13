/**
 * The formatting bundle (spec §5, M7/M12/M14): what Repeat formatting,
 * Copy formatting, Your formats and "In this doc" hold. Tokens and mark
 * names only, never free text or CSS, so a tampered stored bundle can
 * never write an unknown value into the document.
 *
 * A missing key leaves that class of formatting untouched, `false` / `null`
 * clears it, `true` / a token sets it.
 */
import type { Mark } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { highlightTokenFromValue } from "@/lib/highlight-tokens";
import {
  type FontSizeToken,
  type HighlightToken,
  isFontSizeToken,
  isTextColorToken,
  type TextColorToken,
} from "@/lib/text-style-tokens";

export interface FormatBundle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  textColor?: TextColorToken | null;
  highlight?: HighlightToken | null;
  fontSize?: FontSizeToken | null;
}

export type BundleField = keyof FormatBundle;

/** Canonical field order (keys, faces, labels). */
export const BUNDLE_FIELDS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "textColor",
  "highlight",
  "fontSize",
] as const satisfies readonly BundleField[];

export const BOOLEAN_FIELDS = [
  "bold",
  "italic",
  "underline",
  "strike",
] as const;
export type BooleanField = (typeof BOOLEAN_FIELDS)[number];
export type TokenField = "textColor" | "highlight" | "fontSize";

/** Schema mark name per field, and the attribute holding the token. */
export const FIELD_MARK: Readonly<Record<BundleField, string>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  textColor: "textColor",
  highlight: "highlight",
  fontSize: "fontSize",
};
export const TOKEN_ATTR: Readonly<Record<TokenField, string>> = {
  textColor: "color",
  highlight: "color",
  fontSize: "size",
};

const isBooleanField = (field: BundleField): field is BooleanField =>
  (BOOLEAN_FIELDS as readonly string[]).includes(field);

const isHighlightToken = (value: unknown): value is HighlightToken =>
  typeof value === "string" && highlightTokenFromValue(value) === value;

const TOKEN_GUARD: Record<TokenField, (value: unknown) => boolean> = {
  textColor: isTextColorToken,
  highlight: isHighlightToken,
  fontSize: isFontSizeToken,
};

/** Field name for a schema mark name, or null for marks a bundle ignores. */
export function fieldOfMark(markName: string): BundleField | null {
  for (const field of BUNDLE_FIELDS) {
    if (FIELD_MARK[field] === markName) return field;
  }
  return null;
}

/** Token carried by a mark, validated; null when unknown. */
export function tokenOfMark(field: TokenField, mark: Mark): string | null {
  const raw = mark.attrs[TOKEN_ATTR[field]];
  const value = field === "highlight" ? highlightTokenFromValue(raw) : raw;
  return TOKEN_GUARD[field](value) ? (value as string) : null;
}

/**
 * Allowlist validator for anything read from storage or a palette argument.
 * Unknown keys and invalid values are dropped; null when nothing valid is
 * left.
 */
export function validateBundle(value: unknown): FormatBundle | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, boolean | string | null> = {};
  for (const field of BUNDLE_FIELDS) {
    if (!Object.hasOwn(source, field)) continue;
    const raw = source[field];
    if (isBooleanField(field)) {
      if (typeof raw === "boolean") out[field] = raw;
    } else if (raw === null || TOKEN_GUARD[field](raw)) {
      out[field] = raw as string | null;
    }
  }
  return Object.keys(out).length > 0 ? (out as FormatBundle) : null;
}

/** Type guard form for `ChoiceSpec.validate`: only a fully valid bundle. */
export function isFormatBundle(value: unknown): value is FormatBundle {
  const valid = validateBundle(value);
  return (
    valid !== null &&
    Object.keys(valid).length === Object.keys(value as object).length
  );
}

export function isEmptyBundle(bundle: FormatBundle): boolean {
  return BUNDLE_FIELDS.every((field) => bundle[field] === undefined);
}

/** Only the fields a bundle sets (`true` / a token). */
export function setEntries(bundle: FormatBundle): FormatBundle {
  const out: FormatBundle = {};
  for (const field of BUNDLE_FIELDS) {
    const value = bundle[field];
    if (value === true || typeof value === "string") {
      (out as Record<string, unknown>)[field] = value;
    }
  }
  return out;
}

/** Canonical, order-stable key: `"bold:1|textColor:red|italic:0"`. */
export function bundleKey(bundle: FormatBundle): string {
  const parts: string[] = [];
  for (const field of BUNDLE_FIELDS) {
    const value = bundle[field];
    if (value === undefined) continue;
    if (typeof value === "boolean") parts.push(`${field}:${value ? 1 : 0}`);
    else parts.push(`${field}:${value ?? "-"}`);
  }
  return parts.join("|");
}

/** Inverse of `bundleKey`, validated; null for anything malformed. */
export function bundleFromKey(key: string): FormatBundle | null {
  if (typeof key !== "string" || key.length === 0 || key.length > 200) {
    return null;
  }
  const raw: Record<string, unknown> = {};
  for (const part of key.split("|")) {
    const [field, value, extra] = part.split(":");
    if (!field || value === undefined || extra !== undefined) return null;
    if (!(BUNDLE_FIELDS as readonly string[]).includes(field)) return null;
    if (isBooleanField(field as BundleField)) {
      if (value !== "1" && value !== "0") return null;
      raw[field] = value === "1";
    } else {
      raw[field] = value === "-" ? null : value;
    }
  }
  const bundle = validateBundle(raw);
  return bundle && isFormatBundle(raw) ? bundle : null;
}

const capitalize = (token: string) =>
  token.charAt(0).toUpperCase() + token.slice(1);

const SIZE_FACE: Readonly<Record<FontSizeToken, string>> = {
  xs: "XS",
  sm: "S",
  lg: "L",
  xl: "XL",
};
const SIZE_LABEL: Readonly<Record<FontSizeToken, string>> = {
  xs: "Extra small",
  sm: "Small",
  lg: "Large",
  xl: "Extra large",
};
const BOOLEAN_FACE: Readonly<Record<BooleanField, string>> = {
  bold: "B",
  italic: "I",
  underline: "U",
  strike: "S",
};
const BOOLEAN_LABEL: Readonly<Record<BooleanField, string>> = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strike: "Strikethrough",
};
const CLEAR_LABEL: Readonly<Record<BundleField, string>> = {
  bold: "no bold",
  italic: "no italic",
  underline: "no underline",
  strike: "no strikethrough",
  textColor: "no text colour",
  highlight: "no highlight",
  fontSize: "default size",
};

/** Short visible form: `"B · Red · L"`; `"Plain"` when nothing is set. */
export function bundleFace(bundle: FormatBundle): string {
  const parts: string[] = [];
  for (const field of BOOLEAN_FIELDS) {
    if (bundle[field] === true) parts.push(BOOLEAN_FACE[field]);
  }
  if (bundle.textColor) parts.push(capitalize(bundle.textColor));
  if (bundle.highlight) parts.push(`${capitalize(bundle.highlight)} highlight`);
  if (bundle.fontSize) parts.push(SIZE_FACE[bundle.fontSize]);
  return parts.length > 0 ? parts.join(" · ") : "Plain";
}

/** Accessible form: `"Bold, Yellow highlight, default size"`. */
export function bundleLabel(bundle: FormatBundle): string {
  const parts: string[] = [];
  for (const field of BUNDLE_FIELDS) {
    const value = bundle[field];
    if (value === undefined) continue;
    if (value === false || value === null) {
      parts.push(CLEAR_LABEL[field]);
    } else if (isBooleanField(field)) {
      parts.push(BOOLEAN_LABEL[field]);
    } else if (field === "textColor") {
      parts.push(`${capitalize(value as string)} text`);
    } else if (field === "highlight") {
      parts.push(`${capitalize(value as string)} highlight`);
    } else {
      parts.push(SIZE_LABEL[value as FontSizeToken]);
    }
  }
  return parts.length > 0 ? parts.join(", ") : "Plain";
}

/** Every field from a set of marks: a missing mark gives `false` / `null`. */
export function bundleOfMarks(marks: readonly Mark[]): Required<FormatBundle> {
  const out: Required<FormatBundle> = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    textColor: null,
    highlight: null,
    fontSize: null,
  };
  for (const mark of marks) {
    const field = fieldOfMark(mark.type.name);
    if (!field) continue;
    if (isBooleanField(field)) out[field] = true;
    else {
      (out as Record<string, unknown>)[field] = tokenOfMark(field, mark);
    }
  }
  return out;
}

/**
 * The formatting at the selection (Copy formatting's source): the marks of
 * the first text node inside the selection, or the stored / caret marks of
 * an empty selection.
 */
export function readBundleAt(state: EditorState): Required<FormatBundle> {
  const { selection, doc } = state;
  if (selection.empty) {
    return bundleOfMarks(state.storedMarks ?? selection.$from.marks());
  }
  let marks: readonly Mark[] | null = null;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (marks) return false;
    if (node.isText) {
      marks = node.marks;
      return false;
    }
    return true;
  });
  return bundleOfMarks(marks ?? selection.$from.marks());
}
