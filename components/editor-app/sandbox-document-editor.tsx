"use client";

/**
 * The web sandbox's editor: `DocumentEditor` with the sandbox's status chip.
 * `EditorApp` loads this module lazily, in place of the editor, so the chip
 * travels in the editor's chunk group (same first paint, no extra chunk),
 * while `components/document-editor/` imports nothing that reads
 * `collab-session` (architecture §3.3). Desktop roots pass their own chip.
 */
import type { ComponentProps } from "react";

import { DocumentEditor } from "@/components/document-editor/document-editor";
import { CollabStatusGroup } from "@/components/tiptap-ui/user-identity-button";

/** One element for every render: the editor's props stay referentially stable. */
const STATUS_CHIP = <CollabStatusGroup />;

export function SandboxDocumentEditor(
  props: ComponentProps<typeof DocumentEditor>,
) {
  return <DocumentEditor {...props} statusChip={STATUS_CHIP} />;
}
