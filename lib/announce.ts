/**
 * Polite screen-reader announcements (WCAG 4.1.3) through one persistent,
 * visually hidden `role="status"` node, added to `body` on first use. Each
 * call clears the node, then sets the text a moment later, so a repeated
 * message is read again and a node created in this call is read at all.
 *
 * Every announcement is also the sighted status pill's notice (design
 * pass §5): `StatusPill` subscribes here, so the pill and the live region
 * always carry the same message. Import it from lazy surfaces only. A
 * no-op on the server.
 */
let region: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** A button on the pill, such as Undo or Retry. */
export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface NoticeOptions {
  /** The pill's text when it differs from the spoken message. */
  pill?: string;
  /** A confirmation (check icon); otherwise a reason or hint (info icon). */
  done?: boolean;
  /** Keeps the pill for 5 s instead of 2.5 s. */
  action?: NoticeAction;
}

export interface Notice extends NoticeOptions {
  /** New for every announcement, so a repeated message restarts the pill. */
  id: number;
  text: string;
}

let notice: Notice | null = null;
let lastId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function announce(message: string, options: NoticeOptions = {}): void {
  if (typeof document === "undefined") return;
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.className = "sr-only";
    document.body.append(region);
  }
  const node = region;
  node.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(() => {
    node.textContent = message;
  }, 100);
  lastId += 1;
  notice = { ...options, id: lastId, text: options.pill ?? message };
  emit();
}

/** The pill's current notice, or null. */
export const getNotice = (): Notice | null => notice;

/** Hides the pill; with `id`, only if that notice is still the one shown. */
export function dismissNotice(id?: number): void {
  if (!notice || (id !== undefined && notice.id !== id)) return;
  notice = null;
  emit();
}

export function subscribeNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
