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
import { useRememberedBundle } from "@/extensions/repeat-formatting/bundle-memory";
import { scanDocFormats } from "@/lib/doc-format-scan";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { Enabled } from "@/lib/editor-actions/types";
import {
  DOC_FORMAT_PREFIX,
  ENGINE_LOADING_REASON,
  formatsApplyAction,
  formatsSaveAction,
  repeatApplyAction,
  repeatCopyAction,
} from "@/lib/editor-actions/v11-actions";
import { useV11EngineReady } from "@/lib/editor-actions/v11-engine-ready";
import { computeContext } from "@/lib/editor-context/snapshot";
import { ChevronDownIcon, RepeatIcon } from "@/lib/icons";
import {
  readSavedFormats,
  type SavedFormat,
  subscribeSavedFormats,
} from "@/lib/saved-formats";

import { openPalette } from "./palette/palette-store";
import type { SurfaceProps } from "./types";

const EMPTY: readonly SavedFormat[] = [];
const getNoFormats = () => EMPTY;

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
 *
 * The action bodies live in E's lazy engine, reached only through the
 * registry (never imported here, so this chunk carries no copy). A bundle
 * or saved format can come from storage before the engine lands: until
 * then the face and the action items are disabled with
 * `ENGINE_LOADING_REASON`, and they enable once it lands.
 */
export function RepeatSplitButton({ editor: provided }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = provided ?? contextEditor ?? null;
  const bundle = useRememberedBundle();
  const saved = useSavedFormats();
  const ready = useV11EngineReady();
  const [open, setOpen] = useState(false);
  const [inDoc, setInDoc] = useState<readonly FormatBundle[]>([]);
  const describedBy = useId();
  if (!editor || (!bundle && saved.length === 0)) return null;

  // Read while the menu is open, so a late engine turns "still loading"
  // into the real answer without reopening.
  const canSave: Enabled = open
    ? availability(formatsSaveAction, computeContext(editor))
    : true;

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
          disabled={!ready}
          disabledReason={ENGINE_LOADING_REASON}
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
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setInDoc(scanDocFormats(editor.state.doc).bundles);
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
          ready={ready}
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
  ready,
  run,
}: {
  editor: Editor;
  bundle: FormatBundle | null;
  saved: readonly SavedFormat[];
  inDoc: readonly FormatBundle[];
  canSave: Enabled;
  ready: boolean;
  run: (action: Parameters<typeof runAction>[1], arg?: unknown) => void;
}) {
  // Until E's engine lands, every action item says why it does nothing.
  const loading = ready ? undefined : ENGINE_LOADING_REASON;
  return (
    <DropdownMenuContent align="start" className="min-w-56">
      <DropdownMenuGroup>
        {bundle ? (
          <DescribedItem
            label={`Repeat ${bundleFace(bundle)}`}
            description={loading ?? bundleLabel(bundle)}
            disabled={!ready}
            onClick={() => run(repeatApplyAction)}
          />
        ) : null}
        <DescribedItem
          label="Copy formatting"
          description={loading}
          disabled={!ready}
          onClick={() => run(repeatCopyAction)}
        />
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
              <DescribedItem
                key={format.id}
                label={format.name}
                description={loading}
                disabled={!ready}
                onClick={() => run(formatsApplyAction, format.id)}
              />
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
                description={loading ?? bundleLabel(entry)}
                disabled={!ready}
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
