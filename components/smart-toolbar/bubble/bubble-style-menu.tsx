"use client";

import type { Editor } from "@tiptap/react";
import { useLayoutEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu-trigger";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import type { IconComponent } from "@/lib/editor-actions/types";
import {
  BlockquoteIcon,
  ChevronDownIcon,
  CodeBlockIcon,
  HeadingIcon,
  ListIcon,
  TypeIcon,
} from "@/lib/icons";

import { menuBody, prefetchMenuBodies, useMenuGate } from "../lazy-menu";
import { useMenuFocus } from "../row/action-menu";
import type { BubblePlacement } from "./bubble-rules";
import {
  STYLE_FACE_NAMES,
  STYLE_FACES,
  type StyleFace,
  styleFace,
} from "./style-face";

const Content = menuBody((bodies) => bodies.ToolbarMenuContent);
const TurnIntoMenuItems = menuBody((bodies) => bodies.TurnIntoMenuItems);

/** Spec §7.1 Sizes: the face is at least 64px, and a word past 96px… */
const FACE_MIN = 64;
const FACE_MAX = 96;
/** …gives way to the type's icon: `padding-inline: 8px 4px`, gap, chevron. */
const FACE_CHROME = 8 + 4 + 4 + 12;

/** The icon face, for a locale whose longest word would pass 96px. */
const FACE_ICONS: Partial<Record<StyleFace, IconComponent>> = {
  List: ListIcon,
  Quote: BlockquoteIcon,
  Code: CodeBlockIcon,
};

const faceIcon = (face: StyleFace): IconComponent =>
  FACE_ICONS[face] ?? (face.startsWith("H") ? HeadingIcon : TypeIcon);

/**
 * The widest face word in the face's own font, measured once at mount, so
 * the face never moves the other items or reflows while open. Null before
 * it is measured (layout runs before paint) or where nothing lays out.
 */
function useFaceWordWidth(word: React.RefObject<HTMLSpanElement | null>) {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const host = word.current;
    if (!host) return;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    host.append(probe);
    let widest = 0;
    for (const face of STYLE_FACES) {
      probe.textContent = face;
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    probe.remove();
    if (widest > 0) setWidth(Math.ceil(widest));
  }, [word]);
  return width;
}

/**
 * Style ▾ in the bubble (spec §7.1 slot 1, §7.4): the selection's block
 * type as one word ("Text", "H2", "List", "Mixed"), opening Turn into.
 * Named by the face plus the full name ("H2 Heading 2", WCAG 2.5.3). The
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
  // Subscribes to the snapshot: the face follows the selection.
  useActionView("style.paragraph", editor);
  const menu = useMenuFocus(editor);
  const openMenu = useMenuGate(menu.onOpenChange);
  const wordRef = useRef<HTMLSpanElement>(null);
  const wordWidth = useFaceWordWidth(wordRef);
  const face = styleFace(editor.state);
  const name = STYLE_FACE_NAMES[face];
  const iconOnly = wordWidth !== null && wordWidth + FACE_CHROME > FACE_MAX;
  const Icon = faceIcon(face);
  return (
    <DropdownMenu open={menu.open} onOpenChange={openMenu}>
      <DropdownMenuTrigger
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
        {iconOnly ? <Icon aria-hidden="true" /> : null}
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
      <Content finalFocus={menu.finalFocus} label="Turn into" side={placement}>
        <TurnIntoMenuItems editor={editor} onPicked={menu.markPicked} />
      </Content>
    </DropdownMenu>
  );
}
