/**
 * Download and Copy for `asset:` images (image store spec §5.4, U1 change
 * 3): they act on the bytes the `<img>` shows, never on the ref, which means
 * nothing outside this device. A lazy chunk.
 *
 * - Download saves `image.<ext>`, typed by the bytes.
 * - Copy puts the bytes on the clipboard as PNG, so pasting anywhere
 *   (another app, the public sandbox, a library document) pastes the
 *   picture.
 *
 * `imageActions` builds the image toolbar from the kit's defaults: these
 * two, and Alt text… (spec §7).
 *
 * It imports nothing from the editor chunk: a shared module would split the
 * editor group.
 */
import type {
  MediaAction,
  MediaActionContext,
  MediaActionList,
} from "@docs.plus/extension-hypermultimedia";

import type { parseAssetRef } from "@/lib/assets/asset-ref";

import { type AltTextDeps, openAltTextPopover } from "./alt-text-popover";

/** `imageActions`' editor-chunk values, passed in like the view's. */
export type ImageActionDeps = AltTextDeps & { parse: typeof parseAssetRef };

/** How long a download's object URL outlives the click. */
export const DOWNLOAD_URL_LIFETIME_MS = 1000;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The bytes the toolbar's image shows, or `null` before it has resolved. */
export async function resolvedImageBlob(
  ctx: MediaActionContext,
): Promise<Blob | null> {
  const img = ctx.wrapper.querySelector("img");
  const url = img?.currentSrc || img?.getAttribute("src");
  if (!url) return null;
  try {
    const response = await fetch(url);
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

export async function downloadAsset(ctx: MediaActionContext): Promise<void> {
  const blob = await resolvedImageBlob(ctx);
  ctx.close();
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `image.${EXTENSIONS[blob.type] ?? "img"}`;
  document.body.append(link);
  link.click();
  link.remove();
  // The download starts after this task; revoking at once can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
}

/** Clipboards take PNG everywhere; other types are redrawn as PNG. */
async function asPng(blob: Blob): Promise<Blob | null> {
  if (blob.type === "image/png") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch {
    return null;
  }
}

/** An `<img>` the image's `parseHTML` reads back: ref, alt and size. */
export function imageHtml(attrs: Record<string, unknown>): string {
  const img = document.createElement("img");
  for (const name of ["src", "alt", "width", "height"]) {
    const value = attrs[name];
    if (value !== null && value !== undefined && value !== "") {
      img.setAttribute(name, String(value));
    }
  }
  return img.outerHTML;
}

/**
 * Puts the image's bytes on the clipboard as PNG. With `html`, also an
 * `<img>` with the `asset:` ref, which pastes as the same image inside a
 * library document but as a broken image anywhere else (Gmail, Docs, Slack,
 * the public sandbox prefer HTML to the picture), so it is off by default.
 */
export async function copyAsset(
  ctx: MediaActionContext,
  { html = false }: { html?: boolean } = {},
): Promise<void> {
  const blob = await resolvedImageBlob(ctx);
  const png = blob ? await asPng(blob) : null;
  ctx.close();
  if (!png || typeof ClipboardItem === "undefined") return;
  const items: Record<string, Blob> = { "image/png": png };
  if (html) {
    items["text/html"] = new Blob([imageHtml(ctx.attrs)], {
      type: "text/html",
    });
  }
  await navigator.clipboard?.write([new ClipboardItem(items)]).catch(() => {});
}

/** Material Symbols "notes" (lines of text), drawn like the kit's own icons. */
const ALT_TEXT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M160-280v-80h400v80H160Zm0-160v-80h640v80H160Zm0-160v-80h640v80H160Z"/></svg>';

/**
 * The image toolbar: Alt text… first in the overflow menu (before Replace
 * URL), and Download and Copy on the bytes for `asset:` images.
 */
export function imageActions(
  defaults: MediaActionList,
  { nodeType }: { nodeType: string },
  deps: ImageActionDeps,
): MediaActionList {
  if (nodeType !== "image") return defaults;
  const altText: MediaAction = {
    id: "alt-text",
    label: () => "Alt text…",
    icon: () => ALT_TEXT_ICON,
    placement: "overflow",
    run: (ctx) => openAltTextPopover(ctx, deps),
  };
  return defaults.flatMap((action) => {
    if (action.id === "replace") return [altText, action];
    const forAsset =
      action.id === "download"
        ? downloadAsset
        : action.id === "copy"
          ? (actionCtx: MediaActionContext) => copyAsset(actionCtx)
          : null;
    if (!forAsset) return [action];
    const run = (ctx: MediaActionContext) =>
      deps.parse(ctx.attrs.src) ? void forAsset(ctx) : action.run?.(ctx);
    return [{ ...action, run }];
  });
}
