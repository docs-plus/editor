/**
 * The image parse rules for `asset:` srcs (image store spec §6.2, U1 change
 * 2), shared by the editor kit (`hyper-multimedia-kit.ts`) and the headless
 * schema (P2.8a, `lib/headless/schema-extensions.ts`). No runtime imports,
 * no env, no DOM work at import.
 *
 * Apply it to the kit's `image` node without changing its attributes, so
 * the headless/editor schema parity test still holds:
 *
 *   image.extend({
 *     parseHTML() {
 *       return assetParseRules(this.parent?.() ?? [], () => true);
 *     },
 *   })
 */
import type { TagParseRule } from "@tiptap/pm/model";

/**
 * U1's `isHostSrc`: an `asset:<alg>-<digest>` src. Looser than
 * `parseAssetRef` (a malformed sha256 ref passes here and renders as "needs
 * a newer version"), so the editor chunk need not hold the full parser.
 */
export const isHostSrc = (src: unknown): src is string =>
  typeof src === "string" && /^asset:[a-z0-9]+-[\w-]+$/.test(src);

/**
 * The stock image rules (`figure[data-hm-figure]` and `img[src]`), plus
 * `asset:` srcs when `keep()` is true. Otherwise asset images are dropped,
 * as the stock kit drops them, and `onDropped` runs (the sandbox notice).
 * Data URLs stay governed by the stock rules.
 */
export function assetParseRules(
  rules: readonly TagParseRule[],
  keep: () => boolean,
  onDropped?: () => void,
): TagParseRule[] {
  return rules.map((rule) => ({
    ...rule,
    getAttrs: (element: HTMLElement) => {
      // The figure rule's `<img>`, or the `<img>` rule's own element.
      const img = element.querySelector("img") ?? element;
      if (!isHostSrc(img.getAttribute("src"))) {
        return rule.getAttrs?.(element) ?? {};
      }
      if (keep()) return {};
      onDropped?.();
      return false;
    },
  }));
}
