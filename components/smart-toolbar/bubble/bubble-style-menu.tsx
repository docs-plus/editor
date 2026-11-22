"use client";

import { DirectionProvider } from "@base-ui/react/direction-provider";
import type { Editor } from "@tiptap/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu-trigger";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import {
  BlockquoteIcon,
  ChevronDownIcon,
  CodeBlockIcon,
  HeadingIcon,
  ListIcon,
  TypeIcon,
} from "@/lib/icons";

import { clearOfSelection } from "../color/clear-of-selection";
import {
  focusLostOnClose,
  menuBody,
  prefetchMenuBodies,
  useMenuGate,
} from "../lazy-menu";
import type { BubblePlacement } from "./bubble-rules";
import {
  STYLE_FACE_NAMES,
  STYLE_FACES,
  type StyleFace,
  useStyleFace,
} from "./style-face";

const Content = menuBody((bodies) => bodies.ToolbarMenuContent);
/** `ToolbarMenuContent`'s gap to its trigger. */
const MENU_GAP = 4;
const TurnIntoMenuItems = menuBody((bodies) => bodies.TurnIntoMenuItems);

/** Spec §7.1 Sizes: the face is at least 64px, and a word past 96px… */
const FACE_MIN = 64;
const FACE_MAX = 96;
/** …gives way to the type's icon: `padding-inline: 8px 4px`, gap, chevron. */
const FACE_CHROME = 8 + 4 + 4 + 12;

/** The icon face, for a locale whose longest word would pass 96px. */
function FaceIcon({ face }: { face: StyleFace }) {
  if (face === "List") return <ListIcon aria-hidden="true" />;
  if (face === "Quote") return <BlockquoteIcon aria-hidden="true" />;
  if (face === "Code") return <CodeBlockIcon aria-hidden="true" />;
  if (face.startsWith("H")) return <HeadingIcon aria-hidden="true" />;
  return <TypeIcon aria-hidden="true" />;
}

/**
 * The widest face word per computed font: measured on the first show (12
 * probe layouts), then read back on every later show.
 */
const FACE_WIDTHS = new Map<string, number>();

/** The widest face word, in the face's own font and untransformed. */
function widestFaceWord(host: HTMLElement): number {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  host.append(probe);
  let widest = 0;
  for (const face of STYLE_FACES) {
    probe.textContent = face;
    // `offsetWidth`, not the client rect: the panel scales in on show.
    widest = Math.max(widest, probe.offsetWidth);
  }
  probe.remove();
  return widest;
}

/**
 * The widest face word, measured at mount, so the face never moves the
 * other items or reflows while open; measured again once web fonts have
 * loaded. Null before it is measured (layout runs before paint) or where
 * nothing lays out.
 */
function useFaceWordWidth(word: React.RefObject<HTMLSpanElement | null>) {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    let live = true;
    const measure = (fresh: boolean) => {
      const host = word.current;
      if (!live || !host) return;
      const font = getComputedStyle(host).font;
      let widest = fresh ? undefined : FACE_WIDTHS.get(font);
      if (widest === undefined) {
        widest = widestFaceWord(host);
        if (widest > 0) FACE_WIDTHS.set(font, widest);
      }
      if (widest > 0) setWidth(widest);
    };
    measure(false);
    // Once: a web font still loading would change every word's width.
    if (document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(
        () => measure(true),
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [word]);
  return width;
}

/**
 * `useMenuFocus` (`row/action-menu.tsx`), kept here on purpose: importing
 * that eager module from this lazy chunk splits the editor chunk group
 * (+176 B measured), and the gate is 0 B. After a pick the editor already
 * holds the selection, so focus goes there at once; Esc and outside
 * clicks fall back to the trigger unless focus moved on.
 */
function useBubbleMenuFocus(editor: Editor) {
  const [open, setOpen] = useState(false);
  const picked = useRef(false);
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next && picked.current) editor.view.focus();
    },
    [editor],
  );
  const finalFocus = useCallback(() => {
    if (!picked.current) return focusLostOnClose();
    picked.current = false;
    return editor.view.dom;
  }, [editor]);
  const markPicked = useCallback(() => {
    picked.current = true;
  }, []);
  return { open, onOpenChange, finalFocus, markPicked };
}

/**
 * Style ▾ in the bubble (spec §7.1 slot 1, §7.4): the selection's block
 * type as one word ("Text", "H2", "List", "Mixed"), opening Turn into.
 * Named "Turn into" plus the face and its full name ("Turn into H2
 * Heading 2": the visible word is in the name, WCAG 2.5.3). The
 * menu's body is the row's, from the menu chunk, without Your formats; it
 * opens away from the text (`side`, spec §10.4).
 */
export function BubbleStyleMenu({
  editor,
  placement,
}: {
  editor: Editor;
  placement: BubblePlacement;
}) {
  const menu = useBubbleMenuFocus(editor);
  const openMenu = useMenuGate(menu.onOpenChange);
  // Base UI reads the direction from context, not from the page: the
  // submenu opens on the inline-end arrow (← in RTL, spec §7.10).
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const onOpenChange: typeof openMenu = (next, details) => {
    if (next) {
      setDirection(
        getComputedStyle(editor.view.dom).direction === "rtl" ? "rtl" : "ltr",
      );
    }
    openMenu(next, details);
  };
  const wordRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wordWidth = useFaceWordWidth(wordRef);
  const face = useStyleFace(editor);
  const name = STYLE_FACE_NAMES[face];
  const iconOnly = wordWidth !== null && wordWidth + FACE_CHROME > FACE_MAX;
  return (
    <DirectionProvider direction={direction}>
      <DropdownMenu open={menu.open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          ref={triggerRef}
          render={
            <ToolbarButton
              type="button"
              aria-haspopup="menu"
              tooltip="Turn into"
              size="sm"
              className="st-bubble-style"
              data-face={face}
              style={{ minWidth: FACE_MIN }}
              onPointerEnter={prefetchMenuBodies}
              onFocus={prefetchMenuBodies}
            />
          }
        >
          <span className="sr-only">Turn into </span>
          {iconOnly ? <FaceIcon face={face} /> : null}
          <span
            ref={wordRef}
            className="st-bubble-style-word"
            hidden={iconOnly}
            style={wordWidth === null ? undefined : { width: wordWidth }}
          >
            {face}
          </span>
          {iconOnly || name !== face ? (
            <span className="sr-only">{name}</span>
          ) : null}
          <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
        </DropdownMenuTrigger>
        <Content
          finalFocus={menu.finalFocus}
          label="Turn into"
          side={placement}
          // With no room away from the text Base UI flips the menu toward
          // it: then it goes past the selection's lines, never over them,
          // capped to the room left (spec §10.4, as the colour menu does).
          sideOffset={(data) =>
            MENU_GAP +
            clearOfSelection(editor, triggerRef.current, data, MENU_GAP)[1]
          }
        >
          <TurnIntoMenuItems editor={editor} onPicked={menu.markPicked} />
        </Content>
      </DropdownMenu>
    </DirectionProvider>
  );
}
