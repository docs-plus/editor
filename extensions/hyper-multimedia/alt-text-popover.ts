/**
 * The image toolbar's "Alt text…" dialog (image store spec §7): one field,
 * saved on Enter or Save, closed on Escape. Inserts never prompt for alt
 * text, so pasting ten images never opens ten dialogs.
 *
 * A lazy chunk that imports nothing from the editor chunk (a shared module
 * would split the editor group): the media kit's popover helpers arrive as
 * `AltTextDeps` from `hyper-multimedia-kit.ts`.
 */
import type {
  closeToolbarPopover,
  MediaActionContext,
  openMediaPopover,
} from "@docs.plus/extension-hypermultimedia";

/** Short names: the editor chunk spells each key out. */
export interface AltTextDeps {
  open: typeof openMediaPopover;
  close: typeof closeToolbarPopover;
}

/** Material Symbols "check", drawn like the kit's own icons. */
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';

/** Where the image is now: a collaborator may have moved it since the toolbar opened. */
function imagePos(ctx: MediaActionContext): number {
  const { view } = ctx.editor;
  try {
    const pos = view.posAtDOM(ctx.wrapper, 0);
    for (const at of [pos, pos - 1]) {
      if (view.state.doc.nodeAt(at)?.type.name === "image") return at;
    }
  } catch {
    // The wrapper left the document.
  }
  return ctx.nodePos;
}

/** Sets `alt` on the image the toolbar was opened for, if it is still there. */
export function saveAltText(ctx: MediaActionContext, value: string): boolean {
  const { view } = ctx.editor;
  const pos = imagePos(ctx);
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name !== "image") return false;
  const alt = value.trim();
  if ((node.attrs.alt ?? "") === alt) return true;
  view.dispatch(view.state.tr.setNodeAttribute(pos, "alt", alt));
  return true;
}

export function createAltTextForm(
  ctx: MediaActionContext,
  deps: AltTextDeps,
): HTMLElement {
  const close = deps.close;
  const form = document.createElement("form");
  form.className = "media-toolbar__submenu";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "media-toolbar__input";
  // The toolbar's `ctx.attrs` is a snapshot from when it opened.
  input.value = String(
    ctx.editor.state.doc.nodeAt(imagePos(ctx))?.attrs.alt ?? "",
  );
  input.placeholder = "Describe this image";
  input.setAttribute("aria-label", "Alt text");
  input.maxLength = 1000;
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "media-toolbar__submenu-item";
  // Icon and label, as on the kit's Replace URL button.
  save.innerHTML = `${CHECK_ICON}<span>Save</span>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveAltText(ctx, input.value);
    close();
    ctx.editor.commands.focus();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
    ctx.editor.commands.focus();
  });
  form.append(input, save);
  return form;
}

export function openAltTextPopover(
  ctx: MediaActionContext,
  deps: AltTextDeps,
): void {
  ctx.close();
  const content = createAltTextForm(ctx, deps);
  deps.open({
    kind: "media-alt-text",
    content,
    trigger: ctx.wrapper,
    variant: "dialog",
    role: "dialog",
    ariaLabel: "Alt text",
    toggle: false,
  });
  const input = content.querySelector("input");
  input?.focus();
  input?.select();
}
