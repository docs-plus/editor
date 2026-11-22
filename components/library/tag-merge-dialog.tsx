"use client";

/**
 * Renaming a tag to another tag's name asks first (details spec §3):
 * "Merge “plans” into “planning”? 12 documents will have “planning”."
 * Cancel has focus, as in every sheet that changes many documents.
 */
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

import { useLibrary } from "./library-context";

/** Documents that will have `intoId` once `fromId` merges into it. */
export function mergedCount(
  items: readonly { readonly tagIds?: readonly string[] }[],
  fromId: string,
  intoId: string,
): number {
  let count = 0;
  for (const item of items) {
    const tags = item.tagIds;
    if (tags && (tags.includes(fromId) || tags.includes(intoId))) count++;
  }
  return count;
}

export function TagMergeDialog({
  fromId,
  intoId,
  onClose,
}: {
  fromId: string;
  intoId: string;
  onClose: (merged: boolean) => void;
}) {
  const { snapshot } = useLibrary();
  const cancel = useRef<HTMLButtonElement>(null);
  const from = snapshot.tags.find((tag) => tag.id === fromId)?.name ?? "";
  const into = snapshot.tags.find((tag) => tag.id === intoId)?.name ?? "";
  const count = mergedCount(snapshot.items, fromId, intoId);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose(false);
      }}
    >
      <DialogContent
        className="lib-dialog lib-sheet"
        showCloseButton={false}
        initialFocus={cancel}
        // The provider puts focus back on the tag's row once this is gone.
        finalFocus={false}
        role="alertdialog"
      >
        <DialogTitle>
          Merge “<bdi dir="auto">{from}</bdi>” into “
          <bdi dir="auto">{into}</bdi>”?
        </DialogTitle>
        <DialogDescription>
          {count} {count === 1 ? "document" : "documents"} will have “
          <bdi dir="auto">{into}</bdi>”.
        </DialogDescription>
        <DialogFooter className="lib-dialog-footer">
          <Button ref={cancel} variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button onClick={() => onClose(true)}>Merge</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
