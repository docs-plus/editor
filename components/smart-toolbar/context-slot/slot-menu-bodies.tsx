"use client";

import type { Editor } from "@tiptap/react";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { CODE_LANGUAGES } from "@/lib/code-language";
import { runAction } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";

/**
 * The slot's language menu items (menu chunk, `menu-bodies.ts`): every
 * language, the current one checked. Its trigger is `LanguageMenu` in
 * `context-slot.tsx`.
 */
export function LanguageMenuItems({
  action,
  editor,
  value,
  onPicked,
}: {
  action: AnyAction;
  editor: Editor;
  /** The current language's value ("javascript"), or "". */
  value: string;
  onPicked: () => void;
}) {
  return (
    <DropdownMenuRadioGroup value={value}>
      {CODE_LANGUAGES.map((option) => (
        <DropdownMenuRadioItem
          key={option.value}
          value={option.value}
          closeOnClick
          onClick={() => {
            onPicked();
            runAction(editor, action, option.value);
          }}
        >
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
