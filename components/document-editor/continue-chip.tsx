"use client";

import type { Editor } from "@tiptap/core";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { ContinueNav } from "@/components/document-editor/continue-chip-loader";
import { Button } from "@/components/ui/button";
import { PLAYGROUND_ID } from "@/lib/constants";
import {
  CONTINUE_MIN_BLOCK,
  deleteContinueEntry,
  installContinueRecorder,
  readContinueEntry,
} from "@/lib/continue-position";
import { CloseIcon } from "@/lib/icons";

import "./continue-chip.scss";

/**
 * The lazy "Continue where you left off" chunk (spec M15). Imports nothing
 * from the editor chunk (see `ContinueNav`); `components/ui`, the icons and
 * `lib/constants` come with the app shell.
 */

export interface ContinueChipProps {
  editor: Editor;
  documentName: string;
  /** The server confirmed the document: only then is an offer made. */
  serverSynced: boolean;
  rejectedReason: string | null;
  nav: ContinueNav;
}

interface Offer {
  id: string;
  label: string;
}

const LABEL_MAX = 40;

const truncate = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length > LABEL_MAX
    ? `${trimmed.slice(0, LABEL_MAX - 1).trimEnd()}…`
    : trimmed;
};

/**
 * Keeps the phone chip 8px above the connection chip, whose height depends
 * on how its cards wrap.
 */
function placeAboveStatus(host: HTMLElement) {
  const status = document.querySelector("[data-collab-status]");
  const rect = status?.getBoundingClientRect();
  const bottom =
    rect && rect.height > 0 ? window.innerHeight - rect.top + 8 : 0;
  host.style.setProperty("--continue-chip-bottom", `${bottom}px`);
}

export function ContinueChip({
  editor,
  documentName,
  serverSynced,
  rejectedReason,
  nav,
}: ContinueChipProps) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const decided = useRef(false);
  const acted = useRef(false);
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => installContinueRecorder(editor, documentName, nav.isRemote),
    [editor, documentName, nav],
  );

  // The writer's first input anywhere in the document area (outside the
  // chip) means they chose where to be: no offer, or the offer goes. A
  // `click`, not `pointerdown`, so a touch scroll (no click) keeps it.
  // Transactions nobody typed (ids, repairs, seeding, a filter URL) never
  // count. Removed at that first input: no work per keystroke.
  useEffect(() => {
    const text = editor.view.dom;
    const area = text.closest("main") ?? text;
    const onInput = (event: Event) => {
      const target = event.target;
      if (target === area) return; // its scrollbar
      if (target instanceof Node && hostRef.current?.contains(target)) return;
      acted.current = true;
      setOffer(null);
      stop();
    };
    const stop = () => {
      area.removeEventListener("click", onInput, true);
      text.removeEventListener("keydown", onInput);
      text.removeEventListener("beforeinput", onInput);
    };
    area.addEventListener("click", onInput, true);
    text.addEventListener("keydown", onInput);
    text.addEventListener("beforeinput", onInput);
    return stop;
  }, [editor]);

  useEffect(() => {
    if (!serverSynced || decided.current) return;
    decided.current = true;
    if (acted.current || documentName === PLAYGROUND_ID) return;
    const entry = readContinueEntry(documentName);
    if (!entry) return;
    const { state } = editor;
    const anchor = nav.find(state.doc, entry.id);
    if (!anchor) return;
    if (state.doc.resolve(anchor.pos).index(0) < CONTINUE_MIN_BLOCK) return;
    if (nav.isFilteredOut(state, entry.id)) return;
    setOffer({ id: entry.id, label: truncate(anchor.node.textContent) });
  }, [serverSynced, documentName, editor, nav]);

  useEffect(() => {
    if (rejectedReason !== "document_deleted") return;
    deleteContinueEntry(documentName);
    setOffer(null);
  }, [rejectedReason, documentName]);

  const shown = offer !== null;
  useEffect(() => {
    if (!shown) return;
    const element = document.createElement("div");
    element.className = "continue-chip-host";
    editor.view.dom.before(element);
    hostRef.current = element;
    setHost(element);
    const place = () => placeAboveStatus(element);
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      element.remove();
      hostRef.current = null;
      setHost(null);
    };
  }, [shown, editor]);

  if (!offer || !host) return null;

  // Focus goes back to the text, except for a tap: on a touch screen
  // that would raise the keyboard for nothing.
  const close = (focusText: boolean) => {
    if (focusText) editor.view.focus();
    setOffer(null);
  };
  const go = () => {
    nav.goTo(editor, offer.id, "start");
    close(true);
  };
  const dismiss = (event: ReactMouseEvent) =>
    close(event.detail === 0 || !matchMedia("(pointer: coarse)").matches);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close(true);
  };

  return createPortal(
    // Never focused for the writer and never announced (an offer, not
    // news): it waits in the Tab order after the toolbar.
    <div
      role="group"
      aria-label="Continue where you left off"
      data-continue-chip=""
      onKeyDown={onKeyDown}
      className="flex items-center gap-2 rounded-lg border border-border bg-popover py-1 pr-1 pl-3 text-sm text-popover-foreground shadow-md animate-in fade-in-0 duration-150 motion-reduce:animate-none pointer-coarse:py-0.5 forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
    >
      {/* Phones keep "Continue ·" so the section name, the part that
          matters, gets the room; only the name truncates. */}
      <span className="flex min-w-0 flex-1 whitespace-pre">
        <span className="shrink-0">
          Continue
          <span className="continue-chip-long"> where you left off</span> ·{" "}
        </span>
        <bdi className="min-w-0 truncate font-medium">{offer.label}</bdi>
      </span>
      <Button
        type="button"
        size="xs"
        variant="secondary"
        aria-label={`Go to ${offer.label}`}
        className="pointer-coarse:h-11 pointer-coarse:px-4"
        onClick={go}
      >
        Go
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Dismiss"
        className="pointer-coarse:size-11 pointer-coarse:[&_svg]:size-4"
        onClick={dismiss}
      >
        <CloseIcon aria-hidden="true" />
      </Button>
    </div>,
    host,
  );
}
