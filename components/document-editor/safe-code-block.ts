import { mergeAttributes } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import type { Plugin } from "@tiptap/pm/state";

import { createIncrementalLowlightPlugin } from "./incremental-lowlight";

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

/** The stock lowlight plugin, recognised by its plugin key (`lowlight$`). */
function isStockLowlightPlugin(plugin: Plugin): boolean {
  return (plugin as unknown as { key: string }).key.startsWith("lowlight$");
}

/**
 * Markdown fence info strings may carry metadata after the language
 * (```` ```ts title="a.ts" ````); only the first word names the language.
 */
function languageFromInfoString(info: unknown): string | null {
  if (typeof info !== "string") return null;
  return sanitizeCodeLanguage(info.trim().split(/\s+/, 1)[0]);
}

/**
 * Code block whose `language` attribute can never reach the DOM unchecked.
 *
 * The attribute is collaborator-controlled (Yjs sync, HTML/Markdown paste,
 * VS Code paste) and upstream `CodeBlock.renderHTML` concatenates it into
 * the `<code>` class, so a value like `x fixed inset-0 z-50` injects utility
 * classes. Rendering is the trust boundary: an unsafe value renders with no
 * class at all. Parsing and Markdown export apply the same gate. Lowlight
 * decorations only emit `hljs-*` classes from the highlighter, never the
 * language itself, so they need no change.
 */
export const SafeCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      language: {
        default: sanitizeCodeLanguage(this.options.defaultLanguage),
        parseHTML: (element: HTMLElement) => {
          const { languageClassPrefix } = this.options;
          if (!languageClassPrefix) return null;
          const className = Array.from(
            element.firstElementChild?.classList ?? [],
          ).find((name) => name.startsWith(languageClassPrefix));
          return sanitizeCodeLanguage(
            className?.slice(languageClassPrefix.length),
          );
        },
        rendered: false,
      },
    };
  },

  // Same decorations as the stock lowlight plugin, re-highlighting only the
  // code blocks a change touches (see incremental-lowlight.ts); the other
  // code block plugins stay.
  addProseMirrorPlugins() {
    const { lowlight, defaultLanguage } = this.options;
    return [
      ...(this.parent?.() ?? []).filter(
        (plugin) => !isStockLowlightPlugin(plugin),
      ),
      createIncrementalLowlightPlugin({
        name: this.name,
        lowlight,
        defaultLanguage,
      }),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = sanitizeCodeLanguage(node.attrs.language);
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      [
        "code",
        {
          class: language ? this.options.languageClassPrefix + language : null,
        },
        0,
      ],
    ];
  },

  parseMarkdown(token, helpers) {
    return (
      this.parent?.(
        { ...token, lang: languageFromInfoString(token.lang) },
        helpers,
      ) ?? []
    );
  },

  renderMarkdown(node, helpers, context) {
    const language = sanitizeCodeLanguage(node.attrs?.language);
    return (
      this.parent?.(
        { ...node, attrs: { ...node.attrs, language } },
        helpers,
        context,
      ) ?? ""
    );
  },
});
