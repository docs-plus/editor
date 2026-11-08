"use client";

import type { Editor } from "@tiptap/react";
import { useId, useState } from "react";

// --- Tiptap UI ---
import {
  MEDIA_EMBED_HINT,
  resolveMediaType,
  useMediaEmbed,
} from "@/components/tiptap-ui/media-embed-popover/use-media-embed";
// --- UI ---
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToolbarButton } from "@/components/ui/toolbar-button";
// --- Icons ---
import { MediaEmbedIcon } from "@/lib/icons";

export interface MediaEmbedPopoverProps {
  editor?: Editor | null;
}

/**
 * Toolbar popover that turns a media URL into an embed node. Pasting the
 * same URL into the document works too; this makes it discoverable.
 */
export function MediaEmbedPopover({
  editor: providedEditor,
}: MediaEmbedPopoverProps) {
  const { isVisible, canEmbed, handleEmbed, label } =
    useMediaEmbed(providedEditor);
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [hasError, setHasError] = useState(false);
  const hintId = useId();

  if (!isVisible) return null;

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setUrl("");
      setHasError(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolveMediaType(url) || !handleEmbed(url)) {
      setHasError(true);
      return;
    }
    handleOpenChange(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <ToolbarButton
            type="button"
            disabled={!canEmbed}
            aria-label={label}
            tooltip={label}
            tabIndex={-1}
          />
        }
      >
        <MediaEmbedIcon />
      </PopoverTrigger>
      <PopoverContent aria-label={label} className="w-80">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              type="url"
              inputMode="url"
              autoFocus
              autoComplete="off"
              placeholder="Paste a media link…"
              aria-label="Media URL"
              aria-describedby={hintId}
              aria-invalid={hasError || undefined}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setHasError(false);
              }}
            />
            <Button type="submit" size="sm" disabled={!url.trim()}>
              Embed
            </Button>
          </div>
          <p
            id={hintId}
            className={
              hasError
                ? "m-0 text-xs text-destructive"
                : "m-0 text-xs text-muted-foreground"
            }
          >
            {hasError
              ? `Unsupported link. Use: ${MEDIA_EMBED_HINT}.`
              : MEDIA_EMBED_HINT}
          </p>
        </form>
      </PopoverContent>
    </Popover>
  );
}
