"use client";

import type { Editor } from "@tiptap/core";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { type FindCommand, isMacPlatform } from "@/components/find/find-keys";
import { Button } from "@/components/ui/button";
import {
  FindController,
  type FindSnapshot,
  MAX_REPLACEMENT_LENGTH,
  type ReplaceAllResult,
} from "@/extensions/find/find-controller";
import {
  FIND_CURRENT_HIGHLIGHT,
  FIND_HIGHLIGHT,
} from "@/extensions/find/find-painter";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaseSensitiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  WholeWordIcon,
} from "@/lib/icons";
import { cn } from "@/lib/utils";

/** A key press or menu pick for the bar; `seq` makes each one new. */
export interface FindRequest {
  command: FindCommand;
  seq: number;
  /** This request opened the bar. */
  opened: boolean;
}

/** What the bar remembers between openings (until the page reloads). */
export interface FindMemory {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface FindBarProps {
  editor: Editor;
  request: FindRequest;
  memory: FindMemory;
  onClose: () => void;
}

/** Quiet time after a keystroke in the find field before it searches. */
const SEARCH_DELAY_MS = 60;
/** The longest selection that seeds the find field when the bar opens. */
const SEED_MAX_CHARS = 100;
const DESKTOP_QUERY = "(min-width: 768px)";

const NO_SNAPSHOT: FindSnapshot = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  total: 0,
  capped: false,
  current: -1,
};
const noSubscribe = () => () => {};
const noSnapshot = () => NO_SNAPSHOT;

/**
 * Hit colours. Painted by the browser over the text (`::highlight`), so
 * the editor's DOM never changes. The current hit sits on top (priority 1).
 */
const HIGHLIGHT_CSS = `
::highlight(${FIND_HIGHLIGHT}){background-color:rgb(253 224 71/.55)}
::highlight(${FIND_CURRENT_HIGHLIGHT}){background-color:rgb(251 146 60/.8)}
.dark ::highlight(${FIND_HIGHLIGHT}){background-color:rgb(202 138 4/.45)}
.dark ::highlight(${FIND_CURRENT_HIGHLIGHT}){background-color:rgb(234 88 12/.75)}
@media (forced-colors:active){
::highlight(${FIND_HIGHLIGHT}){background-color:Mark;color:MarkText}
::highlight(${FIND_CURRENT_HIGHLIGHT}){background-color:Highlight;color:HighlightText}
}`;

/** The selection's text when it is short and inside one block, else "". */
function selectionSeed(editor: Editor): string {
  const { from, to, $from } = editor.state.selection;
  if (from === to || !$from.sameParent(editor.state.selection.$to)) return "";
  const text = editor.state.doc.textBetween(from, to);
  return text.length <= SEED_MAX_CHARS ? text : "";
}

/**
 * Where the bar sits: under the sticky toolbar at the top right of the
 * editor's scroll container on desktop, and full width above the phone
 * bar and keyboard on phones. The container's `scroll-padding` already
 * holds those clearances (`document-editor.scss`).
 */
function barPosition(editor: Editor): CSSProperties {
  let container: HTMLElement | null = editor.view.dom.parentElement;
  while (
    container &&
    !/(auto|scroll)/.test(getComputedStyle(container).overflowY)
  ) {
    container = container.parentElement;
  }
  const box = container?.getBoundingClientRect() ?? {
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  const style = container ? getComputedStyle(container) : null;
  const padTop = Number.parseFloat(style?.scrollPaddingTop ?? "") || 0;
  const padBottom = Number.parseFloat(style?.scrollPaddingBottom ?? "") || 0;
  if (!window.matchMedia(DESKTOP_QUERY).matches) {
    return {
      left: 8,
      right: 8,
      bottom: window.innerHeight - box.bottom + padBottom + 8,
    };
  }
  // Below the heading filter's card when it is open (same corner).
  const filter = container?.querySelector('[role="search"]');
  const top = filter
    ? filter.getBoundingClientRect().bottom + 8
    : box.top + padTop + 8;
  return { top, right: window.innerWidth - box.right + 16 };
}

const formatCount = (n: number) => n.toLocaleString();

/** Shown when Replace all would grow the document past its limit. */
const TOO_LARGE_NOTICE = "Too large to replace";

function replaceAllNotice(result: ReplaceAllResult): string {
  if ("refused" in result) return TOO_LARGE_NOTICE;
  return result.replaced === 0
    ? ""
    : `Replaced ${formatCount(result.replaced)}`;
}

function countLabel(snapshot: FindSnapshot): string {
  if (!snapshot.query) return "";
  if (snapshot.total === 0) return "No results";
  const total = `${formatCount(snapshot.total)}${snapshot.capped ? "+" : ""}`;
  return snapshot.current < 0
    ? total
    : `${formatCount(snapshot.current + 1)} of ${total}`;
}

/**
 * The Find bar (P2.11, details spec E1): find in the open document, step
 * through the hits and replace them. Lazy: `FindLoader` fetches this chunk
 * on idle and renders it on ⌘F. Only the editor's text is searched, never
 * the outline or other sidebar text.
 */
export function FindBar({ editor, request, memory, onClose }: FindBarProps) {
  const [controller, setController] = useState<FindController | null>(null);
  const [query, setQuery] = useState(memory.query);
  const [replacement, setReplacement] = useState(memory.replacement);
  const [caseSensitive, setCaseSensitive] = useState(memory.caseSensitive);
  const [wholeWord, setWholeWord] = useState(memory.wholeWord);
  const [showReplace, setShowReplace] = useState(false);
  const [notice, setNotice] = useState("");
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  /**
   * The writer moved to a hit (typed a query, changed an option, stepped
   * or replaced). Only then does closing select the current hit: a bar
   * opened on a remembered query and dismissed leaves the caret alone.
   */
  const navigated = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ query, caseSensitive, wholeWord });
  latest.current = { query, caseSensitive, wholeWord };

  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? noSnapshot,
    noSnapshot,
  );
  const editable = editor.isEditable;

  useEffect(() => {
    const next = new FindController(editor);
    setController(next);
    return () => next.destroy();
  }, [editor]);

  // The bar closes with its editor (a tab switch replaces it).
  useEffect(() => {
    editor.on("destroy", onClose);
    return () => {
      editor.off("destroy", onClose);
    };
  }, [editor, onClose]);

  useLayoutEffect(() => {
    const place = () => setPosition(barPosition(editor));
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [editor]);

  /** Runs the pending search now, if the field changed since the last one. */
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!controller) return;
    const { query: q, caseSensitive: cs, wholeWord: ww } = latest.current;
    const shown = controller.getSnapshot();
    if (
      shown.query !== q ||
      shown.caseSensitive !== cs ||
      shown.wholeWord !== ww
    ) {
      controller.search(q, { caseSensitive: cs, wholeWord: ww });
    }
  }, [controller]);

  // Search as the field or an option changes (not mid-composition).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the inputs change; `flush` reads them through `latest`
  useEffect(() => {
    if (!controller || composing.current) return;
    setNotice("");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [controller, flush, query, caseSensitive, wholeWord]);

  // Keys and menu picks: open (seeding from the selection), Replace, steps.
  // Each key press is a new `request` object, so this runs once per press.
  useEffect(() => {
    if (!controller) return;
    const { command, opened } = request;
    if (command === "open" || command === "replace") {
      const seed = selectionSeed(editor);
      if (seed) {
        setQuery(seed);
        latest.current = { ...latest.current, query: seed };
      }
      if (command === "replace" && editor.isEditable) setShowReplace(true);
      flush();
      findRef.current?.focus();
      findRef.current?.select();
      return;
    }
    flush();
    navigated.current = true;
    // Opening already lands on the next hit after the caret.
    if (!opened || command === "previous") {
      controller.step(command === "next" ? 1 : -1);
    }
  }, [controller, editor, flush, request]);

  // `memory` outlives the bar: the next ⌘F or ⌘G starts from it.
  useEffect(() => {
    Object.assign(memory, { query, replacement, caseSensitive, wholeWord });
  }, [memory, query, replacement, caseSensitive, wholeWord]);

  const close = useCallback(() => {
    flush();
    if (navigated.current) controller?.selectCurrent();
    editor.view.focus();
    onClose();
  }, [controller, editor, flush, onClose]);

  const step = (direction: 1 | -1) => {
    flush();
    navigated.current = true;
    controller?.step(direction);
  };

  const onFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  };

  const replaceOne = () => {
    flush();
    navigated.current = true;
    controller?.replace(replacement);
  };

  const replaceAll = () => {
    flush();
    navigated.current = true;
    const result = controller?.replaceAll(replacement) ?? { replaced: 0 };
    setNotice(replaceAllNotice(result));
    // The buttons turn disabled with no hits left; keep focus in the bar.
    replaceRef.current?.focus();
  };

  const onReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      replaceOne();
    }
  };

  // Esc closes from anywhere in the bar (a field or a button).
  const onBarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    close();
  };

  if (!position) return null;
  const mac = isMacPlatform();
  const nextKey = mac ? "⌘G" : "F3";
  const previousKey = mac ? "⇧⌘G" : "Shift+F3";
  const status = notice || countLabel(snapshot);
  const replaceOpen = showReplace && editable;

  return createPortal(
    <div
      role="search"
      aria-label="Find in document"
      data-find-bar=""
      onKeyDown={onBarKeyDown}
      className="fixed z-50 flex flex-col gap-1 rounded-lg border border-border bg-background p-1 text-foreground shadow-md md:w-[25rem]"
      style={position}
    >
      <style>{HIGHLIGHT_CSS}</style>
      <div className="flex items-center gap-0.5">
        {editable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Replace"
            aria-expanded={replaceOpen}
            title="Replace"
            onClick={() => setShowReplace((open) => !open)}
          >
            {replaceOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Button>
        ) : null}
        <input
          ref={findRef}
          type="text"
          dir="auto"
          spellCheck={false}
          autoComplete="off"
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[0.8125rem] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          placeholder="Find"
          aria-label="Find in document"
          value={query}
          onChange={(event) => {
            navigated.current = true;
            setQuery(event.target.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            setQuery(event.currentTarget.value);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, SEARCH_DELAY_MS);
          }}
          onKeyDown={onFindKeyDown}
        />
        <span
          role="status"
          className={cn(
            "min-w-[4.5rem] shrink-0 px-1 text-right text-[0.6875rem] tabular-nums whitespace-nowrap",
            notice === TOO_LARGE_NOTICE ||
              (snapshot.query && snapshot.total === 0 && !notice)
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {status}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Match case"
          aria-pressed={caseSensitive}
          title="Match case"
          onClick={() => {
            navigated.current = true;
            setCaseSensitive((on) => !on);
          }}
        >
          <CaseSensitiveIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Whole word"
          aria-pressed={wholeWord}
          title="Whole word"
          onClick={() => {
            navigated.current = true;
            setWholeWord((on) => !on);
          }}
        >
          <WholeWordIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous match"
          title={`Previous match (${previousKey})`}
          disabled={snapshot.total === 0}
          onClick={() => step(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next match"
          title={`Next match (${nextKey})`}
          disabled={snapshot.total === 0}
          onClick={() => step(1)}
        >
          <ArrowDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close find"
          title="Close (Esc)"
          onClick={close}
        >
          <CloseIcon />
        </Button>
      </div>
      {replaceOpen ? (
        <div className="flex items-center gap-1 pl-6">
          <input
            ref={replaceRef}
            type="text"
            dir="auto"
            spellCheck={false}
            autoComplete="off"
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[0.8125rem] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="Replace with"
            aria-label="Replace with"
            maxLength={MAX_REPLACEMENT_LENGTH}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={onReplaceKeyDown}
          />
          <Button
            variant="outline"
            size="xs"
            disabled={snapshot.total === 0}
            onClick={replaceOne}
          >
            Replace
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={snapshot.total === 0}
            onClick={replaceAll}
          >
            Replace all
          </Button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
