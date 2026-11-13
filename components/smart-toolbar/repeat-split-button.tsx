"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { useId, useState, useSyncExternalStore } from "react";

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
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { Enabled } from "@/lib/editor-actions/types";
import {
  DOC_FORMAT_PREFIX,
  formatsApplyAction,
  formatsSaveAction,
  repeatApplyAction,
  repeatCopyAction,
} from "@/lib/editor-actions/v11-actions";
import { computeContext } from "@/lib/editor-context/snapshot";
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
  const [canSave, setCanSave] = useState<Enabled>(true);
  const describedBy = useId();
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
          aria-label={`Repeat ${bundleFace(bundle)}`}
          aria-describedby={describedBy}
          tooltip="Repeat formatting"
          className="min-h-6 min-w-6 gap-1 px-1.5"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run(repeatApplyAction)}
        >
          <RepeatIcon className="tiptap-button-icon" aria-hidden="true" />
          <span className="text-xs">{bundleFace(bundle)}</span>
          <span id={describedBy} hidden>
            {bundleLabel(bundle)}
          </span>
        </ToolbarButton>
      ) : null}
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) return;
          setInDoc(scanDocFormats(editor.state.doc).bundles);
          setCanSave(availability(formatsSaveAction, computeContext(editor)));
        }}
      >
        <DropdownMenuTrigger
          render={
            <ToolbarButton
              type="button"
              aria-label="Formats"
              aria-haspopup="menu"
              tooltip="Formats"
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
          canSave={canSave}
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
  canSave,
  run,
}: {
  editor: Editor;
  bundle: FormatBundle | null;
  saved: readonly SavedFormat[];
  inDoc: readonly FormatBundle[];
  canSave: Enabled;
  run: (action: Parameters<typeof runAction>[1], arg?: unknown) => void;
}) {
  return (
    <DropdownMenuContent align="start" className="min-w-56">
      <DropdownMenuGroup>
        {bundle ? (
          <DescribedItem
            label={`Repeat ${bundleFace(bundle)}`}
            description={bundleLabel(bundle)}
            onClick={() => run(repeatApplyAction)}
          />
        ) : null}
        <DropdownMenuItem onClick={() => run(repeatCopyAction)}>
          Copy formatting
        </DropdownMenuItem>
        <DescribedItem
          label="Save as format…"
          description={canSave === true ? undefined : canSave.reason}
          disabled={canSave !== true}
          onClick={() => openPalette(editor, "save-format")}
        />
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
              <DescribedItem
                key={bundleKey(entry)}
                label={bundleFace(entry)}
                description={bundleLabel(entry)}
                onClick={() =>
                  run(
                    formatsApplyAction,
                    `${DOC_FORMAT_PREFIX}${bundleKey(entry)}`,
                  )
                }
              />
            ))}
          </DropdownMenuGroup>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}

/**
 * A menu item whose accessible name is its visible text (WCAG 2.5.3) and
 * whose long form ("Bold, Red text") or unavailable reason is its
 * description, so screen readers never read only "B dot I".
 */
function DescribedItem({
  label,
  description,
  disabled,
  onClick,
}: {
  label: string;
  description?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const id = useId();
  return (
    <DropdownMenuItem
      disabled={disabled}
      aria-describedby={description ? id : undefined}
      onClick={onClick}
    >
      {label}
      {description ? (
        <span id={id} hidden>
          {description}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
