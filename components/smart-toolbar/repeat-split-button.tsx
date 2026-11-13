"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { useState, useSyncExternalStore } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import {
  bundleFace,
  bundleKey,
  bundleLabel,
  type FormatBundle,
} from "@/extensions/repeat-formatting/bundle";
import {
  getRememberedBundle,
  subscribeBundle,
} from "@/extensions/repeat-formatting/bundle-memory";
import { scanDocFormats } from "@/lib/doc-format-scan";
import { runAction } from "@/lib/editor-actions/registry";
import {
  DOC_FORMAT_PREFIX,
  formatsApplyAction,
  repeatApplyAction,
  repeatCopyAction,
} from "@/lib/editor-actions/v11-actions";
import { ChevronDownIcon, RepeatIcon } from "@/lib/icons";
import {
  readSavedFormats,
  type SavedFormat,
  subscribeSavedFormats,
} from "@/lib/saved-formats";

import { openPalette } from "./palette/palette-store";
import type { SurfaceProps } from "./types";

const getNull = () => null;
const EMPTY: readonly SavedFormat[] = [];
const getNoFormats = () => EMPTY;

/** The remembered Repeat bundle; re-renders on every change. */
export function useRememberedBundle(): FormatBundle | null {
  return useSyncExternalStore(subscribeBundle, getRememberedBundle, getNull);
}

function useSavedFormats(): readonly SavedFormat[] {
  return useSyncExternalStore(
    subscribeSavedFormats,
    readSavedFormats,
    getNoFormats,
  );
}

/**
 * ↻ Repeat formatting split (M7): the face names the bundle and repeats it;
 * the chevron opens the Formats menu (Repeat, Copy formatting, Save as
 * format…, Your formats M14, In this doc M12). Every item runs a registry
 * action. Rendered by D2's bubble and phone bar; nothing without a bundle
 * or saved format.
 */
export function RepeatSplitButton({ editor: provided }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = provided ?? contextEditor ?? null;
  const bundle = useRememberedBundle();
  const saved = useSavedFormats();
  const [inDoc, setInDoc] = useState<readonly FormatBundle[]>([]);
  if (!editor || (!bundle && saved.length === 0)) return null;

  const run = (action: Parameters<typeof runAction>[1], arg?: unknown) => {
    runAction(editor, action, arg);
  };

  return (
    <div className="flex items-center" data-repeat-split="">
      {bundle ? (
        <ToolbarButton
          type="button"
          data-action-id={repeatApplyAction.id}
          aria-label={`Repeat formatting: ${bundleLabel(bundle)}`}
          tooltip="Repeat formatting"
          className="min-h-6 min-w-6 gap-1 px-1.5"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run(repeatApplyAction)}
        >
          <RepeatIcon className="tiptap-button-icon" aria-hidden="true" />
          <span className="text-xs">{bundleFace(bundle)}</span>
        </ToolbarButton>
      ) : null}
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setInDoc(scanDocFormats(editor.state.doc).bundles);
        }}
      >
        <DropdownMenuTrigger
          render={
            <ToolbarButton
              type="button"
              aria-label="More formatting options"
              aria-haspopup="menu"
              tooltip="More formatting options"
              className="min-h-6 min-w-6 px-0.5"
              onMouseDown={(event) => event.preventDefault()}
            />
          }
        >
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </DropdownMenuTrigger>
        <FormatsMenuContent
          editor={editor}
          bundle={bundle}
          saved={saved}
          inDoc={inDoc}
          run={run}
        />
      </DropdownMenu>
    </div>
  );
}

function FormatsMenuContent({
  editor,
  bundle,
  saved,
  inDoc,
  run,
}: {
  editor: Editor;
  bundle: FormatBundle | null;
  saved: readonly SavedFormat[];
  inDoc: readonly FormatBundle[];
  run: (action: Parameters<typeof runAction>[1], arg?: unknown) => void;
}) {
  return (
    <DropdownMenuContent align="start" className="min-w-56">
      <DropdownMenuGroup>
        {bundle ? (
          <DropdownMenuItem onClick={() => run(repeatApplyAction)}>
            Repeat formatting: {bundleFace(bundle)}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => run(repeatCopyAction)}>
          Copy formatting
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPalette(editor, "save-format")}>
          Save as format…
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {saved.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Your formats</DropdownMenuLabel>
            {saved.map((format) => (
              <DropdownMenuItem
                key={format.id}
                onClick={() => run(formatsApplyAction, format.id)}
              >
                {format.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      ) : null}
      {inDoc.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>In this doc</DropdownMenuLabel>
            {inDoc.map((entry) => (
              <DropdownMenuItem
                key={bundleKey(entry)}
                onClick={() =>
                  run(
                    formatsApplyAction,
                    `${DOC_FORMAT_PREFIX}${bundleKey(entry)}`,
                  )
                }
              >
                {bundleFace(entry)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}
