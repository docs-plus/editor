"use client";

/**
 * "Save selection as format" (design pass §7), the palette's second view. Its own
 * chunk, fetched only when the view opens, so the palette chunk stays in
 * its budget and this one can read the selection's bundle and the saved
 * formats directly: the preview, the "Replaces" note and the cap. It
 * imports nothing from the action registry (the palette runs the save):
 * that import regroups the editor chunk's modules and costs it ~500 B gz.
 */
import type { Editor } from "@tiptap/core";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  bundleLabel,
  isEmptyBundle,
  readBundleAt,
  setEntries,
} from "@/extensions/repeat-formatting/bundle";
import {
  FORMAT_REASONS,
  MAX_FORMAT_NAME,
  MAX_SAVED_FORMATS,
  readSavedFormats,
  sanitizeFormatName,
} from "@/lib/saved-formats";

import { FormatPreview } from "../formats/format-preview";

export interface SaveFormatFormProps {
  editor: Editor;
  /** Closes the palette and returns focus to the editor. */
  onClose: () => void;
  /** Runs `formats.save` with the clean name; true when it saved. */
  onSave: (name: string) => boolean;
  /** Opens "Remove a format ▸"; true when the style dropdown took it. */
  onRemoveFormat: () => boolean;
}

export function SaveFormatForm({
  editor,
  onClose,
  onSave,
  onRemoveFormat,
}: SaveFormatFormProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Keys the alert, so the same error is read again on each submit.
  const [attempt, setAttempt] = useState(0);
  // Read once: the selection and the list do not change under the dialog.
  const [bundle] = useState(() => setEntries(readBundleAt(editor.state)));
  const [formats] = useState(readSavedFormats);

  const cleanName = sanitizeFormatName(name);
  const replaces = cleanName
    ? formats.find(
        (format) => format.name.toLowerCase() === cleanName.toLowerCase(),
      )
    : undefined;
  const atCap = !replaces && formats.length >= MAX_SAVED_FORMATS;
  const describedBy = [
    `${id}-hint`,
    replaces && `${id}-note`,
    atCap && `${id}-cap`,
    error && `${id}-error`,
  ]
    .filter(Boolean)
    .join(" ");

  const fail = (message: string) => {
    setError(message);
    setAttempt((n) => n + 1);
  };

  const save = () => {
    if (!cleanName) return fail(FORMAT_REASONS.name);
    if (isEmptyBundle(bundle)) return fail(FORMAT_REASONS.empty);
    if (atCap) return fail(FORMAT_REASONS.cap);
    if (!onSave(cleanName)) fail("This format could not be saved.");
  };

  return (
    <form
      className="flex flex-col gap-2 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <DialogTitle>Save selection as format</DialogTitle>
      <DialogDescription>
        Reuse this style anywhere. Saved on this device.
      </DialogDescription>
      <div
        data-format-preview=""
        className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
      >
        <FormatPreview bundle={bundle}>Sample text</FormatPreview>
        <span className="ms-auto truncate text-xs text-muted-foreground">
          {bundleLabel(bundle)}
        </span>
      </div>
      <label htmlFor={`${id}-name`} className="pt-2 text-sm font-medium">
        Name
      </label>
      <Input
        id={`${id}-name`}
        autoFocus
        maxLength={MAX_FORMAT_NAME}
        placeholder="e.g. Warning"
        value={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        className="pointer-coarse:h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid"
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Up to {MAX_FORMAT_NAME} characters
      </p>
      {replaces ? (
        <p id={`${id}-note`} className="text-sm">
          Replaces your format ‘{replaces.name}’.
        </p>
      ) : null}
      {atCap ? (
        <p id={`${id}-cap`} className="text-sm">
          {FORMAT_REASONS.cap}{" "}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              if (onRemoveFormat()) onClose();
            }}
          >
            Remove a format
          </Button>
        </p>
      ) : null}
      {error ? (
        <p
          key={attempt}
          id={`${id}-error`}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          className="pointer-coarse:min-h-11"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="pointer-coarse:min-h-11"
          disabled={!cleanName || atCap}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
