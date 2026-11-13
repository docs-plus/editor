"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import {
  type ReactElement,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
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
import { useActionView } from "@/hooks/use-editor-context";
import { announce } from "@/lib/announce";
import { scanDocFormats } from "@/lib/doc-format-scan";
import {
  ariaKeyShortcuts,
  toShortcutKeys,
} from "@/lib/editor-actions/key-combo";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { AnyAction, Enabled } from "@/lib/editor-actions/types";
import {
  DOC_FORMAT_PREFIX,
  formatsApplyAction,
  formatsSaveAction,
  repeatApplyAction,
  repeatCopyAction,
} from "@/lib/editor-actions/v11-actions";
import { useV11EngineReady } from "@/lib/editor-actions/v11-engine-ready";
import { getEditorContextStore } from "@/lib/editor-context/store";
import { ChevronDownIcon, RepeatIcon, TrashIcon } from "@/lib/icons";
import {
  readSavedFormats,
  removeFormat,
  type SavedFormat,
  subscribeSavedFormats,
} from "@/lib/saved-formats";
import { isMac } from "@/lib/shortcuts";

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
 * Repeat's key for display and for `aria-keyshortcuts`: Mod+Alt+V, plus
 * F4 off macOS (where F4 is a system key), as the extension binds them.
 */
export function repeatShortcut(): { keys: string; aria: string } {
  const shortcut = repeatApplyAction.shortcut ?? "Mod-Alt-v";
  const mac = isMac();
  const aria = ariaKeyShortcuts(shortcut, mac);
  return { keys: toShortcutKeys(shortcut), aria: mac ? aria : `${aria} F4` };
}

/**
 * The Repeat name: what it repeats, spelled out ("Repeat Bold, Italic");
 * the compact face ("B · I") stays the visible text.
 */
export const repeatName = (bundle: FormatBundle | null) =>
  bundle ? `Repeat ${bundleLabel(bundle)}` : repeatApplyAction.label;

/**
 * Live availability of an E action. Re-renders on view changes (the
 * snapshot moved), on bundle changes (`repeat.apply` reads the remembered
 * bundle, a documented external read) and when the lazy engine lands.
 */
export function useEAction(action: AnyAction, editor: Editor): Enabled {
  useActionView(action.id, editor);
  useRememberedBundle();
  useV11EngineReady();
  return availability(action, getEditorContextStore(editor).getContext());
}

const reasonOf = (enabled: Enabled) =>
  enabled === true ? undefined : enabled.reason;

/**
 * ↻ Repeat formatting split (M7): the face names the bundle and repeats it;
 * the chevron opens the Formats menu (Repeat, Copy formatting, Save as
 * format…, Your formats M14 with Remove, In this doc M12). Every item runs
 * a registry action and shows its unavailable reason. Rendered by D2's
 * bubble; nothing without a bundle or saved format.
 *
 * The action bodies live in E's lazy engine, reached only through the
 * registry (never imported here, so this chunk carries no copy). Until it
 * lands, the actions report "Formatting tools are still loading.".
 */
export function RepeatSplitButton({ editor: provided }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = provided ?? contextEditor ?? null;
  const bundle = useRememberedBundle();
  const saved = useSavedFormats();
  if (!editor || (!bundle && saved.length === 0)) return null;
  return (
    <div className="flex items-center" data-repeat-split="">
      {bundle ? <RepeatFace editor={editor} bundle={bundle} /> : null}
      <FormatsMenu
        editor={editor}
        trigger={
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
      </FormatsMenu>
    </div>
  );
}

function RepeatFace({
  editor,
  bundle,
}: {
  editor: Editor;
  bundle: FormatBundle;
}) {
  const reason = reasonOf(useEAction(repeatApplyAction, editor));
  const shortcut = useMemo(() => repeatShortcut(), []);
  return (
    <ToolbarButton
      type="button"
      size="sm"
      data-action-id={repeatApplyAction.id}
      aria-label={repeatName(bundle)}
      aria-keyshortcuts={shortcut.aria}
      tooltip="Repeat formatting"
      shortcutKeys={shortcut.keys}
      className="min-h-6 min-w-6 gap-1 px-1.5"
      disabled={reason !== undefined}
      disabledReason={reason}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => runAction(editor, repeatApplyAction)}
    >
      <RepeatIcon className="tiptap-button-icon" aria-hidden="true" />
      <span className="max-w-[10ch] truncate text-xs">
        {bundleFace(bundle)}
      </span>
    </ToolbarButton>
  );
}

/**
 * The Formats menu behind `trigger` (the bubble's chevron, the phone's
 * Formats cell). The doc scan runs when it opens; availability is read at
 * render while open, so a late engine turns "still loading" into the real
 * answer without reopening.
 */
export function FormatsMenu({
  editor,
  trigger,
  children,
  side,
}: {
  editor: Editor;
  trigger: ReactElement;
  children?: React.ReactNode;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const [inDoc, setInDoc] = useState<readonly FormatBundle[]>([]);
  return (
    <DropdownMenu
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setInDoc(scanDocFormats(editor.state.doc).bundles);
      }}
    >
      <DropdownMenuTrigger render={trigger}>{children}</DropdownMenuTrigger>
      {open ? (
        <FormatsMenuContent editor={editor} inDoc={inDoc} side={side} />
      ) : null}
    </DropdownMenu>
  );
}

function FormatsMenuContent({
  editor,
  inDoc,
  side,
}: {
  editor: Editor;
  inDoc: readonly FormatBundle[];
  side?: "top" | "bottom";
}) {
  const bundle = useRememberedBundle();
  const saved = useSavedFormats();
  const repeat = reasonOf(useEAction(repeatApplyAction, editor));
  const copy = reasonOf(useEAction(repeatCopyAction, editor));
  const save = reasonOf(useEAction(formatsSaveAction, editor));
  const apply = reasonOf(useEAction(formatsApplyAction, editor));
  const shortcut = useMemo(() => repeatShortcut(), []);
  const run = (action: AnyAction, arg?: unknown) => {
    runAction(editor, action, arg);
  };
  return (
    <DropdownMenuContent align="start" side={side} className="min-w-56">
      <DropdownMenuGroup>
        {bundle ? (
          <DescribedItem
            label={`Repeat ${bundleFace(bundle)}`}
            description={repeat ?? bundleLabel(bundle)}
            disabled={repeat !== undefined}
            aria-keyshortcuts={shortcut.aria}
            onClick={() => run(repeatApplyAction)}
          >
            <DropdownMenuShortcut aria-hidden="true">
              {formatShortcut(shortcut.keys)}
            </DropdownMenuShortcut>
          </DescribedItem>
        ) : null}
        <DescribedItem
          label="Copy formatting"
          description={copy}
          disabled={copy !== undefined}
          onClick={() => run(repeatCopyAction)}
        />
        <DescribedItem
          label="Save as format…"
          description={save}
          disabled={save !== undefined}
          onClick={() => openPalette(editor, "save-format")}
        />
      </DropdownMenuGroup>
      {saved.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Your formats</DropdownMenuLabel>
            {saved.map((format) => (
              <SavedFormatRow
                key={format.id}
                format={format}
                reason={apply}
                onApply={() => run(formatsApplyAction, format.id)}
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
                description={apply ?? bundleLabel(entry)}
                disabled={apply !== undefined}
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

/** "mod+alt+v" → "⌘⌥V" / "Ctrl+Alt+V", like the toolbar tooltips. */
function formatShortcut(keys: string): string {
  const mac = isMac();
  const names: Record<string, string> = mac
    ? { mod: "⌘", alt: "⌥", shift: "⇧" }
    : { mod: "Ctrl", alt: "Alt", shift: "Shift" };
  return keys
    .split("+")
    .map((part) => names[part] ?? part.toUpperCase())
    .join(mac ? "" : "+");
}

/**
 * A saved format: apply it, or remove it (the cap reason asks for that).
 * Remove asks once more in place ("Remove ‘X’?") before it removes, keeps
 * the menu open for that, and announces the removal.
 */
function SavedFormatRow({
  format,
  reason,
  onApply,
}: {
  format: SavedFormat;
  reason: string | undefined;
  onApply: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center gap-0.5" data-saved-format="">
      <DescribedItem
        label={format.name}
        description={reason}
        disabled={reason !== undefined}
        className="flex-1"
        onClick={onApply}
      />
      <DropdownMenuItem
        variant="destructive"
        closeOnClick={confirming}
        aria-label={
          confirming
            ? `Confirm: remove format ‘${format.name}’`
            : `Remove format ‘${format.name}’`
        }
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          removeFormat(format.id);
          announce(`Removed format ‘${format.name}’`);
        }}
        onBlur={() => setConfirming(false)}
      >
        <TrashIcon aria-hidden="true" />
        {confirming ? <span className="text-xs">Remove?</span> : null}
      </DropdownMenuItem>
    </div>
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
  className,
  onClick,
  children,
  "aria-keyshortcuts": ariaKeyShortcutsValue,
}: {
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children?: React.ReactNode;
  "aria-keyshortcuts"?: string;
}) {
  const id = useId();
  return (
    <DropdownMenuItem
      disabled={disabled}
      className={className}
      aria-describedby={description ? id : undefined}
      aria-keyshortcuts={ariaKeyShortcutsValue}
      onClick={onClick}
    >
      {label}
      {children}
      {description ? (
        <span id={id} hidden>
          {description}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
