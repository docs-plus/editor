"use client";

import type { Editor } from "@tiptap/react";
import { type ReactNode, useId, useRef } from "react";

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { editorActions } from "@/lib/editor-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type {
  ContextKind,
  Ctx,
  IconComponent,
} from "@/lib/editor-actions/types";
import { templateMermaidAction } from "@/lib/editor-actions/v11-actions";
import {
  ArrowRightLeftIcon,
  BrainIcon,
  ChartPieIcon,
  CircleDotIcon,
  NetworkIcon,
} from "@/lib/icons";

export interface DiagramTemplatesProps {
  editor: Editor;
  ctx: Ctx | null;
  /** The last kind inserted (M10): marked for the menu's pre-highlight. */
  last?: boolean;
  /** The plain Diagram item, until E's engine lists the templates. */
  fallback?: ReactNode;
}

/** A collision flips the submenu to the left, never down over its rows. */
const COLLISION = { side: "flip", fallbackAxisSide: "none" } as const;

const TEMPLATE_ICON: Readonly<Record<string, IconComponent>> = {
  flowchart: NetworkIcon,
  sequence: ArrowRightLeftIcon,
  state: CircleDotIcon,
  mindmap: BrainIcon,
  pie: ChartPieIcon,
};

/** Where the caret is, for the one note that replaces per-row reasons. */
const WHERE: Partial<Record<ContextKind, string>> = {
  mermaid: "inside a diagram",
  code: "inside a code block",
  media: "on an image",
  title: "in the title",
};

/**
 * Why no template can go here, said once above the rows (design pass §9):
 * "Can’t insert inside a diagram. Move the cursor to a paragraph."
 */
export function diagramNote(ctx: Ctx, reason: string): string {
  if (!ctx.editable) return reason;
  const where = WHERE[ctx.isTitle ? "title" : ctx.kind] ?? "here";
  return `Can’t insert ${where}. Move the cursor to a paragraph.`;
}

/**
 * Diagram ▸ in the Insert menu (M17b, design pass §9): one standard
 * submenu row that opens on hover, click, Enter or ArrowRight, with the
 * five templates and their icons. The last used one is noted "Last used"
 * and focused first. When none can go here, one note at the top says why.
 * Until E's engine (which lists them) lands, Diagram stays one item.
 */
export function DiagramTemplates({
  editor,
  ctx,
  last,
  fallback,
}: DiagramTemplatesProps) {
  const lastRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const templates = ctx ? (templateMermaidAction.options?.(ctx) ?? []) : [];
  const diagram = editorActions.get("insert.mermaid");
  if (!ctx || !diagram || templates.length === 0) return fallback;
  const Icon = diagram.icon;
  const enabled = availability(templateMermaidAction, ctx);
  const note = enabled === true ? null : diagramNote(ctx, enabled.reason);
  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) requestAnimationFrame(() => lastRef.current?.focus());
      }}
    >
      <DropdownMenuSubTrigger
        data-action-id={diagram.id}
        data-last={last ? "" : undefined}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        <span>{diagram.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        collisionAvoidance={COLLISION}
        className="min-w-44"
      >
        {note ? (
          <p
            id={`${id}-note`}
            data-diagram-note=""
            className="max-w-56 px-1.5 py-1 text-xs text-muted-foreground"
          >
            {note}
          </p>
        ) : null}
        {templates.map((template) => {
          const TemplateIcon = TEMPLATE_ICON[String(template.value)];
          return (
            <DropdownMenuItem
              key={String(template.value)}
              ref={template.note ? lastRef : undefined}
              data-template={String(template.value)}
              disabled={note !== null}
              aria-describedby={
                note ? `${id}-note` : template.note ? `${id}-last` : undefined
              }
              onClick={() =>
                runAction(editor, templateMermaidAction, template.value)
              }
            >
              {TemplateIcon ? <TemplateIcon aria-hidden="true" /> : null}
              <span>{template.label}</span>
              {template.note ? (
                <span
                  id={`${id}-last`}
                  className="ms-auto ps-3 text-xs text-muted-foreground"
                  aria-hidden="true"
                >
                  {template.note}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
