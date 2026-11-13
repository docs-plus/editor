import type { Node as PMNode } from "@tiptap/pm/model";

import type { ActionOption } from "@/lib/editor-actions/types";
import { MERMAID_LANGUAGE } from "@/lib/editor-context/snapshot";
import { type ChoiceSpec, readChoice } from "@/lib/remembered-choice";

/**
 * Allowed shape of a code block `language` attribute: one identifier-like
 * token (`ts`, `c++`, `c#`, `objective-c`, `vb.net`). Anything else could
 * smuggle extra class tokens into the rendered `<code>` element.
 */
export const SAFE_CODE_LANGUAGE = /^[A-Za-z0-9_+#.-]{1,40}$/;

/** Returns `value` when it is a safe language name, otherwise `null`. */
export function sanitizeCodeLanguage(value: unknown): string | null {
  return typeof value === "string" && SAFE_CODE_LANGUAGE.test(value)
    ? value
    : null;
}

/** Code block languages offered by the slot and menus (moved from
 * `lib/editor-actions/core/slot.ts`, contract §10 A6). */
export const CODE_LANGUAGES: readonly ActionOption<string>[] = [
  { value: "plaintext", label: "Plain text" },
  { value: "bash", label: "Bash" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "css", label: "CSS" },
  { value: "diff", label: "Diff" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "kotlin", label: "Kotlin" },
  { value: "markdown", label: "Markdown" },
  { value: "php", label: "PHP" },
  { value: "python", label: "Python" },
  { value: "ruby", label: "Ruby" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "swift", label: "Swift" },
  { value: "typescript", label: "TypeScript" },
  { value: "xml", label: "HTML / XML" },
  { value: "yaml", label: "YAML" },
  { value: MERMAID_LANGUAGE, label: "Mermaid diagram" },
];

const REMEMBERED_LANGUAGES: ReadonlySet<string> = new Set(
  CODE_LANGUAGES.map((option) => option.value).filter(
    (value) => value !== MERMAID_LANGUAGE,
  ),
);

/** M4 allowlist: a listed language, never Mermaid (a diagram, not code). */
export const isRememberedCodeLanguage = (value: unknown): value is string =>
  typeof value === "string" && REMEMBERED_LANGUAGES.has(value);

/** M4: your last code language; nothing remembered means plain. */
export const CODE_LANGUAGE_CHOICE: ChoiceSpec<string | null> = {
  slot: "codeLanguage",
  maxRecent: 0,
  validate: isRememberedCodeLanguage,
  fallback: null,
};

/**
 * The language most code blocks in `doc` use, Mermaid excluded; a tie goes
 * to the language seen first. One walk of the doc, so call it when a code
 * block is inserted, never per render or keystroke.
 */
export function mostUsedCodeLanguage(doc: PMNode): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  doc.descendants((node) => {
    if (node.type.name !== "codeBlock") return !node.isTextblock;
    const language = node.attrs.language;
    if (!isRememberedCodeLanguage(language)) return false;
    const count = (counts.get(language) ?? 0) + 1;
    counts.set(language, count);
    if (count > bestCount) {
      best = language;
      bestCount = count;
    }
    return false;
  });
  return best;
}

/** M4 (spec §5): the doc's most used language, else your last, else none. */
export function suggestedCodeLanguage(doc: PMNode): string | null {
  return mostUsedCodeLanguage(doc) ?? readChoice(CODE_LANGUAGE_CHOICE).last;
}
