"use client";

import type { Editor } from "@tiptap/react";
import { useId, useRef } from "react";

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { Ctx } from "@/lib/editor-actions/types";
import { templateMermaidAction } from "@/lib/editor-actions/v11-actions";

export interface DiagramTemplatesProps {
  editor: Editor;
  ctx: Ctx | null;
}

/**
 * "▸" beside Diagram in the Insert menu (M17b): the five templates, the
 * last used one described "Last used" and focused first when the submenu
 * opens. ▸ is its own item, so Diagram still inserts with one click or
 * Enter, and ArrowRight or Enter on ▸ opens the templates. Nothing until
 * E's engine (which lists them) lands.
 */
export function DiagramTemplates({ editor, ctx }: DiagramTemplatesProps) {
  const lastRef = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const templates = ctx ? (templateMermaidAction.options?.(ctx) ?? []) : [];
  if (templates.length === 0) return null;
  const enabled = availability(templateMermaidAction, ctx as Ctx);
  const reason = enabled === true ? undefined : enabled.reason;
  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) requestAnimationFrame(() => lastRef.current?.focus());
      }}
    >
      <DropdownMenuSubTrigger
        aria-label="Pick a diagram template"
        title={reason ?? "Diagram templates"}
        disabled={reason !== undefined}
        className="px-1.5 *:[svg]:ml-0"
      />
      <DropdownMenuSubContent>
        {templates.map((template) => (
          <DropdownMenuItem
            key={String(template.value)}
            ref={template.note ? lastRef : undefined}
            data-template={String(template.value)}
            aria-describedby={template.note ? noteId : undefined}
            onClick={() =>
              runAction(editor, templateMermaidAction, template.value)
            }
          >
            <span>{template.label}</span>
            {template.note ? (
              <span
                id={noteId}
                className="ml-auto ps-3 text-xs text-muted-foreground"
                aria-hidden="true"
              >
                {template.note}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
