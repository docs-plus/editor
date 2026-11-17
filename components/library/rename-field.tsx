"use client";

/**
 * Inline rename in the tree (F2; UX §4.6 "Inline rename"): Enter commits,
 * Esc cancels, Tab commits and moves to the next row, and leaving the field
 * commits. An empty name is a form error under the field, which keeps
 * focus (UX §6.1).
 */
import { useId, useLayoutEffect, useRef, useState } from "react";

import type { LibraryItemRef } from "@/lib/platform/document-index";

import { useLibrary } from "./library-context";

export type RenameExit = "same" | "next" | "none";

export function RenameField({
  item,
  onDone,
}: {
  item: LibraryItemRef;
  /** Where focus goes: this row, the next one (Tab), or nowhere (blur). */
  onDone: (next: RenameExit) => void;
}) {
  const { snapshot, actions } = useLibrary();
  const initial =
    item.kind === "folder"
      ? (snapshot.folders.find((folder) => folder.id === item.id)?.name ?? "")
      : (snapshot.items.find((doc) => doc.id === item.id)?.title ?? "");
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const errorId = useId();

  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const commit = (next: RenameExit): boolean => {
    if (done.current) return true;
    if (!value.trim()) {
      setError(item.kind === "folder" ? "Enter a name." : "Enter a title.");
      return false;
    }
    done.current = true;
    actions.rename(item, value);
    onDone(next);
    return true;
  };

  return (
    <span className="lib-rename">
      <input
        ref={input}
        className="lib-rename-input"
        value={value}
        dir="auto"
        aria-label={item.kind === "folder" ? "Folder name" : "Title"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        maxLength={200}
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commit("same");
          } else if (event.key === "Escape") {
            event.preventDefault();
            done.current = true;
            onDone("same");
          } else if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            commit("next");
          }
        }}
        onBlur={() => {
          if (done.current) return;
          if (!commit("none")) {
            // Leaving an empty field cancels instead of trapping focus.
            done.current = true;
            onDone("none");
          }
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {error ? (
        <span id={errorId} className="lib-rename-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
