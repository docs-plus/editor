"use client";

/**
 * Quick Open (⌘O / Ctrl+O; UX §4.3, search-linking §3.6–3.7, D24): titles
 * and folder names only, never document text, through the shared
 * normalizer. Empty query: the 8 most recent. No match: a Create row and
 * the sentence that says what search looks at. Enter opens, ⌘Enter opens
 * in a new tab, ⌥⌘Enter (Shift+Enter off macOS) in a new window, Esc
 * closes and returns focus.
 */
import { useEffect, useId, useMemo, useState } from "react";

import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FilePlusIcon, FileTextIcon } from "@/lib/icons";
import { openTarget } from "@/lib/library/library-keys";
import { type Range, searchDocuments } from "@/lib/library/quick-open-search";
import { isMac } from "@/lib/shortcuts";

import { useLibrary } from "./library-context";

const CREATE = "\u0000create";
/** "5 documents" is said once results settle, not per keystroke. */
const SETTLE_MS = 500;

/** `text` with `ranges` in <mark> (bold, never colour alone). */
export function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly Range[];
}) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function QuickOpen({ onClose }: { onClose: (opened: boolean) => void }) {
  const { snapshot, actions, index } = useLibrary();
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [spoken, setSpoken] = useState("");
  const statusId = useId();
  const results = useMemo(
    () => searchDocuments(snapshot, query),
    [snapshot, query],
  );
  const trimmed = query.trim();
  const libraryEmpty = snapshot.items.length === 0;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!trimmed) setSpoken("");
      else if (results.length === 0) setSpoken("No documents match.");
      else
        setSpoken(
          `${results.length} ${results.length === 1 ? "document" : "documents"}`,
        );
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [results, trimmed]);

  const open = (id: string, target: ReturnType<typeof openTarget>) => {
    onClose(true);
    actions.open(id, target);
  };

  const create = (target: ReturnType<typeof openTarget>) => {
    const entry = index.create({ title: trimmed, folderId: null });
    if (!entry) return;
    onClose(true);
    actions.open(entry.id, target);
  };

  const run = (selected: string, target: ReturnType<typeof openTarget>) => {
    if (selected === CREATE) create(target);
    else if (selected) open(selected, target);
  };

  const mac = isMac();
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose(false);
      }}
    >
      <DialogContent
        className="lib-dialog lib-quick-open"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Quick Open</DialogTitle>
        <Command
          shouldFilter={false}
          loop
          value={value}
          onValueChange={setValue}
          label="Quick Open"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const target = openTarget(event, mac);
            if (target === "current") return;
            event.preventDefault();
            event.stopPropagation();
            run(value, target);
          }}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search by title"
            aria-describedby={statusId}
          />
          <CommandList className="lib-qo-list">
            {results.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                onSelect={() => open(result.id, "current")}
                className="lib-qo-row"
              >
                <FileTextIcon aria-hidden="true" />
                <span className="lib-qo-title">
                  <bdi dir="auto">
                    <Highlighted
                      text={result.title}
                      ranges={result.titleRanges}
                    />
                  </bdi>
                </span>
                {/* The name reads "Q4 plan, in Library › Work › Q4". */}
                <span className="sr-only">, in </span>
                <span className="lib-qo-path">
                  {["Library", ...result.path].map((name, at) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: path segments repeat
                    <span key={at}>
                      {at > 0 ? " › " : ""}
                      <bdi dir="auto">
                        <Highlighted
                          text={name}
                          ranges={
                            at > 0 ? (result.pathRanges[at - 1] ?? []) : []
                          }
                        />
                      </bdi>
                    </span>
                  ))}
                </span>
              </CommandItem>
            ))}
            {trimmed && results.length === 0 ? (
              <>
                <CommandItem
                  value={CREATE}
                  onSelect={() => create("current")}
                  className="lib-qo-row"
                >
                  <FilePlusIcon aria-hidden="true" />
                  <span className="lib-qo-title">
                    Create “<bdi dir="auto">{trimmed}</bdi>”
                  </span>
                </CommandItem>
                <p className="lib-qo-note">
                  Search looks at titles, tags and folders, not inside
                  documents.
                </p>
              </>
            ) : null}
            {!trimmed && libraryEmpty ? (
              <p className="lib-qo-note">
                No documents yet. Type a title to create one.
              </p>
            ) : null}
          </CommandList>
          <div className="lib-qo-foot" aria-hidden="true">
            <span>
              <kbd>↵</kbd> Open
            </span>
            <span>
              <kbd>{mac ? "⌘↵" : "Ctrl+↵"}</kbd> New tab
            </span>
            <span>
              <kbd>{mac ? "⌥⌘↵" : "Shift+↵"}</kbd> New window
            </span>
            <span className="lib-qo-foot-end">
              <kbd>esc</kbd> Close
            </span>
          </div>
        </Command>
        <p id={statusId} className="sr-only" aria-live="polite">
          {spoken}
        </p>
      </DialogContent>
    </Dialog>
  );
}
