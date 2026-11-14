# Changelog

All notable changes to TinyDocy. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). TinyDocy is deployed
continuously from `main`, so entries are grouped by merged pull request rather
than by version number. Each entry lists anything an operator has to do when
deploying it. Tagged releases (`vX.Y.Z`, from v0.1.0) bundle the entries merged
since the previous tag.

## [Unreleased]

### WebKit compatibility pass

A `webkit` Playwright project runs the core editing specs in Safari's
engine (by hand; CI still runs Chromium only), and the Safari bugs it
found are fixed. No schema or protocol change; no Deploy note. The editor
chunk grows by 1 B, to +19,284 B of the 23.5 KB budget (4,780 B left);
the palette's first Alt+/ is untouched.

#### Added
- `bun playwright test --project=webkit` (after
  `bun playwright install webkit`): toolbar, selection bubble, Paint
  format, palette, "/" menu, Continue chip, hover preview, phone bar,
  collaboration and leak specs. Tests that need Chromium's DevTools
  protocol (heap and listener counts, raw touch drags, CPU throttling) or
  forced colours skip there; `tests/TESTING.md` lists what WebKit does
  differently.

#### Fixed
- Safari: the selection bubble could open on top of the selected line
  instead of above it, so a drag over the next words hit the bubble and
  Paint format never applied. Safari keeps a loaded stylesheet inactive
  while another one is still loading, so the bubble was placed before its
  lazy stylesheet made the scroll container its containing block, then
  dropped 38px when it did. That rule now lives with the container's own
  styles.
- Safari: the code language select in the phone's Aa sheet (below 360px)
  was 22px tall; it is 44px, like every other target there.
- Safari: Back (✕) on the phone's selection cells, pressed from the
  keyboard, left focus on Insert instead of the bar's first cell: WebKit
  fires no `focusout` for the removed button, so the toolbar's own focus
  repair ran first.

### The outline follows a heading jump

The editor chunk goes from +19,283 B to +19,355 B of the 23.5 KB budget
(+72 B); nothing to do when deploying. Headings themselves land where they
did: the editor's scroll area already keeps jump targets clear of the
toolbar (`scroll-padding-top`, measured flush under it at 800 to 1440 px),
and a heading `scroll-margin-top` on top of it would land them 44 px lower
and make the outline mark the heading before as active. Whether the
outline centres or tops its heading is unchanged.

#### Fixed
- After a jump (an outline pick, the Continue chip's Go) or a scroll, the
  outline now keeps the active heading's row in view (as
  `block: "nearest"`). Go to Section 45 of a long document used to leave
  the outline showing Sections 1 to 25. Only the outline's own box
  scrolls: `scrollIntoView` would also move the page the jump has just
  positioned. A drag, or the drop that ends it, never scrolls it.
- The docked outline stuck 16 px from the top of the scroll area, so its
  top 28 px (the "Outline" header, or the active row) sat under the
  sticky toolbar once the page scrolled. It now sticks right below the
  toolbar (`--tt-toolbar-height`), where it already starts.

### Colour popover keeps clear of the selection

The editor chunk goes from +19,283 B to +19,381 B of the 23.5 KB budget
(4,683 B left; the avoidance itself is in the lazy colour chunk), and the
first Alt+/ palette load is unchanged; nothing to do when deploying.

#### Fixed
- The text colour and highlight popovers, opened from the toolbar row with
  the page at the top, covered the first lines of the document, hiding the
  very words the hover preview colours. The popover now keeps off the
  selection: it slides along the row while it still spans its button, or
  else opens just below the selected lines, still under its button.
  Keyboard focus, the selection bubble's popover and the phone's Aa sheet
  are unchanged.

### Accurate "Default text" and "No highlight" previews

No change to the editor chunk (the rules load with the colour popover);
nothing to do when deploying.

#### Fixed
- Hovering "Default text" or "No highlight" now previews exactly what
  applying gives over links, inline code and table header cells. The
  preview used to paint the page's text colour and background, so a
  coloured link previewed black instead of link blue, inline code lost
  its grey box and colour, and a highlighted header cell lost its tint.
  Inside the mark it previews away, the preview now reads what is under
  that mark (the page, a link's colour, or the header tint over the
  page); elsewhere it lets the context's own colours show through.

### Previewed colours stay true under the phone sheet

In the lazy phone bar and colour chunks: the editor chunk and the
palette's first Alt+/ chunk are unchanged; nothing to do when deploying.

#### Fixed
- On a narrow window with a mouse, the "Text format" sheet's scrim dimmed
  the document, so a colour previewed by hovering a swatch showed darker
  than applying it would. While a preview shows, the scrim now fades
  clear (it still catches taps) and comes back when the preview ends.
  Touch never previews, so its scrim is unchanged.
- Opening that sheet with a mouse could preview a colour nobody pointed
  at: the swatch that slid up past the still pointer kept the hover, so
  its colour showed on the selection and the scrim cleared. A swatch now
  previews only once the mouse moves over it.

### Colour preview from the keyboard on touch devices

The editor chunk is unchanged (+19,281 B of the 23.5 KB budget; the
change is in the lazy colour chunk) and the first Alt+/ chunk is
unchanged; nothing to do when deploying.

#### Fixed
- On a touch-first device (`pointer: coarse`), such as an iPad or an
  Android tablet with a hardware keyboard, arrowing through the colour
  swatches showed no preview: the preview was gated as a whole on a fine
  hovering pointer. Arrow keys now preview there as on a desktop, while a
  tap, or a pointer such as an iPad trackpad, still previews nothing and
  does not clear the keyboard's preview. Forced colours and
  `NEXT_PUBLIC_ACTION_PREVIEW=0` still turn previews off everywhere.

### Clear marker on the previewed colour swatch

The editor chunk does not grow (the change is in the lazy colour panel);
nothing to do when deploying.

#### Fixed
- In the colour popover the swatch under the mouse, the one previewed on
  the selection, only darkened its border, while a mouse-opened popover
  put its full focus ring on the pressed swatch, so the ring pointed at
  the wrong colour. The swatch under a mouse or pen now wears the focus
  ring (Highlight in forced colours, with or without a preview), and
  keyboard focus on another swatch steps down to a dashed 1px ring until
  an arrow key hands the ring back. Touch shows no marker; the Aa sheet's
  colours behave the same.

### "/" menu says why a pick was refused

The editor chunk goes from +19,283 B to +19,270 B of the 23.5 KB budget
(4,794 B left); the "/" menu chunk grows by 50 B gz (5,341 B of 6 KB) and
the first Alt+/ not at all; nothing to do when deploying.

#### Fixed
- A "/" menu row whose block could no longer go there (the document
  changed after the menu opened, for example a collaborator wrapped the
  line in a quote) closed the menu and did nothing, without a word. The
  status pill, and the screen reader, now say why, in the menu's own
  words ("Quote: Already in a quote."), and "/quo" stays as typed. A
  pick that was allowed but did nothing still says nothing.

### Home, End, Page Up and Page Down in the "/" menu

The code is in the lazy slash chunk only (5,509 B gz of its 6 KB budget);
the editor chunk is unchanged (+19,282 B of the 23.5 KB budget) and the
palette chunk is untouched; nothing to do when deploying.

#### Added
- The open "/" menu takes Home and End (first and last option) and Page Up
  and Page Down (the farthest option still on one screen of the list with
  the active one, never wrapping). The editor's `aria-activedescendant`
  follows, and the active option scrolls into view. Modified keys
  (Shift+End, Ctrl+Home) and every key while the menu is closed stay
  caret keys.

### Paint format keyboard test waits for the brush to arm

Test only: no app code changes, and the editor chunk is unchanged (0 B).
Nothing to do when deploying.

#### Fixed
- `paint-format.spec.ts` "activating the brush again applies to the new
  selection" failed intermittently on loaded CI runners. It clicked the
  brush and moved the selection at once. A click that lands before the
  lazy formatting engine has loaded waits for it, and is dropped if the
  selection has moved by then, as designed, so the brush never armed.
  The test now waits for the brush to show as pressed before it selects
  the next text, as the other Paint format tests do.

### Status pill stays clear of a bubble that appears later

The editor chunk is unchanged (−2 B, loader hashes); the selection bubble
and phone bar chunks, which hold the pill, grow by 136 B and 153 B gz; the
palette's first Alt+/ is byte-identical. Nothing to do when deploying.

#### Fixed
- On desktop the status pill moved beside the selection bubble only if the
  bubble was already there when the notice showed. A bubble that appeared
  or moved afterwards (a new selection, a scroll) could sit under the pill,
  covering the brush. While it shows, the pill now places itself again,
  at most once a frame, whenever the bubble appears, moves, closes or
  scrolls, and goes back under the row's centre once the bubble is gone.
  Its observers stop when it closes.

### Restore a removed format from the phone sheet

The editor chunk goes from +19,283 B to +19,296 B of the 23.5 KB budget
(13 B: one more export of the eager actions module); the code is in the
lazy phone bar chunk (+142 B gz) and the first Alt+/ chunk is unchanged.
Nothing to do when deploying.

#### Added
- On phones, the Aa sheet's Your formats offers "Restore ‘X’" for the
  last removed format, until the next removal, a restore or a reload.
  Phones have no Alt+/ palette, so the status pill's 5-second Undo was
  the only way back. It runs the same `formats.restore` action as the
  palette: it puts the format back where it was, keeps the sheet open
  and, when it cannot run (the name was saved again, or the 20-format
  cap), says why on a visible line. Full width, 44 px tall, no sideways
  scroll at 320 px.

### One label for saving a format

The editor chunk goes from +19,283 B to +19,284 B of the 23.5 KB budget
(4,780 B left); the first Alt+/ palette chunks stay at 20,475 B. Nothing to
do when deploying.

#### Changed
- Saving a format is called "Save selection as format…" everywhere: the
  Alt+/ palette said "Save as format…" while the text style dropdown and the
  phone's Aa sheet said "Save selection as format…". The save view's title is
  now "Save selection as format" too. The dropdown and the sheet read the
  label from the `formats.save` action, so the three can no longer drift
  apart. Typing "save as format" in the palette still finds it.

### Align items with icons and shortcuts

Menu chunk only: the editor chunk and the first Alt+/ palette load are
unchanged; nothing to do when deploying.

#### Changed
- The four align items in Align ▾ and in the T3 ¶ (Paragraph) menu now
  show their icons and shortcuts (Mod+Shift+L, E, R, J), like Outdent and
  Indent beside them in ¶, which used to leave them as inset text. The
  radio check sits in a fixed slot before the shortcut, so every shortcut
  ends at one edge. Each item announces its keys with
  `aria-keyshortcuts`. All four keys reach the editor in Chromium
  (Mod+Shift+R does not reload and Mod+Shift+J does not open Downloads),
  and `toolbar-row.spec.ts` now checks it.
- A toolbar menu with these items grows to fit them, so "Ctrl+Shift+E"
  stays on its label's line off macOS; reason lines wrap within that
  width instead of widening the menu.

### One name for justified alignment

The editor chunk goes from +19,283 B to +19,208 B of the 23.5 KB budget
(4,856 B left); the first Alt+/ palette load is unchanged (20,475 B);
nothing to do when deploying.

#### Changed
- The Align ▾ trigger now takes its name and icon from the `align.*`
  registry action instead of its own copy of the labels, so the trigger,
  the menu items, the ¶ menu, the palette and the phone Text format sheet
  share one source: "Align left", "Align center", "Align right" and
  "Justify". The old "Align justify" tooltip wording left with the
  pre-registry text-align button; no visible wording changes.

### Trash icon on Delete row and Delete column

The editor chunk goes from +19,283 B to +19,282 B of the 23.5 KB budget
(the icon is in the lazy menu chunk); nothing to do when deploying.

#### Changed
- In the table's Row ▾ and Column ▾ menus, and in the Table tools menu
  that stands in for them on narrow windows and phones, Delete row and
  Delete column now have a trash icon and line up with the other items,
  instead of inset text with an empty icon column. The palette and the
  phone "Text format" sheet are unchanged.

### Image resize gripper survives plugin view rebuilds

The editor chunk grows by 116 B gzipped (measured +19,283 B to +19,399 B
of the 23.5 KB budget); nothing to do when deploying.

#### Fixed
- Hovering an image while a lazy chunk was still loading could hide its
  resize gripper and media toolbar at once, and a resize drag could stop
  midway. A lazy chunk that registers a plugin (the selection bubble's
  `BubbleMenu`) reconfigures the editor; ProseMirror then destroys and
  recreates every plugin view, and the destroy hooks of
  `@docs.plus/extension-hypermultimedia`'s media controls hide the active
  gripper and abort a running drag. The editor now uses
  `extensions/hyper-multimedia/`'s `HyperMultimediaKit`, which skips those
  two destroy hooks when only the plugin list changed; they still run when
  the editor is destroyed or the plugin is removed. This retires the
  "known, not fixed" note from the resize gripper test fix, and the test
  no longer waits for the bubble's plugin before hovering.

### Shared filter links apply on load

The editor chunk goes from +19,283 B to +19,294 B of the 23.5 KB budget;
nothing to do when deploying.

#### Fixed
- Opening a link with `?filter=…` never applied the heading filter: the
  filter hook wrote its empty state to the URL on its first render, before
  the editor existed, so the query was gone by the time it was read (and
  React's development remount stripped it again). The link's filter is now
  read on mount and applied after the first server sync, so it folds the
  real sections, not an empty or stale device copy. The URL keeps the
  filter until then, and mirrors it afterwards as before.
- A hand-typed filter link with a bare `%` (`?filter=50%25`) threw while
  decoding; that slug is now kept as typed.

### Outdated-client refusals without a stack trace

Server only; the editor chunk does not change. Nothing to do when deploying
beyond the usual Hocus restart.

#### Fixed
- Every refused outdated client printed a Bun code frame and stack trace to
  the Hocus error log. Hocuspocus logs a hook error whenever it has a
  `message`, and Bun's code frame ignores the emptied `.stack`. `onConnect`
  now throws a plain `{ reason: "client_outdated" }` value instead, which
  Hocuspocus still sends to the client as the refusal reason but does not
  log; refusals show up only in the per-minute `client_schema` aggregate.

### Quiet production build: quoted highlight colour keys

Build output only: the compiled CSS is byte-identical, so the editor chunk
and the first Alt+/ palette chunk do not change; no Deploy note.

#### Fixed
- `next build` printed ten Sass warnings from the document highlight rules:
  the token list held bare colour names (`gray`, `blue`, ...), which Sass
  reads as colours and warns about when interpolated into a selector. The
  names are now quoted strings, like the maps in `text-style-marks.scss`
  already were, and the build compiles without Sass warnings.

### Selection bubble brush size test tolerates sub-pixel boxes

Test only; no app, schema or protocol change; no Deploy note.

#### Fixed
- `selection-bubble.spec.ts` checked the Paint format brush's box with an
  exact `toBe(28)`, and a CI runner measured 28.000015 px. It now uses
  `toBeCloseTo(28, 1)` for the width and height.

### Menu focus after a quick second open

The editor chunk goes from +19,248 B to +19,283 B of the 23.5 KB budget
(4,781 B left); nothing to do when deploying.

#### Fixed
- A toolbar menu opened while the previous one was still animating out
  (Esc, then a click on another menu) closed again at once: when the old
  popup unmounted, Base UI moved focus back to its trigger. Toolbar menus
  and the desktop List menu now return focus to their trigger only while
  it is still lost with the closing menu, as the Insert menu's step
  already did. This turned `toolbar-ladder.spec.ts` red on slower CI
  runners.

### Continue chip phone test waits for the page to stop

Test only; no app, schema or protocol change; no Deploy note.

#### Fixed
- The 375px touch test of "Continue where you left off" tapped Go 300 ms
  after its touch pan, while the page was still coasting. On Linux,
  Chromium treats a tap that stops a coasting page as stopping the scroll
  rather than as a click, as phones do, so the chip stayed and `main`
  went red. The test now checks that the pan scrolled the page and taps
  Go once the page is at rest.

### "/" block menu

Type "/" at the start of a line, or after a space, for a short menu of
text styles, lists and Insert kinds under the caret: one more view of the
action registry, with no command of its own (plan
`docs/superpowers/plans/2026-11-13-smart-toolbar-later-slash-menu.md`,
contract amendment A17). No schema or protocol change; no Deploy note.

The editor chunk grows by 888 B, to +19,248 B of the 23.5 KB budget
(4,816 B left); the budget is unchanged. The menu is a lazy chunk
of 5,291 B gz (budget 6 KB), fetched when the browser is idle. The
palette's first Alt+/ is unchanged, file for file (403 B + 20,072 B =
20,475 B).

#### Added
- Typing "/" in a paragraph (including list items, quotes and table
  cells) at the block start or after whitespace opens a listbox under the
  caret: Text (Normal text, Heading 1–3; "/h4" finds 4–6), Lists, Insert
  (the table at its last size, shown as "3 × 3") and Diagrams (the five
  templates, the last used one noted). Typing filters by word prefix over
  labels, keywords and Markdown shortcuts ("/h2", "/##", "/quo", "/pic");
  each section shows once, best match first.
- Enter or a click applies the block and removes "/query" as one undo
  step; Esc leaves the text as typed. "/" then Enter, with nothing typed
  or arrowed, stays a line break. A match that cannot go here says why
  ("Quote: Already in a quote."); a finished word with no match closes the
  menu, as do "1 / 2", "/usr/bin" and a query over 24 characters.
- It never opens mid-word ("and/or"), in URLs, the title, headings, code,
  inline code, a read-only document or from a collaborator's typing; a
  collaborator deleting the "/" closes it.
- Focus never leaves the editor: the editor carries `aria-controls`,
  `aria-autocomplete`, `aria-haspopup` and `aria-activedescendant` while
  the menu is open, and a polite live region says "Block menu, 18
  options.", then each active row ("Table, 3 by 3, 9 of 18"). IME composition keeps its
  keys. Rows are 44 px on touch, and a tap keeps the phone keyboard; the
  list flips above the caret near the bottom, the phone bar and the
  keyboard (never apart from its caret: when content above the caret
  changes size or the keyboard opens, the caret is scrolled back into view
  first), and spans the screen below 640 px.

### Continue where you left off

Reopening a document offers a way back to the section you were in (spec
M15): a small chip above the title, "Continue where you left off ·
*Section*", with Go and ✕. No schema or protocol change; nothing to
deploy beyond the app.

The editor chunk grows by 475 B, to +17,724 B of the 23.5 KB budget
(6,340 B left); the budget is unchanged. The chip, its recorder and its
styles load as one lazy chunk (2.5 KB gz) when the browser is idle. The
palette's chunks are unchanged.

#### Added
- The place is remembered on this device only (`tinydocy-continue`: the
  section heading's id and a time, never text; 30 documents, 14 days),
  when you leave the text after choosing a place in it. A place in the
  title or the first sections is not offered. `NEXT_PUBLIC_REMEMBER_CHOICES=0`
  turns it off; "Forget my choices" keeps it, like the outline and folds.
- The chip shows after the server confirms the document (not offline, not
  in Playground, not when the heading is gone or hidden by a filter). It is
  never focused or announced and moves nothing. Go unfolds the sections
  hiding the heading, puts the caret at its end and scrolls it to the top,
  as an outline pick does. Your first click, key or typing in the
  document, Dismiss or Esc removes it until the next open; a touch scroll
  does not.
- Phones show "Continue · *Section*" above the presence chip and the bar;
  touch tablets show it at the bottom too.
- The section name is shown without control, invisible or bidi-control
  characters, so a collaborator's heading cannot spoof the chip.

#### Changed
- The outline's jump to a heading is shared with the chip
  (`lib/heading-navigation.ts`) and now scrolls without animation when you
  prefer reduced motion.

### Colour hover preview

Pointing at a text colour or highlight swatch shows it on the selected
text before you apply it (amendment A14). No schema or protocol change,
and nothing to do when deploying.

The editor chunk goes from +17,249 B to +17,464 B of the 23.5 KB budget
(+215 B; 6,600 B left); the colour popover chunk grows by 641 B gz. The
palette is unchanged.

#### Added
- Rest the mouse on a swatch for 80 ms, or move to one with the arrow
  keys, and the selection shows that colour. Moving away, Esc, closing
  the popover, applying, or your own change to the text or selection
  removes it; a collaborator's edit keeps it on your moved selection.
  Opening the popover previews nothing, and holding an arrow key waits
  for it to settle. Works in the row and bubble popovers, and in the
  Text format sheet with a mouse.
- Previews are drawn with decorations only: nothing reaches the
  document, the undo history or collaborators. They are off on touch, in
  forced colours, when read-only, for an empty selection, and over more
  than 200 blocks or 20,000 positions. `NEXT_PUBLIC_ACTION_PREVIEW=0`
  turns them off.

### Simplified toolbar

A "Simplified toolbar" setting in ⋯ (and in the Alt+/ palette) shows the
row's compact set at every width (later-phase plan "progressive
disclosure"; contract amendment A15). It is off by default, changes only
when the writer turns it on or off, and never reorders the row. No schema
or protocol change.

The editor chunk goes from +17,249 B to +17,701 B of the 23.5 KB budget
(+452 B; 6,363 B left); the budget is unchanged. The palette's first
Alt+/ is unchanged at 20,475 B gz (the palette entry costs it nothing).

#### Added
- ⋯ → Simplified toolbar (a checkbox; focus returns to ⋯) and the palette
  entry "Simplified toolbar" (keywords: compact, fewer tools, minimal,
  full toolbar). The row then shows the ladder's T4 set at any width:
  alignment and indent behind ¶, the context slot as one button, the
  colour pair as one button, Outline and Filter behind View, size as one
  menu, Insert without its label, Theme in ⋯. Every tool stays one click
  away through those stand-ins; below the T4 width the ladder applies as
  before.
- The status pill confirms each change ("Simplified toolbar on" or "Full
  toolbar on") with Undo.
- The setting is remembered in this browser (`tinydocy-ui`), survives
  "Forget my choices" and is read before the first paint, so the full row
  never flashes on load. With `NEXT_PUBLIC_REMEMBER_CHOICES=0` the item is
  disabled with "Remembering choices is turned off."
- Turning it on or off keeps the row at one Tab stop, and a stop on a tool
  it hides moves to that group's stand-in.

#### Fixed
- When the responsive ladder hides the item holding the row's Tab stop,
  the stop now moves to that group's stand-in (¶, View, colour) instead
  of whichever item is now at the same position.

### Palette leak test baseline

#### Fixed
- **Tests:** `palette-leaks.spec.ts` compares window and document listener
  counts only once two reads 1.5 s apart agree. A tab left within the last
  second keeps its provider (and that provider's `pagehide` listener) until
  `collab-session`'s deferred release, so on a slower runner the baseline
  missed one listener the after-switches read still had (101 vs 102,
  failing `main` since #37). A listener leaked per switch still fails.

### Design sign-off follow-ups

What the design sign-off of the smart toolbar design pass (#35) left
open: two narrow-phone layout fixes, a palette way back from "Remove a
format", palette polish, and an idle prefetch for cold offline starts.

The editor chunk goes from +16,680 B to +17,249 B of the 23.5 KB budget
(6,815 B left, was 7,384 B); the idle prefetch trigger is 58 B of that.
The palette's first Alt+/ loads 20,475 B gz of its 20,480 B budget (5 B
left, was 36 B); single-entry sets in `palette-sections.ts` became plain
id checks to make room. Budgets are unchanged.

#### Added
- After a saved format is removed, the Alt+/ palette offers
  "Restore ‘X’" first under Suggested here, until the next removal, a
  restore or a reload. The pill's Undo lasts 5 s, which a keyboard user
  may not reach. Restore puts the format back where it was; a row that
  cannot run says why (the name is taken again, or the 20-format cap).
  It is never kept in Recent.
- When the browser is idle after the first server sync, the app also
  fetches the formatting engine, the announcer and, on desktop, the
  selection bubble with its status pill, so the service worker has them
  and a load failure on a cold offline start is still said.

#### Changed
- Palette: Paint format and Repeat formatting show their icons
  (Paintbrush, Repeat); the ⋯ menu's Paint format shows the brush too.
  Size rows read "Extra small text" instead of "Font size: Extra small".
- Phone Aa sheet: Save's reason line sits right under "Save selection as
  format…" (about 2px, was about 13px), so the two read as one item.

#### Fixed
- On narrow phones (320px) the empty title's placeholder wraps to two
  lines and covered the first body line. It is in flow now, so the title
  grows with it; the caret still starts the first line.

### Toolbar menu alignment

Three visual inconsistencies in the toolbar menus. The layout changes sit
in the lazy menu chunk; only the list labels are in the editor chunk,
which grows by 1 B to +16,680 B of the 23.5 KB budget (7,384 B left).

#### Fixed
- Items without an icon start their text in the icon column, beside the
  items that have one: Delete row and Delete column (Row ▾, Column ▾ and
  the T3 Table tools menu), Paint format and All actions… (⋯ More
  formatting), and the four align items in the T3 ¶ menu.
- In ⋯ More formatting, the plain items keep the toggles' check column,
  so every shortcut ends at the same edge.
- The desktop List menu says "Bullet list", "Numbered list" and "Task
  list", as the phone and the action registry do, and is as wide as its
  longest label.

### Touch-tablet toolbar test flake (fix/e2e-focus-title-race)

#### Fixed
- **Tests:** `EditorPage.focusTitle()` waits for the frame in which
  Tiptap's deferred `view.focus()` runs. In a touch context on a Mac
  host, Tiptap takes the browser for iOS and focuses the editor at once,
  so the helper returned early. The late focus then pulled focus back
  from the toolbar after Alt+F10, and the touch-tablet "no tooltips"
  test in `toolbar-surfaces.spec.ts` failed about one run in three under
  three workers.

### Lazy toolbar menus

Every toolbar menu's popup and items move out of the editor chunk into one
lazy chunk (owner decision O1, the "menu bodies lazy" lead in contract A9;
amendment A13). Nothing changes for the writer.

The editor chunk goes from +23,994 B to +16,679 B of the 23.5 KB budget
(7,385 B left, was 70 B); the budget is unchanged. The palette's first
Alt+/ loads 20,444 B gz of its 20,480 B budget (36 B left, was 8 B).

#### Changed
- The triggers and Base UI's menu root stay in the editor chunk; the
  popups, positioner and items (Text style, Alignment, List, Insert, ⋯,
  the context slot's menus, the ladder stand-ins and the phone List cell)
  load as one chunk on a trigger's hover or focus, when the browser is
  idle after the first sync, or on the first open, which waits for it.
  Keys pressed while it loads are replayed into the menu, so a keyboard
  open still lands on the first item and loses no key.
- A menu whose chunk does not load says "Couldn’t open the menu." on the
  status pill, with Retry, as the palette does.

### Smart toolbar follow-ups

Minors left by the a11y review of the smart toolbar (contract §10), and
the design pass of PR E's surfaces
(`docs/superpowers/specs/2026-11-13-smart-toolbar-design-pass.md`).

The editor chunk ends at +23,994 B of the 23.5 KB budget (70 B left);
the budget is unchanged. The palette's first Alt+/ loads 20,472 B gz of
its 20,480 B budget.

#### Fixed
- Back on the phone selection bar dismisses the cells for that
  selection only.
- The Repeat extend session merges into its own bundle, not the shared
  memory another tab may have replaced (bold here plus red here no
  longer repeats as the other tab's italic plus red); "Forget my choices"
  ends the session.
- Saved formats stay fresh across tabs with no component mounted (the
  palette no longer lists or applies a format another tab deleted).
- Format names also lose the soft hyphen, the Arabic letter mark, the
  word joiner and the invisible operators.
- Alt+/ no longer takes Option-hyphen (en dash) on German and Swiss Mac
  layouts: it needs a key that types "/" (or "÷" on US-like Mac
  layouts); Alt+Shift+Z stays the fallback.
- While the engine loads, remote and meta-only transactions no longer
  push the user's own out of the capped buffer, and every engine use
  records the buffer first.
- **Selection bubble:** the bubble stays while any of its popups is open
  (the colour dialog).
- **Action palette:** no zoom under reduced motion. Esc in the save view
  goes back to the list, with focus in the search field; a second Esc
  closes. The format name is capped at 40 characters (it was cut silently
  at 40 after accepting 160) with a visible "Up to 40 characters" hint,
  saving announces "Saved format ‘name’", and the same error or an
  unavailable action's reason is read again on every try.
- **Palette order:** Repeat formatting is suggested once a bundle exists
  and Format opens with Paint format; saved formats have their own Your
  formats group; Undo and Redo moved to their own History group. A search
  for "repeat" ranks Repeat formatting above Paint format.
- New `lib/announce.ts` (`announce(message, options)`): one polite,
  visually hidden status node for messages that outlive the control that
  sent them, which also feeds the status pill.
- **Phone List menu:** tapping the list type that is already checked kept
  removing the list; it now only closes the menu, as on desktop.
- **One Esc leaves the row (M3):** Esc on a row, bubble or phone-bar item
  returns to the editor with its selection in one press, even while the
  item's focus tooltip shows (the toolbar takes the key in the capture
  phase; the tooltip still closes). A hover tooltip keeps its own Esc
  (WCAG 1.4.13), and an item whose popup is open keeps the key.
- **Short text style at T5 (M8):** the narrowest ladder tier shows "Text",
  "Title", "H1"–"H6" or "Mixed" instead of a truncated "N…". The trigger
  is named by its visible text, "H2 Heading 2" at T5 and "Heading 2" above
  it (WCAG 2.5.3).
- **Outline overlay below 950px (M11):** focus leaving it (Tab, a click in
  the row or the tabs) closes it, Esc anywhere closes it and returns focus
  to the trigger, and an outline with no headings focuses the dialog
  instead of dropping focus on `<body>`.
- **Connection chip at 320px (M15):** the status and links cards wrap and
  a long name truncates, so nothing is clipped off the left edge (WCAG
  1.4.10).
- **Lazy surface failures:** a colour popover or Insert step whose chunk
  does not load names it in the popup ("Couldn’t load colours.", "…the
  table picker.") with a muted alert icon and a Retry button that fetches
  the chunk again in place (design pass §12); reopening also retries. A
  palette that cannot load says "Couldn’t open actions. Check your
  connection and try again." on the status pill, with Retry, instead of
  staying silent. The bubble still just stays away.
- **Palette ranking:** groups sort by their best match again (a cmdk
  1.1.1 bug looked groups up by a value they never had, so any weak match
  under Suggested here beat a strong one in Format): "paint format",
  "format painter" and "brush" find Paint format first, "repeat" still
  finds Repeat formatting. The highlighted row stays in view as the
  groups reorder while typing.
- **Saving a format** announces once, as a confirmation ("Saved format
  ‘X’" or "Replaced format ‘X’"); the palette said it a second time.
- **Aa sheet colours:** ↑/↓ follow the swatch lines as the sheet lays
  them out (its grid fills the width), so they keep the column.
- **Touch tablets:** tooltips and shortcut glyphs are hidden on a coarse
  pointer at any width, not only with the phone bar.
- **Alt+F10 at 800px:** no longer reproducible on `main` (62 runs of the
  old repro pass); the 768px handoff test drives Alt+F10 again, and a new
  test repeats Alt+F10, arrows and Esc at 800px, loaded there and after a
  resize hid the tab stop.
- **Design sign-off (PR #35):**
  - Near the top of the page the desktop status pill no longer covers
    the selection bubble: it moves 8px right of it (or below it), so a
    second click on the armed brush cancels.
  - The phone Aa sheet no longer scrolls sideways at 320px and 375px:
    "Save selection as format…", "Remove a format" and the Remove list
    span the sheet, the list is inset under its toggle instead of mixed
    into the formats, and long names truncate. Why Save (or a format) is
    unavailable is a visible line, since phones have no tooltips.
  - A disabled menu item's label dims (a bare-text label did not), and
    its reason is read once, as the description, not also in the name.
  - While Paint format is armed, Esc on a toolbar item or in a menu no
    longer closes its pill: only Esc in the text does, which also
    cancels painting.
  - Arming Paint format and cancelling no longer replaces the Repeat
    bundle; it is remembered only once applied. A bundle that only clears
    reads "Plain (removes formatting)" and is not suggested first in the
    palette.
  - The presence and Privacy chips hide while the phone selection bar
    shows, instead of showing through behind its pill.
  - The phone brush pill says "Select text, then tap the brush again"
    (no emoji), and the "Couldn’t load" hint is no longer padded twice.

- **Typing budget flipped between runs, partly addressed**
  (`performance.spec.ts`). Every trial generated its own random document,
  so the two arms typed into different documents; at 50 headings that
  difference outweighed the toolbar's (resampled, about 27% of runs failed
  with a new document per trial, about 1% with one shared document). All
  trials of a heading count now share one document. One discarded warm-up
  trial per arm runs first, each arm waits for its own end state (toolbar
  mounted or gone) and then for an idle main thread, trials time 200
  keystrokes after 20 warm-up ones (was 90 after 10), and `PERF_ROUNDS`
  defaults to 7 (was 5). Both sizes can still fail on the 10% budget (see
  Known below): in isolation 50 headings passed 10/10 (was 8/10) and 10
  headings 8/10 (unchanged), and in a full chromium + perf run 50 headings
  failed once (5.0 vs 4.5 ms). The test timeout is now 300 s (about
  1.4 min per heading count locally, was about 36 s).
- **Arrow p95 measured the toolbar arm first and colder, on a cliff**
  (`toolbar-perf.spec.ts`). At 720 px the 60-key walk scrolled about five
  times; the frame after a scroll lays out the revealed blocks and costs
  several times a normal key, and those frames were about 5% of keys, right
  at the p95 rank, so one more or one fewer moved an arm's p95 by hundreds
  of ms. Both arms now open the same generated document in fresh 1280×4000
  contexts (the test checks that the walk does not scroll), run a discarded
  warm-up round each, then three interleaved rounds from the same start
  once the main thread is idle. Each press is one sample (Shift's own
  keydown used to count as a second) and waits for the previous press to
  paint, and p95 is taken over all of an arm's presses. Scroll frames are
  therefore no longer part of this budget. `TOOLBAR_PERF_CPU_THROTTLE`
  throttles both arms for local reproduction. The test timeout is now
  300 s.
- **Leak spec heap bound sat close to warm-up growth**
  (`editor-leak.spec.ts`). The baseline is now taken after 12 warm-up tab
  switches (was 6), and each measurement repeats GC and reads until two
  readings agree, instead of one reading after a fixed 2 s.
- **Resize gripper test timed out** (`extensions.spec.ts`). The lazy
  selection bubble registers its plugin when its chunk lands; that
  reconfigures the editor, ProseMirror recreates every plugin view, and the
  media controls hide an active gripper when theirs is destroyed. On a busy
  machine this landed after the hover. The test now waits for the bubble's
  plugin first.
- Known, not fixed here: the same reconfigure hides an active gripper for
  a user who hovers an image while the bubble chunk is still loading. The
  hide on plugin-view destroy is in `@docs.plus/extension-hypermultimedia`.
- Known, not fixed here: at 10 and 50 headings (p95 about 3-6 ms) single
  trials still swing by about 10% in both arms, from bursts of consecutive
  slow keystrokes whose cause was not found (they hit both arms alike, and
  line up with neither offline copy writes nor WebSocket sends), so the
  typing budget can still fail on noise. At this p95 and 0.1 ms timer
  ticks a 10% budget sits at the measurement floor; the ways out (gate on
  a larger document only, more rounds, or another measure of the
  toolbar's per-keystroke cost) change the gate and are the owner's call.


#### Added
- **Diagram ▸ templates in the Insert menu (M17b, design pass §9):**
  Diagram is one standard submenu row (hover, click, Enter or →) with the
  five Mermaid templates and their icons (Flowchart, Sequence, State,
  Mind map, Pie chart); the last used one is noted "Last used" and
  focused first. A collision flips the submenu to the menu's other side,
  never over its rows. When no template can go here (the title, inside a
  diagram) one note at the top says why instead of a reason per row.
  E's `template.mermaid` no longer shows up as a second, icon-less
  "Insert diagram" row. The submenu rides in the insert step's preloaded
  chunk; until it lands, Diagram is one item that inserts.
- **Paint format (design pass §1–2)** replaces Copy formatting: a brush
  after a separator in the selection bubble (28×28, `aria-pressed` while
  armed), "Paint format" in ⋯ and the palette. It picks up the formatting
  at the selection or caret (plain text picks up plain) as the remembered
  Repeat bundle. While armed the editor shows a copy cursor; the next
  mouse selection paints it as one undo step; on the keyboard, Alt+F10 to
  the brush, Esc back to the text, select, then ⌘⌥V (Ctrl+Alt+V or F4)
  or the brush again; on touch, tap the brush, select, tap it again
  (never on its own). Esc in the text, the brush on the same selection, a
  document switch or read-only cancel it.
- **Status pill (§5):** every announcement also shows as a short pill,
  8px under the sticky row on desktop and 8px above the phone bar (beside
  its cells, never in a masked element; the presence and Privacy chips
  sit under the bar's layer). It closes after 2.5 s (5 s with Undo or
  Retry), stays while hovered or focused, and Esc closes it. Repeat with
  nothing remembered says "Nothing to repeat yet. Format some text or use
  Paint format."; Repeat confirms "Repeated Bold, Yellow highlight".
- **Your formats in the text style dropdown (§4):** after the styles,
  each saved format named in its own formatting (described by its long
  label), "Save selection as format…" (the palette's save view) and
  "Remove a format ▸", which removes at once with Undo on the pill. The
  section is a lazy chunk loaded with the dropdown. A disabled item says
  why on a visible second line. The Aa sheet has the same Your formats
  section, with "Remove a format" (a tap removes, Undo on the pill, which
  sits above the open sheet). The Save dialog's "Remove a format" link
  at the cap opens the dropdown, or the sheet on a phone, at that list.
- **Format chips in the palette (§8):** Your formats rows show "A" in
  the format in their leading slot.
- **Phone selection bar (§6):** eight 44px cells, B I U A▁ ✎▁ 🔗 🖌 ✕,
  with no scroll or edge fades (U moves to the sheet below 360px; strike
  and clear formatting are in the sheet). The colour cells show the
  remembered colour as a bar; ✕ has a left divider.
- **Announcements** through one polite live region (`lib/announce.ts`):
  "Repeated Bold, Italic", "Picked up Bold. Select text to apply.",
  "Formatting applied", "Applied 'X'", "Saved format 'X'" / "Replaced
  format 'X'", "Removed 'X'", and the reason when the Repeat key cannot
  run (the key is then handled, not passed on).
- **Phone context slot cell:** the docked bar shows the current block's
  tools as one 44×44 cell between Indent and Insert (spec §4.7): section
  fold and moves, code language and copy, table rows and columns, and
  media options (a direct button, as in the row), from the same registry
  actions as the row's slot. It is held
  while focus is in the bar or its menu, so another writer's edit never
  removes it under focus. Below 404px Redo lives in the sheet, so the cell
  never shifts the others; below 360px the cell's tools move into the
  sheet (the language as a native select). The cell shows its kind
  (heading, code, table or image icon) beside its chevron, and the code
  menu has a "Language" group after a separator, with the current
  language checked, aliases included (`js` checks JavaScript).
- **Safe areas:** `viewport-fit=cover`. The tab strip and the loading
  skeleton clear the status bar and notch, the shell keeps clear of
  landscape notches, the phone bar keeps its cells above the home
  indicator while the keyboard is closed, and the Aa sheet and the
  about, privacy and offline pages pad by the insets. Desktop is
  unchanged.
- **Swipe down to close the Aa sheet:** drag its header (new handle)
  down past 80px or flick it; shorter drags snap back, reduced motion
  makes both instant, and Done, Esc and the backdrop still close it.

#### Changed
- **Design pass surfaces (§7–§12 of
  `docs/superpowers/specs/2026-11-13-smart-toolbar-design-pass.md`):**
  - **Save as format:** "Reuse this style anywhere. Saved on this
    device.", a preview box with "Sample text" in the format and its long
    label, an empty name with the placeholder "e.g. Warning", and Save
    disabled until the name is non-blank. Saving over a name says
    "Replaces your format ‘X’." first; at 20 formats the dialog says so
    with a "Remove a format" link (`formats.remove` UI intent). The view is its own chunk, loaded when it
    opens, so the palette chunk could take the row changes.
  - **Palette rows:** a leading `size-4` slot with the registry icon or a
    colour chip; 32 px rows, 48 px with a second line. Colour rows are
    named once ("Orange text"); saved formats get their own "Your
    formats" group, named by the format. An action under "Suggested here"
    (now at most 4) is not repeated in its home group, and unavailable
    rows sort to the bottom of theirs with the label at full contrast,
    the reason muted (`text-foreground/70` when selected) and no shortcut.
    The selected row's bar uses the focus-ring colour. Repeat formatting
    is named alone, with what it applies as its second line.
  - **Shortcuts:** toolbar tooltips use the palette's and menus'
    formatter, one `<kbd>`: "⌘⌥V" on macOS, "Ctrl+Alt+V" elsewhere (it
    said "Mod" off macOS).
  - **Menus:** a disabled item shows its reason as a visible second line
    (`DropdownMenuReason`, still its description); only the label and
    icon dim. Title-only and hidden reasons are gone from the row menus
    and Insert.
  - **Colour popover:** low-contrast highlights are no longer dimmed;
    their dotted border is 60% foreground (≥ 5:1), and the note names the
    colour: "Dotted: hard to read with Red text". The popover body and the
    table grid styles load with their own chunks, off the editor chunk.
- **Loading is not a state the user sees:** before the formatting engine
  lands, its actions are available and a click waits for it, as the
  Repeat key does; "Formatting tools are still loading." is gone. A
  failed load (a brush, Your formats, the Repeat key or a palette row)
  says "Couldn’t load formatting tools." on the pill, with Retry.
- "In this doc" formats left the menus and the palette, and the short
  "B · I · Red" notation is gone from all UI text.
- **Touch:** no tooltips and no shortcut glyphs on a coarse pointer; a
  tap on an unavailable phone cell or sheet row shows its reason on the
  pill instead, and a focused phone cell keeps its ring inside the bar.
  The Aa sheet's sections and row labels have a clear hierarchy, and its
  swatches fill the width.
- PR E's formatting engine (`lib/editor-actions/v11-engine.ts`) now lives
  in one lazy chunk. The selection bubble and the phone selection cells
  reach it through `getV11Engine()` / `loadV11Engine()` like the palette,
  instead of each carrying a copy (about 5 KB gz each). A unit test
  fails on any static import of the engine from app code.
- The selection-wide code check runs once per snapshot and stops at the
  first formattable character.
- E's palette keywords ride with the engine, and the eager shell drops
  its listener set, to keep the editor chunk near flat (+148 B gz).

### Smart toolbar later-phase plans (docs)

Docs only, no runtime change.

#### Added
- Implementation plans for the features spec §8 item 6 lists as "Later",
  in `docs/superpowers/plans/2026-11-13-smart-toolbar-later-*.md`:
  Continue where you left off (M15), the "/" menu, hover preview and the
  progressive-disclosure toggle. Each plan is grounded in `main` at
  `7abadc1` and states that it needs no schema or protocol change. Each
  also gives its WCAG 2.2 AA requirements, its performance and test plan,
  and its share of the editor-chunk headroom left under contract A12. The
  four allocations, plus Turbopack's split cost for new lazy chunks, add up
  to more than that headroom, so expect an owner budget amendment. The
  progressive-disclosure toggle is the cheapest and should be measured
  first.
- No plan for Document styles (M14b): its `styleRef` allowlist entry must
  ship in a deploy before the mark (spec §3.1), and nothing has been
  deployed yet. The "/" menu plan records why under "Not in scope".

### Smart toolbar v1.1, PR E: action palette and repeat formatting

Rebuilt on `main` after v1 (#32), branch `feat/smart-toolbar-e`.
Ships with v1's first deploy: the owner waived spec §8's 14-day hold and
raised the editor-chunk budget to 23.5 KB for E (contract A12; growth
+22.9 KB, of which E's eager shell is about 2.4 KB).

#### Added
- **Action palette:** Alt+/ (fallback Alt+Shift+Z) opens a searchable list
  of every registry action, grouped Recent, Suggested here, Format, Insert,
  Section, View and History; unavailable entries stay listed with their reason. The
  palette (cmdk 1.1.1) is a lazy chunk loaded on the first open, rendered
  in v1's `SurfaceBoundary`; one capture-phase key listener serves every
  tab.
- **Repeat formatting and Copy formatting:** Mod+Alt+V (and F4 off macOS)
  applies the last formatting as one undo step, setting marks rather than
  toggling them; Copy formatting picks up the selection's formatting.
- **Your formats** (saved in `tinydocy-formats`, kept by "Forget my
  choices"), **In this doc** (formats the document already uses, scanned on
  demand and never stored) and **Mermaid templates** (flowchart, sequence,
  state, mind map, pie).
- **Repeat split button** in the selection bubble, with the Formats menu
  (Repeat, Copy formatting, Save as format…, Your formats, In this doc).
- **Phone selection cells:** on the docked phone bar a text selection swaps
  the cells to B, I, U, S, text colour, highlight, link, clear and Repeat,
  with a sticky "Back to all tools". The bar never swaps under keyboard or
  VoiceOver focus or with the Aa sheet open, stays one toolbar, and scrolls
  sideways with scroll padding under the Back cell.
- Remembered choices (the Repeat bundle, Recent, the last diagram template)
  persist in v1's memory layer (`tinydocy-choices`).
- No schema, server or environment change; no Deploy step.

#### Changed
- **Bundle:** E's action bodies, Repeat commands, bundle recorder, saved
  formats, doc scan and diagram templates load as a lazy engine chunk when
  the editor is created; only the action definitions, the Repeat key
  binding and the palette listener stay eager. Until the engine lands
  (milliseconds), E's actions read "Formatting tools are still loading."
  and up to 50 transactions are buffered for the recorder. Measured with
  `scripts/check-editor-chunk-size.ts`: 401,311 B gz, +23,423 B over the
  baseline against the 20,480 B budget (v1 r2 alone: +19,346 B); E as first
  built measured +28,250 B. The budget is not raised here.
- **Palette budget** is 20 KB gz (owner decision O5, contract A7): 19,981 B
  on a local production build. The nightly `pwa` job runs the
  `PALETTE_BUDGET=1` check on its production build.
- The smart-toolbar barrel no longer re-exports `RepeatSplitButton` and
  `PhoneSelectionCells` (contract A6, E's sub-bullet): it pulled them into
  the editor chunk.
- Edits outside E's file scope (`nightly.yml`, cmdk's
  `patchedDependencies`, the phone bar, the barrel, `tests/TESTING.md`) are
  listed under the owner's ownership grant, contract A6.
  `tests/unit/ci/cmdk-patch.test.ts` fails when cmdk moves off 1.1.1 or the
  patch is missing.
- `palette-leaks.spec.ts` logs tab-switch heap and live editors.

#### Fixed
- **Repeat pressed before the engine chunk loaded did nothing.** On a slow
  network or a busy device the shortcut could arrive first; the key is now
  taken and Repeat runs once the engine lands, if the selection has not
  moved.
- The palette's search field keeps `aria-activedescendant` on the
  highlighted option on open, after arrow keys, while filtering, and drops
  it when nothing matches (WCAG 4.1.2); `patches/cmdk@1.1.1.patch` re-syncs
  the attribute.
- Palette rows name their keys with `aria-keyshortcuts` and hide the glyph
  from assistive technology; on a coarse pointer the rows and the Save as
  format field and buttons are 44px tall.
- Palette rows are named for their own action ("Heading 1", not "Heading 1:
  Normal text"), and the current style and alignment show a check and ",
  current" (WCAG 2.4.6).
- A polite status region announces "N actions" or "No matching actions"
  300 ms after the search changes (WCAG 4.1.3).
- In forced colours the palette and the Save as format form keep a
  CanvasText border.
- A palette or engine chunk that fails to load (offline, or replaced by a
  deploy) leaves the editor working: the palette closes and the next Alt+/
  fetches it again; without the engine the palette still opens.

### Smart toolbar plans for PR C, D1, D2 and E (docs)

Docs only, no runtime change.

#### Added
- Implementation plans for the rest of the smart toolbar rollout in
  `docs/superpowers/plans/`: PR C (text colour and font size schema,
  release N+1), PR D1 (action registry, sorted row and context slot),
  PR D2 (surfaces, memory and the responsive ladder) and PR E (palette,
  Repeat formatting and saved formats). They are the plans the work started
  from; where they differ, the v1 contract
  (`docs/superpowers/specs/2026-11-13-smart-toolbar-v1-contract.md` on the
  integration branch, §10 amendments) records what was built.

### Editor leak on tab switch (fix/editor-tab-leak)

Not specific to the smart toolbar: `main` has leaked since `@tiptap/markdown`
was added, so this fix can ship to `main` on its own.

#### Fixed
- **Destroyed editors stayed in memory.** `@tiptap/markdown` registered each
  editor's tokenizers on the module-wide `marked` instance and never removed
  them, which kept every closed editor reachable: 20 tab switches left 7
  extra live editors and 6 MB more heap, without limit. Each editor now gets
  its own `Marked` instance (`marked` is now a direct dependency, at the
  version already installed), and `tests/e2e/editor-leak.spec.ts` checks
  that 20 switches return to the baseline.
- Known, not fixed here: while a Playground image request is still pending,
  Chromium keeps the `<img>` alive and, through the media resize gripper's
  listeners, its closed editor. They are released once the request settles.
- **Tab-cap e2e timed out in CI.** `tabs.spec.ts` "create tab is blocked
  when cap is reached" slept 120 ms after each of its 48 clicks; on `main` it
  had grown from 16 s to 30 s in CI and already failed once there. It now
  waits for each new tab instead (about 9.8 s to 5.5 s locally), checks the
  tab count equals the cap in the button title, and allows 60 s for the 49
  editor mounts. The leak fix did not slow tab creation (about 80 ms per tab
  before and after).
- **Leak spec heap bound.** Heap still grows about 5% over 20 switches
  without a leak (it levels off near 10%), so the 5% bound in
  `editor-leak.spec.ts` failed most local runs. It is now 10%; the leak
  added about 17%, and the live-editor count stays the main check.


### Smart toolbar v1 integration (PR C + D1 + D2, r2 surfaces)

**Release order (owner override O10, 2026-11-13):** the owner chose to merge
v1 to `main` before release N (PR A + B) was deployed and before the N+1
adoption reading. The next deploy therefore goes from pre-N straight to N+1:
follow PR B's Deploy note and then PR C's in one window (Hocus first,
confirm `min=2 (floor 2, env 0)` and the refusals, then Next). Tabs still
open on the old build are refused per document (`client_outdated`) until
they reload; the mixed-version soak shows no content lost and no throttle
bans. PR E (palette, Repeat formatting, saved formats) is **not** part of
v1: it stays on its own branch until D's metrics hold for 14 days.

**What v1 has:** the sorted row, the context slot, the colour popover with
split faces, the size stepper, List and Insert menus, the memory layer with
Forget, the responsive ladder, the desktop selection bubble, the outline
overlay below 950px, and the docked phone bar with the Aa ("Text format")
sheet.

**Not in v1 yet** (spec §8 PR D items, deferred by contract §1.3): the phone
bar's context slot cell, and the mobile selection swap and Repeat split
button (PR E).

**Gates** (contract §10): the Nightly soaks (A10) and the Linux CI chunk
measurement (+18.9 KB of 20 KB) passed on the integration branch; release N
and the adoption reading are waived by the owner (O10), and the ladder
thresholds (A5) ship as measured. O1 to O4, O6, O8 and O9 are
decided: O2 (arrow-key p95) is log-only in v1, O8 waives the collab typing
comparison, and O9 accepts production's 2 MiB cap as the limit for
format-toggle growth (2026-11-13). O7, the perf typing budget, is closed by
the combined run (toolbar on 4.6/5.4 ms vs off 4.8/5.8 ms median p95). The
owner's O5, the palette budget, is E's A7 on `feat/smart-toolbar-e-v11` and
not part of v1.

#### Added
- **Selection bubble** (spec §4.3, desktop only): selecting text with a fine
  pointer shows B · I · U │ text colour split │ link above the selection
  (below it when the sticky toolbar or a collaborator's caret label is in
  the way). Every bubble action is also in the row. Typing, a node
  selection, code and Mermaid blocks, a selection inside one link and a
  read-only document hide it; Esc fades it out (90 ms) and keeps the
  selection; Alt+F10 focuses it when it shows, else the row. The colour
  popover opens from the bubble, away from the selection, and keeps it
  attached. Focus leaving the editor or the bubble (Tab, another control)
  hides it, and a click between its buttons keeps the editor focused. While
  the selection is scrolled out of view, or the bubble is wholly under the
  sticky row, it reads closed: Alt+F10 goes to the row and focus inside it
  returns to the editor. The bubble is its own lazy chunk (owner decision
  O1); touch devices and phone widths never load it.
- **Outline overlay below 950px** (spec §4.6, D2 Decision 5): from 768 to
  949px the outline slides over the page below the sticky toolbar instead of
  pushing it aside. It is a non-modal "Outline" dialog with a "Close
  outline" scrim; it focuses the active item when it opens, closes after a
  heading pick (caret at the heading's end), and Esc or the scrim return
  focus to the outline trigger (View ▾ at T4). Esc during a keyboard drag
  only cancels the drag. Its open state is never remembered, so a
  remembered "open" never covers the page on load; crossing 950px shows the
  docked state (M6) and keeps focus, or moves it to "Toggle outline".
- **More remembered choices** (spec §5, local only, cleared by Forget):
  - M4: a new code block takes the language most code blocks in the doc
    use (Mermaid excluded), else the last language you picked, else plain.
  - M9: the list face follows the last list type from the face, the list
    menu or a shortcut; the menu now runs the registry's `list.*` actions.
  - M10: at T1 the last inserted kind gets a labelled face beside the Insert
    menu; from T2 the plain menu pre-highlights it. A fresh profile keeps
    "+ Insert" (the fallback was "table").
  - M17a: the table grid reopens at your last size (now proven end to end,
    across reloads and Forget).
- **Responsive ladder** (spec §4.6): the fixed row is a size container and
  fits its width from 1440px down to 768px, mouse and touch, in paragraph,
  heading, code and table contexts. Tiers hide groups and show stand-ins:
  T2 size stepper to "M ▾", Insert icon only, Theme into ⋯; T3 align and
  indent to a ¶ menu, the slot to one button; T4 the colour pair to one
  button, Outline and Filter to View ▾; T5 U and S to an Aa menu, a short
  style value and no separators. Thresholds are the measured row widths
  (contract A5). Hidden items leave the roving order, and a resize re-stamps
  it so the row keeps one Tab stop. `toolbar-ladder.spec.ts` asserts the fit
  at every tier.
- **Docked phone bar** (spec §4.7, contract A6): below 768px the sticky row
  gives way to one 44px `role="toolbar"` docked above the on-screen keyboard
  (`visualViewport`, reset when focus leaves editable content, for iOS), with
  44×44 cells: Undo, Redo (from 360px; narrower phones find it in the sheet),
  Aa, Bold, Italic, List, Indent and Insert. Toggles show their state with
  `aria-pressed`. It hides in a read-only document. The caret and
  `scroll-padding-bottom` stay clear of the bar and the keyboard. The bar
  and its sheet are one lazy chunk, loaded only below 768px, so desktop
  never fetches them (contract A9).
- **Aa "Text format" sheet**: Colours first (the colour popover's panel:
  text, highlight, Recent, low-contrast dimming), then Style (Normal,
  H1–H6; locked in the title), Size (the XS–XL stepper, disabled in
  headings), Align and More (redo below 360px, outdent, underline,
  strikethrough, superscript, subscript, inline code, clear formatting,
  Forget my choices, link, a labelled theme switch), all registry actions
  with their reasons. It is modal: the page behind it is inert, the popup
  says `aria-modal` and Tab wraps inside it. Picks keep the sheet open;
  Link closes it and leaves focus in the link popover; Done returns focus
  to Aa. The bar's List menu is a radio menu like the row's.
- Crossing 768px with focus in the row or the phone bar moves focus to the
  toolbar that replaces it (same action when it shows one) instead of
  dropping it to the page.

- **Schema soaks in Nightly** (contract A10): a 50,000-toggle colour, highlight
  and size soak across three clients (convergence, stored copy, schema and
  size checks) and a mixed-version soak (pre-N clients refused, a release N
  editor freezes, nothing lost). `bun run test:soak:color` and
  `bun run test:soak:mixed-version`; see `tests/TESTING.md`.

#### Changed
- Mouse T2 starts below 1264px (was 1232px, contract A6): the widest M10
  face ("Code block") overflowed the T1 row by 31px. Touch is unchanged.
- The `list.*` actions use the list menu's in-place toggle (a list of
  another type is retyped in one step, nested lists too) and refuse the
  title; `toggleList` reports success only when the document changed.
- The row's scrollbar is no longer hidden: where it still overflows, the
  clipped controls can be found.
- On touch every row target is 44×44.
- Phones lose the sideways-scrolling row and its **Text style and colour**
  panel: the docked bar and the Aa sheet replace both.
- **Colour popover keeps open after a pick** (owner decision O4, spec
  §4.5): Enter or a click applies the swatch and keeps the popover open with
  focus on it, so writers can try several colours; Esc returns focus to the
  trigger. Focus opens on the applied swatch, else the section's first;
  arrows follow the token order; the check glyph sits on its own badge. PR
  A's per-swatch forced-colours border check runs on D2's swatches.
- **Low-contrast highlight swatches are dimmed** (owner decision O3, spec
  Appendix A): a highlight that would put the current text colour below
  4.5:1 is dimmed and described "Low contrast", but stays selectable; the
  focus ring keeps full strength. Text swatches never dim.
- **Editor chunk budget raised to 20 KB** (owner, contract A11): the r2
  fixes are eager and the budget had 16 B left; the combined branch measures
  +18.8 KB.
- **Editor chunk budget** (owner decision O1, contract A9): the Insert
  menu's table grid and embed form now load as their own chunk, on the
  Insert button's hover or focus (the colour popover and the bubble already
  did). The CI gate's budget is now +18.5 KB gz over the `58a9d22` baseline
  (measured +18.43 KB; spec §7 said +6 KB). Lazy slot controls and menu
  items were tried and reverted (contract A9).

#### Fixed
- **A lazy chunk that fails to load no longer crashes the page** (contract
  A9). If the colour popover body, an Insert step or the selection bubble
  cannot be fetched (offline, or a deploy replaced it), the popover stays
  empty or the bubble does not show; the editor and the tabs stay mounted
  and typing works. The next open fetches the chunk again. The colour and
  Insert chunks are now also fetched when the browser is idle after the
  first server sync, so the service worker caches them for offline use.
- **The selection bubble could vanish while open.** When its chunk arrived
  after the selection, the bubble was shown and then detached a frame later
  without closing, and it did not come back until the selection changed. It
  showed up as the intermittent `selection-bubble.spec.ts` failures under
  three e2e workers (contract A9 has the cause).
- **A selection change with focus inside the bubble threw.** Collapsing the
  selection programmatically (for example a remote edit) while a bubble
  button had focus made the bubble's hide run twice inside one transaction,
  and the second removal threw from the dispatch. Focus now returns to the
  editor instead.
- **Tab past the last bubble item dropped focus on the page.** It now
  returns to the editor with the selection intact, and the bubble stays
  away until a new selection, as after Esc.
- **The Insert face could undo a quote.** At T1 the remembered kind's face
  read as a "Quote" toggle, and a click with the caret in a quote unwrapped
  it. Faces are now named with a verb ("Insert quote"; the visible text is
  unchanged) and never show a pressed state, and Quote only inserts: inside
  a quote it is unavailable ("Already in a quote.").
- **The Insert step took focus back after it closed.** Base UI returns
  focus when the table grid or embed form unmounts, after its exit
  animation, and it always moved focus to Insert. A menu opened in that
  window (More formatting right after Esc on the grid, on a slow device)
  lost focus and closed at once; it failed CI under three workers. Picking
  a table size also ended with focus on Insert instead of in the new table.
  The step now stays rendered until it has finished closing, and focus goes
  back to Insert only when it is still inside the closing step.
- **A fold could stay half-animated.** Registering any editor plugin while
  a section was folding (the selection bubble mounts its plugin lazily)
  rebuilt the plugin views and dropped the timer that ends the animation,
  so the section stayed mid-fold until the next edit. The rebuilt view now
  finishes it.
- **Menu items read their shortcut as part of the name** ("Superscript⌘.").
  The hint is hidden from assistive technology and the item announces its
  keys through `aria-keyshortcuts`.
- `tests/e2e/editor-leak.spec.ts` also opens and closes the bubble and its
  colour popover 100 times and checks that the `document` and `window`
  listener counts (per event type, through CDP) return to the baseline.
- **Focus fell to the page when the ladder hid the focused control** (for
  example Underline at 850px, or browser zoom). It now moves to the same
  tier's stand-in, or the nearest visible item.
- **Crossing 768px with focus in the toolbar lost it.** Focus moves to the
  other toolbar, on the same action when it shows one.
- **The phone format sheet was not modal.** Tab escaped to the tab strip and
  the covered bar; the app shell is now inert while it is open, the popup is
  `aria-modal` and Tab wraps inside it. Link from the sheet leaves focus in
  the link popover.
- **A mixed state looked off.** `aria-pressed="mixed"` (bold on half a word)
  now shows a 6×2px half bar (≥3:1); in forced colours it is a dashed border,
  so the focus ring stays visible.
- **Menu items were 28px tall on touch.** On a coarse pointer they are at
  least 44px; mouse sizes are unchanged.
- **Colour popover polish:** a visible note under Highlight when swatches
  are dimmed for contrast, swatch borders at ≥3:1, and the roving focus
  follows a clicked swatch.
- **Reduced motion** turns off menu and popover animations, and the phone
  sheet's, not only the bubble's.
- An empty context slot no longer leaves two separators side by side.

### Smart toolbar v1, PR D1: action registry, sorted row and context slot

#### Added
- **Action registry** (`lib/editor-actions/core-actions.ts`, bodies in
  `lib/editor-actions/core/`): every toolbar command is one action with a
  label, icon, display shortcut, markdown hint, contexts and a reason when it
  cannot run. History reads the Yjs UndoManager stack; section moves, lists,
  tables and indent compute a real `can()` once per selection snapshot.
- **Context snapshot** (`lib/editor-context/snapshot.ts`): one O(depth) walk
  gives the kind (media, Mermaid, code, table, title, heading, list,
  paragraph), ancestor flags and the marks across the selection.
- **Sorted row** (spec §4.1): history, text style, size, B I U S, colour,
  link, Align ▾, List ▾, outdent and indent, the context slot, Insert and
  ⋯ More formatting (superscript, subscript, inline code, clear formatting).
  Controls never move or disappear: in a read-only document each says "This
  document is read-only." Group roots carry `data-toolbar-group` and
  collapsible items `data-collapse-tier` for the responsive ladder.
- **Context slot** (spec §4.2): a fixed 168px group before Insert with
  section tools (fold, move up, move down), the title lock, the code or
  diagram language and copy, table row and column menus, header row and
  merge or split, and Media options… (opens the media kit's toolbar with
  focus on its first control; Esc closes it and returns to the slot
  button). Contents hold while focus is in the toolbar; a section move
  carries the held heading id and refuses when a collaborator deleted it.
  The slot never clips focus outlines, and a long language name truncates
  (full name in the tooltip) instead of overflowing under WCAG 1.4.12 text
  spacing.
- **Keyboard model:** one Tab stop with a roving tabindex owned by the
  toolbar, Alt+F10 to the toolbar, Esc back to the document with its
  selection. With a focus tooltip open, the first Esc closes the tooltip
  and keeps focus (WCAG 1.4.13); the next returns to the document.
- **Clear formatting** (`Mod-\`, #392): removes every inline mark except
  links in one undo step; never touches block type, alignment or indent;
  disabled in code.
- **Shortcut hints** with `aria-keyshortcuts` on every toolbar action (#612).
- **Tests:** `toolbar-row.spec.ts` (row order, one Tab stop, Alt+F10 and Esc,
  slot per context, remote heading deletion while the slot has focus, clear
  formatting keeps links, read-only keeps focus, catch-up render budget,
  light and dark screenshots); unit tests for the snapshot, key combos, the
  core actions and the keymap.

#### Changed
- Indent and outdent mirror Tab (`sinkListItem`, then text indent).
- The toolbar Profiler records each update's `actualDuration`
  (`window.__toolbarRenderMs`, dev only); `toolbar-row.spec.ts` logs the
  catch-up render per burst in a 500-heading document and writes it to the
  perf report.
- Disabled reasons are full sentences ending in a period.
- Text style applies to a mixed range (the Style menu reads "Mixed") and
  keeps the range selected; a range that starts in the title is disabled
  with "Title is always H1."
- The toolbar's roving tabindex does no layout reads while focus is in the
  document, so slot swaps on arrow keys stay cheap; mark state for a range
  comes from one selection walk. `toolbar-row.spec.ts` reports arrow and
  Shift+Arrow p95 in a 500-heading document with and without the toolbar.
- `sanitizeCodeLanguage` moved to `lib/code-language.ts`.

### Smart toolbar schema (PR C, release N+1)

Release N+1's data layer for the smart toolbar. No toolbar UI. Merge and
deploy **only after the N+1 ship gates pass** (runbook: ≥ 95% `schema=2` over
24 h held ≥ 48 h, the refused-client and mixed-version soaks, the staging
drill).

#### Added
- **`textColor` and `fontSize` marks** (`extensions/text-style-marks/`):
  standalone, inclusive like bold, one token attribute each (`color`: the ten
  palette names; `size`: `xs sm lg xl`, the default size has no mark). They
  render only `data-text-color` / `data-font-size` for a known token, never
  inline style; anything else renders as plain text.
- **Commands for the toolbar:** `setTextColor`, `unsetTextColor`,
  `setFontSize`, `unsetFontSize`. Each is one transaction, an empty selection
  sets a stored mark, and an invalid token returns false. `setFontSize`
  refuses headings and the title.
- **Appendix A palette** in `extensions/text-style-marks/text-style-marks.scss`
  for light and dark, with a contrast test (text ≥ 4.5:1 on the page, page
  text ≥ 7:1 on every highlight) and a test that the SCSS matches
  `lib/text-style-tokens.ts`. Palette text on a palette highlight is often
  below 4.5:1 (77/100 light, 49/100 dark pairs): an open decision for PR D
  (spec Appendix A), with the failing set pinned in the palette test.

#### Changed
- **Highlights store tokens:** `setHighlight` / `toggleHighlight` accept a
  palette token or the release N `var(--tt-color-highlight-X)` form (stored as
  the token X) and refuse anything else, so the old "Default background"
  swatch is a no-op. `toggleHighlight()`, Mod-Shift-H and `==x==` now use
  yellow instead of an invisible mark; Mod-Shift-H on any highlight removes it
  in one press. Toggling and the popover's pressed state compare tokens
  (`activeHighlightToken`), so a legacy value counts as its token.
- **Hocus can rewrite stored legacy highlight colours** to their token on
  load (`afterLoadDocument`, alongside the `link`/`code` rename in
  `lib/yjs-mark-migration.ts`); tokens and unknown values are left alone.
  Off by default (`HOCUS_REWRITE_LEGACY_HIGHLIGHTS=1` turns it on): release
  N's popover compares raw values, so on a rewritten highlight N tabs would
  show no pressed swatch and need two clicks to remove it.
- **Paste keeps only our own styling:** our `data-text-color`,
  `data-font-size` and `data-highlight` (and release N's `data-color`) survive
  a paste between tabs; foreign colour, font size and background (Google Docs,
  Word, any `<mark>` without a token) paste as plain text. The Docs and Word
  tests use synthetic clipboard fixtures, not checked against a real
  clipboard.
- **Sizes stay out of headings:** a local edit that puts `fontSize` in a
  heading or the title (turning a sized paragraph into a heading, paste, drop)
  drops the size in the same undo step; sized text that reaches a heading
  remotely renders at the heading's size.

#### Security
- **Client schema floor in code:** `SCHEMA_FLOOR = 2`
  (`lib/security/client-schema-gate.ts`). Hocus enforces
  `max(HOCUS_MIN_CLIENT_SCHEMA, 2)`, so the gate is never log-only again and
  the env can only raise it. The startup line prints the effective minimum.
- **Ingress allowlist:** `textColor` and `fontSize` are allowed (this
  release's server half). Unknown names are still refused with 4422.

#### Deploy
Only after the N+1 ship gates pass, at low traffic. Hocus runs TypeScript from
source and the running `next start` keeps serving its existing `.next` until
it restarts, so pulling without building puts the server half live first.
1. In the live checkout: pull, then `bun install --frozen-lockfile` (no
   dependency changes in this release). **Do not build yet.**
2. **Restart Hocus first:** `bunx pm2@6.0.14 restart editor-hocus --update-env`.
3. **Confirm** `[hocus] client schema gate: min=2 (floor 2, env 0)` in its log,
   and within a minute a `client_schema` line: `ok` counts release N clients,
   `refused` counts any pre-N bundles (`client_outdated`; 0 is fine if none
   are left).
4. **Then build in a second checkout and swap it in.** Do not build in the
   live checkout: measured on spare ports (contract §2.3 builder check), an
   in-place `next build` under a running `next start` made the probed chunks
   return 500 for a moment during the build, and every changed chunk return
   500 from then until the restart while the old HTML still points at it, so
   pages that need a changed chunk fail (about 3 s locally with a warm
   Turbopack cache; longer on the live host). A `.next` built in another
   checkout and moved in served every page and chunk after the restart
   (checked locally, not on the live host). From `/opt/projects/editor.docs.plus`:
   ```sh
   git worktree add --detach ../editor-build HEAD
   cp .env.production ../editor-build/   # build-time NEXT_PUBLIC_* values
   (cd ../editor-build && bun install --frozen-lockfile && bun run build)
   rm -rf .next.prev && mv .next .next.prev && mv ../editor-build/.next .next \
     && bunx pm2@6.0.14 restart editor-next --update-env
   git worktree remove --force ../editor-build
   ```
   The floor and the allowlist are already live, so no N+1 bundle exists
   before the server half. Only the second between the `mv` and the restart
   can serve a missing chunk. To roll Next back, swap `.next.prev` back the
   same way; delete it once N+1 is healthy.
5. **Later, once release N tabs are gone** (the `client_schema` line's
   `builds` shows only the N+1 build id for a day), add
   `HOCUS_REWRITE_LEGACY_HIGHLIGHTS=1` to the Hocus env and restart it with
   `--update-env` at the next routine restart. It only tidies stored values;
   N+1 reads both forms.
6. Leave `HOCUS_MIN_CLIENT_SCHEMA` unset. **Never roll back below release N,
   and never lower the floor.** Before rolling Hocus back below this release,
   roll Next back first and set `HOCUS_MIN_CLIENT_SCHEMA=2` (release N's code
   has no floor); N+1 tabs still open then get 4422 on the new marks until
   they reload. See the runbook.

### Added
- **Smart toolbar surfaces and memory (v1, PR D2).** Not deployable on its
  own: it ships with PR C's marks and PR D1's row, after the N+1 ship gates.
  - **Memory layer** (`lib/remembered-choice.ts`): versioned local storage
    under `tinydocy-choices` (cleared by the new **Forget my choices**
    action) and `tinydocy-ui` (outline open state, kept by Forget). Every
    read is re-validated against an allowlist; hostile, oversized or
    other-version payloads fall back to defaults. Written only by actions
    after their command succeeds. `NEXT_PUBLIC_REMEMBER_CHOICES=0` turns it
    off.
  - **Registry actions** `color.*`, `size.*`, `insert.*` and
    `memory.forget` (`lib/editor-actions/surface-actions.ts`).
  - **Colour split pair** with remembered faces ("Apply text colour: Red")
    and a lazily loaded popover: Recent (five mixed colours, frozen while
    open), text colours and highlights as named `aria-pressed` swatches in
    a roving grid.
  - **Size stepper** (`spinbutton`, disabled in headings with a reason),
    **Insert menu** listing the registry's insert actions with a table size
    grid that opens at the last size and an embed link step, and a
    remembered **list face** for D1's list actions.
  - **Phones** reach text colour, highlight and size from the colour panel.
    On touch every target is 44×44: the panel wraps to a second line at
    360px instead of scrolling sideways, popover swatches wrap at six per
    line (arrow keys follow the lines), the table grid caps at 6×6, and a
    tap opens the colour popover without taking focus.
  - Swatches of a colour kind that can't apply here stay focusable but are
    `aria-disabled` with the reason. Forced colours keep each swatch's
    colour and show pressed as a ring, separate from the focus outline.
  - **Bundle gate:** `scripts/check-editor-chunk-size.ts` (CI step) keeps
    the editor chunk group within 6 KB gz of the `58a9d22` baseline.
- **Toolbar accessibility tests:** `@axe-core/playwright` (dev dependency), an
  axe sweep of the toolbar in seven editor contexts and three open popups in
  light and dark (`toolbar-a11y.spec.ts`, WCAG 2.2 AA including target size),
  the toolbar behaviour spec (`toolbar.spec.ts`), and a typing-budget
  assertion in `performance.spec.ts` (p95 with the toolbar within 10% of
  toolbar off, per-keystroke timer, `PERF_ROUNDS` default 5).
  `E2E_BASE_URL` overrides the Playwright base URL.
- **Rollout safety for the smart toolbar (release N).** Lets later releases
  add new marks and nodes without corrupting older clients: a client that
  meets a name it does not know freezes the document read-only by design and
  asks for a reload, and never deletes it. See
  `docs/operations/schema-rollout-runbook.md`.
  - **Client version gate, log-only:** `HOCUS_MIN_CLIENT_SCHEMA` (default 0,
    no floor yet). Hocus logs per-minute `client_schema` counts and refuses
    nothing until an operator raises it.
  - **`schema` and `build` socket parameters** sent by the client
    (`NEXT_PUBLIC_BUILD_ID`, default the git short SHA).
  - **Ingress name allowlist:** updates that introduce a node or mark name
    outside the schema (current names plus legacy `link`/`code`), or put
    anything but an element at the top of a document, are refused: Hocus
    closes that document's connection with 4422 (`schema_rejected`, logged
    as `ws_unknown_schema_name`) and the client does not reconnect. The
    toolbar's `textColor` and `fontSize` are refused until the release that
    ships them deploys its server half first.
  - **Freeze on unknown, repair on misfit:** the editor goes read-only on an
    unknown schema name or an outdated client and shows a notice (outdated:
    reload, device copy kept; Reload waits at most 2 s for the copies). Any
    misfit of known names is fitted to the schema instead (a missing title,
    an emptied document, a top-level list item or hard break, a list holding
    a bare paragraph), so one raw write cannot lock a document; a failed
    repair shows a banner and sends `schema_repair_failed`.
  - **Offline `~s2` namespace** for device copies, with a transactional merge
    of legacy copies (the legacy key is deleted only after a successful
    save; IndexedDB writes now settle on commit). Saves and removals of one
    document run in order, so a merge still in flight when its tab closes or
    the document is deleted never writes the copy back, and a removal drops
    every later save of a session opened before it (one still flushing on
    release, which a tab close cannot reach, or one connected without its
    copy after the hydrate timeout).
  - **Token-aware highlight rendering** (attribute key stays `color`) and a
    teal highlight variable. The playground seed uses tokens.
  - **Schema snapshot test** and **schema rollout runbook**.
  - Hocus servers spawned by tests (`spawnHocus()`) no longer outlive an
    interrupted test run.
- **Smart toolbar design** (`docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`):
  sorted toolbar, colour and font-size tokens, a memory layer that remembers
  your choices, a context slot, responsive tiers, and a five-PR rollout with
  a client version gate. The research sources and rollout experiments sit
  alongside it. Docs only, no runtime change.

### Changed
- **Typing budget runs on its own:** `performance.spec.ts` moved to a `perf`
  Playwright project (one worker, starts after `chromium`). CI and
  `make test-e2e` run `--project=chromium --project=perf`; `make test-perf`
  runs `--project=perf --no-deps`.
- **Toolbar updates catch up within 1 s** (`TOOLBAR_MAX_WAIT_MS`) during
  continuous remote edits, such as a collaborator typing without pause; local
  typing still waits for a pause, so it never forces a toolbar commit.
- **Toolbar controls derive visibility in render,** so they hide at once when
  a document turns read-only, and per-keystroke listener work is gone.
- **Highlights with an unknown value render as plain text:** a highlight
  whose value is not a known token (old hex highlights, the old "Default
  background") renders without an inline style. Stored values are untouched.
- `.gitignore` ignores `.claude/launch.json`, the local preview config.
- **Nightly runs twice a day:** 03:41 UTC (night) and 08:00 UTC (morning).
- **docs.plus extension refresh runs daily** at 04:17 UTC instead of every
  three days. `bunfig.toml` still holds back releases younger than 3 days.

### Fixed
- **Focus outline and pressed underline on every button:** `Button`
  (`components/ui/button.tsx`) draws a 2px solid focus outline and, while
  `aria-pressed` is true, a short centred underline (12px wide, 2px tall, 3px
  above the bottom edge, at least 3:1), so the new look applies app-wide, not
  only in the toolbar. Both stay visible in dark mode and in Windows High
  Contrast (forced colours, where the underline uses `HighlightText`).
- **Disabled toolbar controls stay focusable** and say why they are disabled.
- **Style and list menus are named by value** ("Normal text", "No list") and
  use radio items; picking the checked item does nothing. They close after a
  pick and return focus to the editor at once, so the next keystroke lands in
  the document.
- **Text styles are disabled in the title,** with the reason "Title is
  always H1"; the style button still reads "Title".
- **Highlight swatches are named pressed buttons** in a dialog. Focus stays
  in the dialog, Esc returns it to the Highlight button, and toolbar arrow
  keys move from whichever control has focus.
- **Switching list type keeps the whole list:** bullet, ordered and task
  lists convert in place in one undo step, keeping every item and nested
  lists (task checked state stays only in lists that remain task lists).
  Before, only the caret's item moved to the new list and the rest became
  paragraphs.
- **"No highlight" keeps focus in the highlight dialog,** so Esc still
  returns focus to the Highlight button.
- **Typing stays in the editor after arrowing in the toolbar:** a later
  toolbar re-render no longer pulls focus back to the last arrowed control.
- **Indent and outdent buttons work in lists,** like Tab.
- **Headings and the caret stay clear of the sticky toolbar.**
- **Focus no longer drops to the page** when a toolbar control disappears.
- **Undo no longer wipes a new document:** the empty-document seed is kept
  out of the undo history.
### Security
- **Top-level content can no longer lock a document:** content other than an
  element directly in a document's editor fragment made y-tiptap throw before
  the client repair could run, so no client could open that document and open
  editors could later overwrite it from a stale view. Ingress refuses it when
  it can place it, but a client could slip it past by sending it before the
  block it follows (and before this release, with a single update). Hocus now
  deletes such content after every change to the fragment's top level, in the
  same broadcast that delivers it whatever its size (Hocuspocus no longer
  flushes its broadcast queue early at 1 MiB), and cleans stored documents
  when they load (`editor_root_swept` abuse event, at most one line per
  document per minute plus a count).
- **Size-cap bypass closed:** the update-size guard decoded frames by hand
  and could be bypassed with SyncReply frames or padded varints. It now
  decodes with lib0 exactly as Hocuspocus does, so the cap and the new name
  allowlist see every update.

### Deploy
1. Pull, `bun install --frozen-lockfile`, then `bun run build`.
2. Restart Hocus first: `bunx pm2@6.0.14 restart editor-hocus --update-env`.
   Confirm `[hocus] client schema gate: min=0 (log only)` in its log.
3. Then restart Next: `bunx pm2@6.0.14 restart editor-next --update-env`.
4. Leave `HOCUS_MIN_CLIENT_SCHEMA` unset. Read the `client_schema` counts.
5. From now on, never roll back below this release, and never lower the gate
   once raised (see the runbook). `NEXT_PUBLIC_BUILD_ID` is optional.

## 2026-11-11 · #23 Unit tests on bun test, advisory gate in CI

### Changed
- **Unit tests on `bun test`:** Bun's test runner with a happy-dom preload
  (`tests/setup.ts`) replaces Vitest. `bun run test` takes about 8 s,
  against 9–12 s with Vitest; the stress probe runs on its own
  (`test:stress`). Module mocks use `mock.module()` and `await import()`,
  and modules that read env at import time load through `importFresh()`.
  Make targets write JUnit XML to `test-reports/`.
- **Load harness:** clients use Bun's built-in `WebSocket`.

### Added
- CI fails on high and critical advisories (`bun audit --audit-level=high`).

### Removed
- `vitest`, `jsdom`, `@vitejs/plugin-react`, `ws` and `@types/ws`.

### Deploy
- Pull, build and restart as usual.

## 2026-11-11 · #21 Bun runtime everywhere, one SQLite driver

### Changed
- **Bun runtime everywhere:** `bunfig.toml` `[run] bun = true` runs Next.js
  (dev, build, start), Vitest, ESLint, Playwright and commitlint on Bun
  instead of Node. Node.js is no longer needed. Bun 1.4.4 or later is
  required (`.tool-versions`, `engines`, `packageManager`).
- **One SQLite driver:** the documents API, the retention script and the
  tests use `bun:sqlite` through `openSqlite()` in `lib/sqlite-open.ts`,
  like Hocuspocus already did. The app `tsconfig.json` now uses Bun types,
  so `tsconfig.hocus.json` is gone.
- **CI:** workflows no longer install Node. After install, CI puts a failing
  `node` stub on `PATH`, so anything that falls back to Node fails the run.
  Plain `bunx` ignores `[run] bun`, so workflows, git hooks and scripts call
  local tools as `bun <bin>` (`bun playwright test`, `bun lint-staged`).

### Removed
- `better-sqlite3` and `@types/better-sqlite3` (native addon).

### Deploy
- Upgrade Bun on the server to 1.4.4 or later **before** pulling
  (`bun upgrade`; check with `bun --version`). This change is tested and
  pinned on 1.4.4.
- Then `bun install --frozen-lockfile`, `bun run build` and restart the apps
  as usual. They run on Bun because `bunfig.toml` sits in their working
  folder.
- Optional: to move the PM2 daemon itself off Node, run
  `bunx --bun pm2@6.0.14 kill` and then
  `bunx --bun pm2@6.0.14 start ecosystem.config.cjs` (and `save` if you use
  a saved process list).
  After that, Node can be removed from the server.

## 2026-11-11 · #20 Brand favicon, dependency updates

### Fixed
- **Favicon:** `/favicon.ico` was still the Create Next App default, so
  browser tabs, bookmarks and other clients that ask for it showed the wrong
  icon. It now holds the brand "T" mark at 16, 32 and 48 px, generated from
  the same `BrandMark` as `app/icon.tsx` by `scripts/generate-favicon.tsx`
  (run `bun scripts/generate-favicon.tsx` after changing the mark).

### Changed
- **Dependencies:** `@docs.plus/extension-*` 2.2.0 → 2.3.0, Tiptap 3.33.0 →
  3.33.1 (`@tiptap/y-tiptap` 3.2.0 → 3.3.0), Next.js and
  `eslint-config-next` 16.4.5 → 16.4.6, `lucide-react` 1.72.0,
  `react-hotkeys-hook` 5.4.0, `@vitejs/plugin-react` 6.3.0, `sass` 1.108.2.
  Installed ahead of the 3-day `minimumReleaseAge` window on purpose (the
  guard in `bunfig.toml` is unchanged). TypeScript 7 is left for its own
  change.

### Deploy
- Pull, build and restart as usual.

## 2026-11-09 · #18 README badges, release workflow, testing docs

### Added
- **README badges:** CI and nightly status, latest release, license, live
  demo, docs.plus links (website, source, npm extensions, Discord) and the
  stack.
- **Releases:** pushing a `v*` tag publishes a GitHub release
  (`.github/workflows/release.yml`) with the pull requests merged since the
  previous tag and a link to this file. The first tag is `v0.1.0`.

### Changed
- The workflow-rules test allows a workflow without actions (the release
  workflow only runs `gh`) and checks once across all workflows that the
  action parser still finds some.
- `tests/TESTING.md`, the repo-conventions skill and `AGENTS.md` describe the
  current test layout, CI and nightly runs, the server-sync wait in e2e
  helpers and the resize-gripper exception.

## 2026-11-09 · #16 Caret after Enter, nightly tests, CI for update PRs

### Added
- **Nightly workflow** (`.github/workflows/nightly.yml`, 03:41 UTC and on
  demand) for the layers CI skips: the `pwa` project against a production
  build, the Yjs and quick multi- and single-user soaks, and the load
  harness (100 clients, distributed and conflicting edits).

### Fixed
- **Typing right after Enter or a heading shortcut no longer scrambles the
  text.** Chromium misplaces the caret when a character is typed into a
  block whose content `content-visibility: auto` (added in #12) is still
  skipping, such as one just created: "marker" became "arkerm". The block
  holding the caret now stays rendered (`CaretBlockVisible`,
  `extensions/render-once/`). Reproduced without TinyDocy in a plain
  `contenteditable`; with the fix, stress runs that failed 23–60% of the
  time pass, and switching it off brings the failures back. This was the
  real cause of the e2e caret races #15 worked around, so the tests' caret
  waits (`settleCaret`) are removed again.

### Changed
- **Extension update PRs run CI.** Pull requests opened with the workflow
  token start no workflows, so the scheduled `@docs.plus` update PR would
  wait forever on the required CI checks. The update workflow now starts CI
  on its branch (`gh workflow run`, the documented exception).
- The soak's filter journey and bot used a class that no longer exists, so
  they never filtered; they find the input by its label again. `openFilter`
  leaves an open bar alone.

### Deploy
- Pull, build and restart as usual. Start the first nightly run from
  Actions → Nightly → Run workflow if you want results before 03:41 UTC.

## 2026-11-09 · #15 Image resize handles, e2e races

### Fixed
- **Image resize handles appear on the image again.** A host rule made every
  top-level editor child `position: relative`, including the media
  extension's resize gripper, so its handles were drawn below and beside the
  hovered image (wherever the gripper sat in the document flow). The rule now
  skips the gripper.

### Changed
- **E2E tests no longer race the editor.**
  - Helpers wait for the server's first sync before editing (the editor is
    editable earlier, from the device copy); the editor region carries
    `data-server-synced` for them.
  - `buildDocument` puts the caret in the title through the editor;
    `openFilter` no longer closes a bar the shortcut just opened;
    `typeInNewParagraphAtEnd` replaces three copies.
  - The Mod-K test waits for the shift-arrow selection; the offline banner
    test waits for a full reconnect before testing that the banner returns.

## 2026-11-09 · #14 CI on every pull request

### Added
- **CI on every pull request and push to `main`** (`.github/workflows/ci.yml`).
  - The checks job runs Biome, ESLint, the typecheck, unit tests and the
    production build.
  - The e2e job runs the Playwright Chromium suite against `next dev` and
    Hocuspocus.
  - Jobs get a read-only token and no secrets, and actions are pinned to
    commit SHAs.
  - The stress probe is a timing benchmark, so it runs as a separate,
    non-blocking step.

### Deploy
- Nothing to deploy. To require these checks before merging, add the two CI
  jobs as required status checks in the `main` branch protection rule.

## 2026-11-09 · #13 Faster typing, changelog and README

### Added
- `CHANGELOG.md` (this file). Contributors add an entry under Unreleased with
  every pull request.

### Changed
- **Typing is 3–4x faster in large documents.** With 1,455 blocks, a
  keystroke reaches the next frame in 13–14 ms on desktop (was 52–69 ms) and
  50–56 ms on an emulated phone (was 203–282 ms). Mount time is unchanged.
  - The editor shell no longer re-renders on every transaction, and the
    editor options stay stable, so Tiptap no longer reconfigures the view per
    keystroke.
  - Toolbar controls share one store per editor: selection, mark, focus and
    editable changes update them at once; document changes update them after
    150 ms of quiet (`TOOLBAR_SETTLE_MS`).
  - Heading ids are assigned only when a change touches a heading, instead
    of walking the whole document.
  - The outline rebuilds at most every 250 ms while typing, notifies only
    when it actually changes, and re-renders only the sidebar.
  - Code blocks are re-highlighted only where a change touches them
    (`components/document-editor/incremental-lowlight.ts`).
  - The Yjs sync plugin skips its pass when the document is unchanged.
- Root README restructured for evaluators, self-hosters, operators and
  contributors.

## 2026-11-09 · #12 Installable app, offline editing, faster large documents

### Added
- **Installable app (PWA).**
  - Full web app manifest with a frozen `id` of `/`, plus icons: any-192/512
    and maskable-512 from `app/pwa-icons/[id]`, and an opaque apple-touch-icon.
  - `theme-color` follows the dark-mode toggle; iOS web-app metadata.
  - An install button in the status strip, with a one-line iOS
    "Add to Home Screen" hint.
  - Analytics records `pwa_install { outcome }` only.
- **Service worker** (`lib/pwa/*`, Next 16's native Turbopack worker):
  - pages are network-first, falling back to a stored copy or `/offline`;
    `/_next/static` is cache-first;
  - `/api`, RSC requests, cross-origin requests and WebSockets are never
    handled by the worker;
  - two-layer kill switch: `NEXT_PUBLIC_SERVICE_WORKER=0` plus a source
    `KILL_SWITCH` constant.
- **Offline editing, on by default** (`lib/offline/`, `lib/collab-session.ts`):
  - documents and the tab list open from IndexedDB before the server answers,
    and offline edits sync on reconnect;
  - copies last 14 days, at most 30 documents are kept, and offline edits pause
    at 512 KiB;
  - `/privacy` discloses the copies and has a "Delete offline copies" button;
  - `NEXT_PUBLIC_OFFLINE_CACHE=0` turns copies off and deletes stored ones.
- **Connection UX.**
  - Online / connecting / offline status with one live region.
  - Amber offline banner; tab create and close are disabled while offline.
  - A calm pre-ready offline notice; `100dvh` layout.
- Unsynced edits survive tab switches, and the leave-page prompt appears only
  while edits are unsynced.

### Changed
- **Large documents render once on mount instead of three times**
  (`extensions/render-once/`), and off-screen blocks skip layout
  (`content-visibility: auto`). With 1,247 blocks on an emulated phone, content
  appears at 3.9 s (was about 6 s), the longest freeze is 1.2 s (was 3.1 s) and
  heap use is 28 MB (was 53 MB).
- Tab titles change only from the visitor's own edits, never from cached or
  remote renders.

### Fixed
- Playground regenerate no longer replays on every editor remount.
- A closed tab's still-open session can no longer write its offline copy back.

### Security
- **Deleted documents stay deleted for offline clients.**
  - Tombstoned names are refused at connect.
  - Tab repair drops their tabs.
  - The retention purge tombstones expired documents.
  - Tombstones last `TOMBSTONE_RETENTION_DAYS` (default 90).
- Updates that only delete content may pass the size cap, so an over-cap
  document can be trimmed.
- CSP gains `worker-src 'self'` and `manifest-src 'self'`.

### Deploy
- Pull, build, and restart with `--update-env`.
- Check that `/_next/static/service-worker/sw.js` keeps
  `Cache-Control: public, max-age=0, must-revalidate` through the proxy. See
  `docs/operations/service-worker-runbook.md`.

## 2026-11-09 · #11 Faster first load, app-shell skeleton

### Added
- **App-shell skeleton** (`components/app-skeleton`). It is server-rendered in
  the live editor's geometry (tab bar, toolbar, outline, page card), with the
  SEO intro in the page card, and one skeleton covers every loading phase.

### Changed
- **The editor bundle is code-split** and preloaded while the tab list syncs.
  Initial JavaScript went from about 590 KB to 289 KB gzip.
- **One shared WebSocket** carries the tab list and documents, through a
  reference-counted session cache with deferred release
  (`lib/collab-session.ts`).
- **A cheaper table of contents** (`extensions/table-of-contents`): no forced
  layout per keystroke, rebuilds once per frame, and React is notified only
  when the active heading changes.
- Code blocks without a language skip highlight auto-detection.

### Fixed
- A document refused for size no longer triggers a reconnect storm. Before,
  clients retried about three times a second until Throttle banned their IP for
  five minutes.

## 2026-11-09 · #10 Over-cap documents open again

### Fixed
- The size guard counted the empty sync step 2 every client sends on connect,
  so documents already over the cap could not even be opened. Refused edits now
  make the editor read-only with a notice.

### Deploy
- Production allows 2 MiB documents (`MAX_DOC_SIZE_BYTES` in
  `ecosystem.config.cjs`); restart with `--update-env`.

## 2026-11-09 · #8, #9 Dependabot action updates

### Changed
- `actions/checkout` 7.0.1 and `actions/setup-node` 7.1.0, still pinned to
  commit SHAs.

## 2026-11-09 · #7 SEO, analytics and security hardening

### Added
- **SEO.**
  - Server-rendered intro instead of an empty body.
  - Metadata, Open Graph and Twitter cards, and a canonical URL.
  - `robots.txt`, `sitemap.xml`, manifest, icons and a share image.
  - `llms.txt` and a JSON-LD graph.
  - `/about` (features and FAQ) and `/privacy`.
  - `SEO_NOINDEX=1` for previews; `lib/site-config.ts` as the single source of
    copy.
- **Opt-in Google Analytics 4** (`NEXT_PUBLIC_GA_MEASUREMENT_ID`).
  - Nothing loads before the visitor clicks Allow, and GPC, DNT and automated
    browsers are never asked.
  - Consent Mode v2, with the query string stripped from page URLs.
  - Content-free events only. Setup checklist:
    `docs/operations/analytics-runbook.md`.
- Privacy controller and contact from `NEXT_PUBLIC_PRIVACY_CONTROLLER` and
  `NEXT_PUBLIC_PRIVACY_EMAIL`.

### Changed
- The Playground generates 4–6 sections, 3 levels deep (was 32–56, 6 deep).
- Tab can leave the formatting toolbar (WCAG 2.1.2).
- Embedded images are downscaled in the browser to
  `NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES` (default 256 KB).

### Security
Fixes from a full OWASP review in which each finding was confirmed by two
independent reviewers (3 high, 5 medium, 7 low):
- `global-tabs-*` test documents are only accepted with
  `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1` (dev and tests); system documents are
  size-capped.
- The shared tab list is sanitized on every client read and repaired on the
  server.
- Size is enforced on incoming updates. Frame size, backpressure and awareness
  state are capped.
- Connections are counted only once established. Sockets are capped per IP and
  in total, upgrades are rate-limited, and unauthenticated sockets time out.
- `HOCUS_ALLOWED_ORIGINS` origin allowlist; deleted documents are tombstoned
  against resurrection.
- Code block languages are validated (`SafeCodeBlock`).
- A `Permissions-Policy` header; JSON-encoded Hocuspocus logs; structured abuse
  events.
- The dependency-refresh workflow runs without a write token, and its actions
  are pinned to SHAs.

### Deploy
- Set `HOCUS_ALLOWED_ORIGINS` (already in `ecosystem.config.cjs`).
- Back up the database and remove stray `global-tabs-*` rows.
- Click Regenerate on the Playground after deploying.

## 2026-11-09 · #6 Hocuspocus 4

### Changed
- Hocuspocus 4 on `Bun.serve`, with `bun:sqlite` persistence in the Hocuspocus
  process and better-sqlite3 13 on Node.

## 2026-11-09 · #5 Trailing paragraph

### Fixed
- The trailing node appends a paragraph instead of an empty heading.

## 2026-11-09 · #4 Tooling

### Changed
- Biome skips files ignored by git, and the extension refresh workflow runs on
  Node 24 actions.

## 2026-11-08 · #2 Trusted proxy

### Security
- Forwarding headers are trusted only with `TRUSTED_PROXY=1`, so clients can no
  longer spoof their IP to dodge per-IP limits.

## 2026-11-08 · #1 docs.plus editor extensions

### Added
- The `@docs.plus/extension-*` packages: Hyperlink, InlineCode, Indent,
  Placeholder, Mermaid and HyperMultimediaKit. Stored `link` and `code` marks
  are renamed on load.
- The Playground showcases the extensions, Mermaid diagrams and charts.
- A workflow refreshes the extensions every three days and opens a pull
  request.

### Changed
- All dependencies were updated to their latest versions, and the CSP allows
  the media embed providers by exact host.

### Fixed
- Heading fold animations finish after the editor remounts, tab import keeps
  the last active tab, and the TOC marks the active entry.

## 2026-03-16 – 2026-03-21 · Testbed baseline

The foundation these releases build on (see `docs/plans` and
`docs/brainstorms`):
- title-first schema;
- heading fold, drag, filter and scale extensions;
- TOC sidebar with drag-and-drop section moves;
- synced tabs with reorder and close-all;
- collaboration carets and user identity;
- shadcn/ui migration;
- abuse guardrails and retention purge;
- optional Redis and PM2 runtime;
- unit, e2e, soak, stress and Yjs load test layers.
