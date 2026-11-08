"use client";

import {
  detectMediaType,
  isSafeMediaSrc,
  type MediaNodeType,
} from "@docs.plus/extension-hypermultimedia";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { ChainedCommands, Editor } from "@tiptap/react";
import { useCallback } from "react";

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
// --- Lib ---
import { isNodeInSchema } from "@/lib/editor-utils";

export const MEDIA_EMBED_HINT =
  "Image, video or audio file, YouTube, Vimeo, Loom, SoundCloud, Spotify or X";

type MediaInserter = (chain: ChainedCommands, src: string) => ChainedCommands;

const MEDIA_INSERTERS: Record<MediaNodeType, MediaInserter> = {
  image: (chain, src) => chain.setImage({ src }),
  video: (chain, src) => chain.setVideo({ src }),
  audio: (chain, src) => chain.setAudio({ src }),
  youtube: (chain, src) => chain.setYoutubeVideo({ src }),
  vimeo: (chain, src) => chain.setVimeo({ src }),
  soundcloud: (chain, src) => chain.setSoundCloud({ src }),
  spotify: (chain, src) => chain.setSpotify({ src }),
  loom: (chain, src) => chain.setLoom({ src }),
  x: (chain, src) => chain.setX({ src }),
};

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Resolves a pasted URL to the media node that renders it. Only absolute
 * http(s) URLs that pass the kit's scheme gate qualify: the insert commands
 * themselves store any string.
 */
export function resolveMediaType(rawUrl: string): MediaNodeType | null {
  const url = rawUrl.trim();
  if (!isWebUrl(url) || !isSafeMediaSrc(url)) return null;
  return detectMediaType(url);
}

export function canEmbedMedia(editor: Editor | null): boolean {
  if (!editor?.isEditable) return false;
  return isNodeInSchema("image", editor) && !editor.isActive("codeBlock");
}

/**
 * The kit's insert commands leave a NodeSelection on the new node, so a
 * second embed would replace the first. Park the caret in a paragraph after
 * it instead, creating one when the next node is not a paragraph.
 */
function moveCaretBelowInsertedNode(chain: ChainedCommands): ChainedCommands {
  return chain.command(({ tr }) => {
    const { selection } = tr;
    if (!(selection instanceof NodeSelection)) return true;

    const paragraph = tr.doc.type.schema.nodes.paragraph;
    const after = selection.to;
    const $after = tr.doc.resolve(after);
    if ($after.nodeAfter?.type !== paragraph) {
      const index = $after.index();
      if (
        !paragraph ||
        !$after.parent.canReplaceWith(index, index, paragraph)
      ) {
        return true;
      }
      tr.insert(after, paragraph.create());
    }
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    return true;
  });
}

export function embedMedia(editor: Editor | null, rawUrl: string): boolean {
  if (!editor || !canEmbedMedia(editor)) return false;
  const type = resolveMediaType(rawUrl);
  if (!type) return false;
  const chain = MEDIA_INSERTERS[type](editor.chain().focus(), rawUrl.trim());
  return moveCaretBelowInsertedNode(chain).run();
}

export function useMediaEmbed(providedEditor?: Editor | null) {
  const { editor } = useTiptapEditor(providedEditor);

  const handleEmbed = useCallback(
    (url: string) => embedMedia(editor, url),
    [editor],
  );

  return {
    editor,
    isVisible: Boolean(editor?.isEditable),
    canEmbed: canEmbedMedia(editor),
    handleEmbed,
    label: "Embed media",
  };
}
