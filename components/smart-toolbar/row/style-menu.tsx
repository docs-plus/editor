"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";

import { useActionView } from "@/hooks/use-editor-context";
import { TEXT_STYLE_LABELS } from "@/lib/editor-actions/core/blocks";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";

import { menuBody, useMenuGate } from "../lazy-menu";
import { ToolbarMenu, useMenuFocus, useSurfaceEditor } from "./action-menu";

const StyleMenuItems = menuBody((bodies) => bodies.StyleMenuItems);

const VALUE_BY_LABEL = new Map(
  Object.entries(TEXT_STYLE_LABELS).map(([value, label]) => [label, value]),
);

/** The T5 value: "H2", "Text", "Title", "Mixed". */
const shortStyle = (label: string) =>
  label.replace("Heading ", "H").replace("Normal text", "Text");

/**
 * Text style ▾ (spec §4.1): named by the current style ("Normal text",
 * "Heading 2", "Title", "Mixed"), shortened at T5. In the title every item
 * is disabled with "Title is always H1." Items are the `style.*` registry
 * actions, then Your formats (`StyleMenuItems`, menu chunk). The `formats.remove` UI
 * intent (the Save dialog at the cap) opens it at "Remove a format ▸", a
 * frame later, once the palette has closed and the editor has focus.
 */
export function StyleMenu({ editor: provided }: { editor?: Editor | null }) {
  const editor = useSurfaceEditor(provided);
  const view = useActionView("style.paragraph", editor);
  const menu = useMenuFocus(editor);
  const [removing, setRemoving] = useState(false);
  const { onOpenChange } = menu;
  // Opened without its trigger, so through the gate too: it waits for the
  // menu chunk like a click does, and says so if the chunk does not load.
  const openRemoving = useMenuGate(
    useCallback(
      (next: boolean) => {
        setRemoving(next);
        onOpenChange(next);
      },
      [onOpenChange],
    ),
  );
  useEffect(
    () =>
      editor
        ? onUiIntent(editor, (intent) => {
            if (intent.type !== "formats.remove") return false;
            requestAnimationFrame(() => openRemoving(true));
            return true;
          })
        : undefined,
    [editor, openRemoving],
  );
  if (!editor || !view) return null;
  const label = view.value ?? TEXT_STYLE_LABELS.paragraph;
  const readOnly =
    view.enabled !== true && view.enabled.reason === READ_ONLY_REASON;
  return (
    <ToolbarMenu
      label={label}
      short={shortStyle(label)}
      tooltip="Text style"
      readOnly={readOnly}
      open={menu.open}
      onOpenChange={(next) => {
        if (!next) setRemoving(false);
        onOpenChange(next);
      }}
      finalFocus={menu.finalFocus}
      contentLabel="Text style"
    >
      <StyleMenuItems
        editor={editor}
        value={VALUE_BY_LABEL.get(label) ?? ""}
        onPicked={menu.markPicked}
        removing={removing}
      />
    </ToolbarMenu>
  );
}
