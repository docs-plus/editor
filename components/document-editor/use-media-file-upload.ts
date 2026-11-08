"use client";

import { isSafeMediaSrc } from "@docs.plus/extension-hypermultimedia";
import type { Editor } from "@tiptap/react";
import { useEffect } from "react";

import {
  handleImageUpload,
  IMAGE_UPLOAD_LIMIT,
} from "@/components/tiptap-node/image-upload-node/upload-utils";

/** Event the media kit dispatches on `document` for pasted image files. */
const FILE_UPLOAD_EVENT = "editorFileUpload";

interface FileUploadDetail {
  files: File[];
  editor: Editor;
}

async function insertPastedImages(editor: Editor, files: File[]) {
  const accepted = files
    .filter((file) => file.type.startsWith("image/"))
    .slice(0, IMAGE_UPLOAD_LIMIT);

  const results = await Promise.allSettled(
    accepted.map(async (file) => ({
      src: await handleImageUpload(file),
      alt: file.name,
    })),
  );

  const images = results.flatMap((result) => {
    if (result.status === "rejected") {
      console.error("Image paste failed:", result.reason);
      return [];
    }
    // Insert commands skip the kit's scheme gate (SVG and non-image data
    // URLs are rejected here), so run it before writing to the shared doc.
    return isSafeMediaSrc(result.value.src, { allowInlineImage: true })
      ? [{ type: "image", attrs: result.value }]
      : [];
  });

  if (images.length === 0 || editor.isDestroyed) return;
  editor.chain().focus().insertContent(images).run();
}

/**
 * Routes image files pasted into the editor through the same upload
 * pipeline as the image upload node. Without a listener the media kit
 * drops pasted files silently.
 */
export function useMediaFileUpload(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return;

    const handleFileUpload = (event: Event) => {
      const { detail } = event as CustomEvent<FileUploadDetail>;
      if (detail?.editor !== editor) return;
      void insertPastedImages(editor, detail.files);
    };

    document.addEventListener(FILE_UPLOAD_EVENT, handleFileUpload);
    return () => {
      document.removeEventListener(FILE_UPLOAD_EVENT, handleFileUpload);
    };
  }, [editor]);
}
