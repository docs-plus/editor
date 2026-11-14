# Smart toolbar design pass (PR E surfaces)

**Status:** decided by the owner on 2026-11-13. This spec merges a UI design review and a UX design review of the PR E surfaces, which shipped with code and accessibility reviews but no design review. The owner chose **Paint format** for the selection bubble. It amends spec §4 (surfaces), §5 M7 and M14 (Repeat and formats), and Appendix A (palette). This document is self-contained.

**Evidence:** the screenshots are in the session scratchpad: `shots/` (UI review) and `a11y/shots/`. The owner's screenshot showed the bubble's Repeat face as "↻ B · Yellow", with the text running under its own chevron.

## Principles

1. **No changing text in toolbar buttons.** A face never spells out a bundle ("B · Yellow"). Show the outcome visually or in the tooltip.
2. **One visible concept per job.** Writers know Google Docs' *Paint format* and Word's *Format Painter*. Repeat is the keyboard-and-palette power feature, as Word's F4 is.
3. **Sighted feedback.** Every action that changes nothing visible, or fails, shows a short status pill. The `announce()` live region stays for screen readers.
4. **Loading is not a state the user sees.** Queue clicks and keys until the engine lands, as the Repeat key already does. Show only a real failure.
5. **Constraints:**
   - The toolbar must not shift.
   - Touch targets are ≥ 44 px on phone and ≥ 24 px on desktop.
   - Contrast is ≥ 4.5:1 for text and ≥ 3:1 for UI.
   - Editor-chunk budget: no raise (A12, 23.5 KB). New surfaces are lazy; prefer CSS.

## 1. Selection bubble (desktop)

**Layout:**

```
┌──────────────────────────────────┐
│  B   I   U  │  A▁ ▾ │  🔗  │  🖌  │
└──────────────────────────────────┘
```

- Remove the Repeat split button (`RepeatSplitButton`'s face and chevron) and the Formats menu from the bubble.
- Add a `ToolbarSeparator` before the brush.

**Paint format button:**
- Icon: lucide `Paintbrush`, from `lib/icons.tsx`.
- Size: 28×28, or 44×44 on a coarse pointer.
- Accessible name: "Paint format".
- Tooltip: "Paint format", with the hint "Select text after clicking · Esc to cancel".
- `aria-pressed` reflects the armed state.

## 2. Paint format (replaces Copy formatting)

**Arm.** Any of these arms it:
- a click on the brush;
- the palette entry "Paint format";
- ⋯ → "Paint format".

Arming reads `readBundleAt(state)` at the selection or the caret, so plain text picks up "plain" as in Docs. It becomes the remembered (Repeat) bundle only once it is applied: arming and cancelling leaves Repeat as it was.

**Armed state:**
- The brush shows pressed (the 12×2 bar).
- The editor gets `.is-painting { cursor: copy }`.
- Pill: "Select text to paint · Esc to cancel".
- Live region: "Picked up Bold, Yellow highlight. Select text to apply."

**Apply:**
- **Mouse:** the next pointer-up that ends a non-empty selection applies the bundle (`applyFormatBundle`: one undo step, sets marks and never toggles), then disarms. Pill: "Formatting applied" for 2 s.
- **Keyboard:** select with Shift+arrows, then press ⌘⌥V (Ctrl+Alt+V or F4 elsewhere), or activate the brush again via Alt+F10.
- **Touch:** tap the brush, select text, then tap the brush again to apply. Pill: "Select text, then tap the brush again". Never auto-apply when the handles settle.

**Cancel:** any of these disarms without applying:
- Esc;
- a second click on the brush with no new selection;
- a document switch;
- the document becoming read-only.

**Out of scope:** the multi-use lock (Word's double-click).

## 3. Repeat formatting (keyboard and palette only)

- **The bundle:** it fills from the writer's formatting of a selection, or from Paint format. No face shows it anywhere.
- **Keys:** ⌘⌥V on macOS; Ctrl+Alt+V and F4 elsewhere.
- **Palette entry:** labelled "Repeat formatting". Its secondary line is the long label ("Bold, Yellow highlight"), built from set fields only, so it never says "default size". A bundle that only clears (painted from plain text) reads "Plain (removes formatting)". The shortcut sits on the right. It comes first under Format, and under "Suggested here" when a bundle exists, unless that bundle is plain.
- **Nothing remembered:** the key shows the pill and announces "Nothing to repeat yet. Format some text or use Paint format." The palette entry is disabled with that reason.
- **Unavailable** (empty selection, code, size in a heading): the pill shows the existing reason.
- **After use:** pill "Repeated Bold, Yellow highlight".
- **Retire** `bundleFace` short notation ("B · I · Red · L") as UI text everywhere.

## 4. Saved formats live in the style dropdown

Items after the text styles, a separator, then the "Your formats" label:

- **Each saved format:** a `menuitem` whose name is rendered in its own formatting (a CSS preview: weight, style, decoration, token colour, highlight fill, size). Its description is the long label. Applying it is one undo step.
- **"Save selection as format…":** opens the Save dialog (§7). When the selection has nothing to save, it's disabled with "Select formatted text to save it".
- **"Remove a format ▸":** shown only when at least one format exists. Its submenu lists the names; choosing one removes it at once, and the pill shows "Removed ‘X’" with an **Undo** action for 5 s. Five seconds is short for keyboard and screen reader users, so until the next removal, a restore or a reload the Alt+/ palette also offers **"Restore ‘X’"** first under Suggested here (with the format's chip), and nowhere else. It puts the format back where it was and announces "Restored ‘X’". When it cannot run it stays listed with why: "‘X’ is in Your formats already." (the name was saved again) or the 20-format cap reason. It is never kept in Recent.

Also:
- Remove "Repeat formatting: …" and "Copy formatting" from any dropdown.
- Cut "In this doc" from menus. The passive swatch dots stay.
- The rendering must not grow the eager editor chunk past the budget. Load the formats section lazily with the dropdown's content if needed.

## 5. Status pill (desktop and phone)

**Behaviour:**
- One per editor. Non-modal and never takes focus.
- It carries the same text as the `announce()` call; `announce()` stays the screen-reader channel.
- It closes after 2.5 s, or 5 s when it has an action. It stays open while hovered or focused (WCAG 1.4.13), and Esc closes it, except while Paint format is armed: then only Esc in the text closes it, because that Esc also cancels painting (Esc on a toolbar item only returns to the text, §2).
- Forced colours: system colours.

**Placement:**
- **Desktop:** 8 px under the sticky row, centred over the page column. When that would cover the open selection bubble (near the top of the page), it goes 8 px right of the bubble, level with it, when that fits the viewport, else 8 px below it, so the armed brush stays clickable.
- **Phone:** a sibling of the bar's scroller, never inside a masked element: `absolute inset-x-2 bottom-[calc(100%+8px)] z-50`. The presence and Privacy footer chips sit below the bar layer, and hide while the docked selection bar shows. While the Aa sheet is open the pill sits 8 px above the sheet's top edge.

**Style:**

```
rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md
animate-in fade-in-0 slide-in-from-bottom-1 duration-150   (none under reduced motion)
```

- Icon: `Info` for reasons and `Check` for confirmations, `size-4 text-muted-foreground`.
- Optional action button: `variant="ghost" size="xs"` (Undo, Retry).

**Used for:**
- Paint format pick-up and apply;
- Repeat, done or its reason;
- save, replace and remove (remove carries Undo);
- failures, e.g. "Couldn’t load formatting tools." with Retry.

## 6. Phone

**Selection bar.** No horizontal scroll:

```
B  I  U  A▁  ✎▁  🔗  🖌  ✕
```

- 8 × 44 px = 352 px.
- Below 360 px, U moves to the Aa sheet (7 cells).
- Strike, Clear formatting, Your formats and "Save selection as format…" live in the Aa sheet.
- Remove the Repeat cell and the Formats cell.
- ✕ ("Back to all tools") has a left divider, `shadow-[-1px_0_0_var(--border)]`.
- Colour cells show a 12×3 px bar in the remembered colour, as the desktop split does.

**Redo:** below 404 px it lives in the Aa sheet at all times, so the context slot cell never shifts other cells. Undo stays on the bar.

**Context slot cell:**
- It shows a kind icon (Heading, CodeXml, Table2, Image) plus a 12 px chevron.
- The code menu gets a "Language" label, a separator after "Copy code", and a checked state on the current language. Check language aliases: `js` must check JavaScript.

**Aa sheet:**
- Section headings are 0.875 rem / 600 / foreground.
- Row labels (Recent, Text colour, Highlight) are 0.75 rem / 500 / muted.
- The swatch grid is `repeat(auto-fill, minmax(44px, 1fr))` with a 6 px gap.
- No tooltip pops when the sheet opens.
- It adds a "Your formats" section with the same previews as §4, plus "Save selection as format…".
  - The formats fill the two-column grid. "Save selection as format…", the "Remove a format" toggle and the Remove list span its full width, below the formats, so a long label never widens the sheet (no sideways scroll at 320 px). Labels truncate with an ellipsis.
  - The Remove list is a grid of its own under the toggle, inset (`ps-3`), never between the apply buttons.
  - A disabled control's reason is a visible `text-xs text-muted-foreground` line under it (phones have no tooltips, §10): one line under the formats when none can apply, one under Save.

**Touch:**
- No tooltips on a coarse pointer (`[data-slot="tooltip-content"] { display:none }` under `(pointer: coarse)`); the pill replaces them.
- Shortcut glyphs are hidden on a coarse pointer.
- A focused cell inside a scroller uses `outline-offset: -2px`.

## 7. Save selection as format dialog

- **Title:** "Save selection as format".
- **Description:** "Reuse this style anywhere. Saved on this device."
- **Preview box above the name:** `flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm`, holding "Sample text" rendered in the format plus its long label.
- **Name field:**
  - Starts empty, with placeholder "e.g. Warning" and the visible hint "Up to 40 characters".
  - Save is disabled until the name is non-blank.
  - Saving over an existing name shows an inline note first: "Replaces your format ‘Warning’."
- **At 20 formats:** "You can keep up to 20 formats. Remove one first.", with a link button that opens "Remove a format ▸".
- **On save:** the pill and announcement say "Saved format ‘Warning’", and focus returns to the editor with the selection.

## 8. Action palette (Alt+/)

**Groups for an empty query:** Recent (≤ 5, hidden when empty), Suggested here (≤ 4), Format, Insert, Section, View, History.
- An action shown under Suggested here does not repeat in its home group.
- Disabled entries sort to the bottom of their group.

**Rows:**
- A leading `size-4` slot holds the registry icon, or a format chip for colour and format rows.
- Single-line rows are 32 px; rows with a reason are 48 px.

**Labels:**
- Drop repeated nouns: "Orange text", not "Text colour: Orange text".
- Format rows go in a "Your formats" group, labelled by name.

**Unavailable rows:**
- The label stays at foreground.
- The reason is `text-xs text-muted-foreground`, or `text-foreground/70` when selected (≥ 7:1 on `--accent`).
- No shortcut glyph.

**Selected row bar:** `bg-focus-ring`.

**Format group order:** Repeat formatting, Paint format, then the formats.

**Shortcuts:**
- One formatter (`formatKeyCombo`) everywhere: palette, menus, tooltips.
- On macOS a tooltip shows one `<kbd>` "⌘⌥V", with no " + ".

**Load failure:** pill "Couldn’t open actions. Check your connection and try again." Never stay silent.

## 9. Insert ▸ Diagram

- **One row, "Diagram ▸":** a standard submenu with Flowchart (Network), Sequence (ArrowRightLeft), State (CircleDot), Mind map (Brain) and Pie chart (ChartPie).
  - The last used template is focused first, with a "Last used" note (`ms-auto ps-3 text-xs text-muted-foreground`).
  - There is no separate "▸" tile. Hovering or pressing Enter on Diagram opens the submenu.
- **Positioning:** anchor the submenu to the row so a collision flips it fully to the left of the menu, never over its own rows.
- **All items disabled** (caret in a diagram or the title): one top note replaces the per-row reasons. For example: "Can't insert inside a diagram. Move the cursor to a paragraph."

## 10. Menus: visible disabled reasons

- A disabled item shows its reason as a visible second line, `block text-xs text-muted-foreground`.
- Only the label dims: `group-data-disabled:opacity-50` on the label, with the item itself at opacity 100. The label is an element of its own, so a bare-text label dims too.
- The reason is read once, as the description: it is `aria-hidden` inside the item, so the name taken from content is the label alone (no `aria-labelledby`, which axe's label-content-name-mismatch flags while the reason shows).
- `title`-only and sr-only-only reasons are retired.

## 11. Colour popover: low contrast

- Remove `opacity: .6` from flagged swatches.
- Keep `border-style: dotted` with `border-color: color-mix(in srgb, var(--foreground) 60%, transparent)`. That is ≥ 5:1 in both themes.
- The note is one line naming the colour: "Dotted: hard to read with Red text".

## 12. "Couldn't load" hint

```
ⓘ  Couldn’t load colours.    [ Retry ]
```

- Layout: `flex items-center gap-2 text-sm`, with no padding of its own: the popover around it has it.
- Icon: `CircleAlert`, muted, not red.
- The text names the surface: colours, or the table picker.
- Retry resets the boundary; `lazySurface` already swapped in a fresh `lazy()`.

## Removed

- The bubble's Repeat face, Formats chevron and Formats menu.
- The phone Repeat and Formats cells.
- Phone horizontal scroll and edge fades.
- "Copy formatting" as a separate item (it becomes "Paint format"; "copy formatting" and "format painter" stay as palette keywords).
- "In this doc" in menus.
- Inline trash and "Remove?" rows in menus.
- The visible "Formatting tools are still loading." reason.
- `bundleFace` short notation as UI text.
- Redo moving with the slot cell.
- The separate Diagram "▸" tile.
