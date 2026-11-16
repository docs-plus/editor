> **Amended by** [the details spec](2026-11-15-desktop-documents-and-editor-details.md) (§11 lists what changed) and, for every setting, by [the preferences design](2026-11-16-preferences-design.md) (§3 lists the conflicts). Where they differ, those documents win. References to P2.7 here mean P2.7a (tree, keyboard, Quick Open) or P2.7b (list views). By owner decision D6, "Local release" and "Live release" now name internal milestones of one combined v1 release. **Plan v7 (D23–D32, 2026-11-16):** search covers metadata only, never document body text (D24, §4.3); the keyboard map takes the staff integration review's fixes (§4.6); the [onboarding, templates and import](2026-11-16-onboarding-templates-import-design.md), [languages and RTL](2026-11-16-languages-rtl-design.md) and [search and links](2026-11-16-search-linking-design.md) designs win for their features.

> **Phones and tablets (D36):** where this document and [the phones-tablets design §14](2026-11-16-phones-tablets-design.md) differ on phone or tablet behaviour, the phones design wins.

# TinyDocy Desktop: UX design

- **Status:** Draft for owner review (2026-11-15). Nothing is built yet.
- **Plan:** [Desktop local-first design, v7](2026-11-15-desktop-local-first-design.md). This document expands plan §5 into a buildable UX spec. Where the two disagree, the plan holds. Plan v5 and v6 adopted the changes listed in §12.
- **Architecture:** [2026-11-15-desktop-architecture.md](2026-11-15-desktop-architecture.md). §6 there defines the states that this document names.
- **Earlier research:** [File manager and sharing UX](../../research/2026-11-15-desktop-file-manager-and-sharing-ux.md). That document predates v4, and v4 supersedes it in these places:
  - the visible `~/Documents/TinyDocy` folder model
  - content search
  - per-document version history
  - the same document open in two windows
  - dragging a tab out to a new window
  - PDF, Print and `.docx`
  - a sharing-server setting
  - the "Not here" and conflicting-copy states
  - "People here now"

  None of those are designed here.
- **Scope:**
  - **The Local release** in full.
  - **The Live release** only where the Local release must leave room for it: the chip slot, the Share button slot, menu positions.
  - The Live-release dialogs and states stay as plan §5.4–5.5 describes them, and they get their own design pass in P4.4.
- **Bar:** Bear, Craft, Linear, Obsidian, Apple Notes, iA Writer. The test is simple: a person who has never seen the web app should not be able to tell this is a web page.

Glyphs in the sketches stand in for lucide icons (`lib/icons.tsx`). The shipped UI uses lucide only.

---

## 1. Principles

These rules decide the cases this document doesn't spell out.

1. **The OS owns the frame, the app owns the page.** Window controls, menus, context menus, file pickers, confirmation sheets, scrollbars, the cursor and window management are the platform's. The editor, sidebar and list views are TinyDocy's. When in doubt, use the native thing.
2. **Local actions never wait visibly.**
   - Anything that touches only the library shows its result in the same frame (optimistic) and confirms quietly.
   - Spinners exist only for work that can take seconds: update download, Export all, a large import, Back up now.
3. **Always saved, never "saving".**
   - There is no Save command, no unsaved dot and no "Saving…" text.
   - The app speaks about saving only when something is wrong (§5).
4. **Nothing changes layout on its own** (AGENTS.md).
   - A message that appears after the document is on screen goes through the status pill, or into a slot that is already reserved.
   - Layout changes only when the person resizes the window or toggles something.
5. **Fixed faces** (owner rule).
   - A control's face is one fixed icon plus at most one fixed word.
   - Counts, reasons and dates live in popovers, tooltips and list columns, never on a face.
6. **One feedback channel.**
   - `announce()` and the `StatusPill` are the only transient feedback: 2.5 s, or 5 s with one action.
   - No toast library is added (§6.1).

---

## 2. What makes it feel native

### 2.1 Window chrome per OS

#### macOS: unified titlebar, tabs in the titlebar

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  [▤] [‹][›]  │ ⚗ Playground │ Q4 plan          × │ Meeting notes × │ [+]  │ 40 px row = titlebar
├──────────────────────┬─────────────────────────────────────────────────────────┤      empty space = drag region
│ [⌕ Search      ⌘O]   │ B I U  A▾  ¶▾  ⋯                          [▭ Local]     │ toolbar row (existing)
│  ⚗ Playground        │─────────────────────────────────────────────────────────│
│  ◷ Recent            │  OUTLINE        │      Q4 plan                           │
│  ★ Pinned            │  Goals          │      Goals                             │
│  ▾ Library           │  Risks          │      Ship the desktop app…             │
│    ▸ Project notes   │                 │                                        │
│    ▾ Drafts          │                 │                                        │
│       Meeting notes  │                 │                                        │
│       Q4 plan        │                 │                                        │
│ ───────────────────  │                 │                                        │
│  🗑 Trash        [⚠] │  ← footer row: Trash left, app-health slot right          │
└──────────────────────┴─────────────────┴────────────────────────────────────────┘
```

- **Window options.**
  - `titleBarStyle: "hiddenInset"`.
  - `trafficLightPosition` centres the traffic lights vertically in the 40 px row.
  - The row holds the traffic lights, the sidebar toggle, back and forward, the tabs, and New tab.
  - This is the same pattern as Safari's compact tabs and Obsidian.
  - Apple's Big Sur guidance makes the unified, content-first toolbar the default for content windows ([WWDC20 10104](https://developer.apple.com/videos/play/wwdc2020/10104/)).
- **Drag region.**
  - Empty titlebar space is `-webkit-app-region: drag`.
  - Every tab, button and the tab strip's drop zone are `no-drag`. Otherwise dnd-kit tab reordering can't receive the pointer.
  - The reorder sensor needs a 4 px activation distance, so a click on a tab never starts a window drag.
- **Double-click on empty titlebar space** follows the system setting (Zoom or Minimize).
  - **Verify in S1** that Electron honours this on drag regions.
  - If it doesn't, main reads `systemPreferences.getUserDefault("AppleActionOnDoubleClick", "string")` and calls `maximize()` or `minimize()` itself.
- **Sidebar collapsed.** The tab row starts right after the toggle. The sidebar's titlebar area isn't left empty.
- **Full screen** (`enter-full-screen`).
  - The traffic lights are hidden, so the 78 px leading inset collapses.
  - The tab row stays. The menu bar reveals on hover, as the system does.
- **Window title.**
  - `win.setTitle(documentTitle)`, or "Untitled".
  - The title is hidden in the titlebar, but Mission Control, the Window menu, ⌘\` and the Dock's window list use it.
  - No "– TinyDocy" suffix on macOS.
- **No represented file or edited dot.**
  - Documents aren't files, so `setRepresentedFilename` has nothing true to point at.
  - `setDocumentEdited` stays false, because the document is always saved ([Electron: represented file](https://www.electronjs.org/docs/latest/tutorial/represented-file)).
- **Liquid Glass and corner radius on macOS 26.**
  - Use Electron's default frame. Don't override corner masks.
  - Electron removed its `cornerMask` override after it caused WindowServer GPU load on Tahoe ([electron#48400](https://ayakael.net/mirrors/electron/commit/9a2b4f84be2f4bcc468a63ef93520e60790b8f3c), [AppleInsider](https://appleinsider.com/articles/25/10/10/update-your-slack-discord-clients-the-electron-tahoe-gpu-slowdown-bug-is-fixed)).
  - Pin an Electron version that includes that fix.

#### Windows 11: custom titlebar with system caption buttons

```text
┌──────────────────────────────────────────────────────────────────────────  ─   ▢   ✕ ┐
│ [≡] [▤] [‹][›] │ ⚗ Playground │ Q4 plan       × │ Meeting notes × │ [+]   (drag)  │ WCO│ 40 px
├────────────────────┬─────────────────────────────────────────────────────────────────┤
│ [⌕ Search  Ctrl+O] │ B I U  A▾  ¶▾  ⋯                                   [▭ Local]   │
```

- **Window options.**
  - `titleBarStyle: "hidden"` plus `titleBarOverlay: { height: 40, color, symbolColor }`.
  - Windows draws minimise, maximise and close, so they look and behave like every other app ([Electron: custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)).
  - Nothing is placed under the overlay region. The tab strip ends at `env(titlebar-area-width)`.
- **Snap layouts.**
  - Windows shows them when the pointer hovers the maximise button or on Win+Z, but a custom titlebar can break this ([Microsoft Learn: snap layouts](https://learn.microsoft.com/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)).
  - Electron's overlay was added for this ([electron#29600](https://github.com/electron/electron/pull/29600)), but there are community reports of the flyout missing.
  - **Verify in S1** on Windows 11 24H2 or later. Fallback: a native frame with the tabs below it.
- **Minimum window width.**
  - Microsoft recommends supporting 500 epx at most, and ideally 330 epx (same source).
  - The window minimum is **480 × 360**.
  - Below 720 px the sidebar becomes an overlay (§4.4). The toolbar's collapse ladder already handles narrow widths.
- **≡ (menu button).**
  - It pops the native application menu (`Menu.popup`) under itself.
  - Alt pressed and released alone, or F10, opens the same menu with the first item focused, as Windows users expect.
  - AltGr (which arrives as Ctrl+Alt) must not trigger it.
  - The same menu also backs the keyboard map in §4.6.
- **Caption colours.**
  - `setTitleBarOverlay({ color, symbolColor })` updates on theme change and on high contrast (`nativeTheme` `updated`).
  - In forced colours the overlay uses `ButtonFace` and `ButtonText` equivalents (§8.6).
- **Mica: not in v1.**
  - Microsoft says title bars should blend with the window. Mica is the default title bar background, but blending matters more ([Microsoft Learn: title bar design](https://learn.microsoft.com/windows/apps/design/basics/titlebar-design)).
  - A flat titlebar in the sidebar's colour blends with the window and avoids a transparent-window test matrix.
  - `backgroundMaterial: "mica"` is a later polish item (§2.2).
- **Window title.** "Q4 plan – TinyDocy". The taskbar, Alt+Tab and Task View read it.

#### Linux: native frame, native menu bar

```text
┌─ Q4 plan – TinyDocy ─────────────────────────────────────────────── (WM frame) ─┐
│ File  Edit  Format  View  Document  Window  Help                                 │ native menu bar
│ [▤] [‹][›] │ ⚗ Playground │ Q4 plan       × │ Meeting notes × │ [+]               │ tab row (no drag)
├────────────────────┬─────────────────────────────────────────────────────────────┤
```

- **Frame.** The default `frame: true`, drawn by the window manager or by Electron's GTK client-side frame on GNOME Wayland.
  - Electron 38.2+ defaults to Wayland, and frame behaviour differs between GNOME and KDE.
  - Electron recommends testing on both ([Electron: Wayland tech talk](https://www.electronjs.org/blog/tech-talk-wayland)).
  - The S5 IME check runs on the same builds.
- **Menu bar.** A visible menu bar (`autoHideMenuBar: false`).
  - GNOME's HIG prefers header bars, and says header bars and menu bars don't mix ([GNOME HIG: header bars](https://developer.gnome.org/hig/patterns/containers/header-bars.html)).
  - We choose the menu bar for v1. The app has a large command set, and the Window Controls Overlay on Linux is newer and less tested across window managers.
  - Revisit after S1.
- **Super key.** No shortcut uses Super. GNOME reserves it ([GNOME HIG: keyboard](https://developer.gnome.org/hig/guidelines/keyboard.html)).

### 2.2 Native-feel checklist per item

"Verify" means an S1 or S5 check before anyone builds on it. The owner PR uses the plan's §8 numbering. P2.9 is split into **P2.9a** (chrome) and **P2.9b** (first run, Settings, backups, Help), as §12 proposed; the page preferences are P2.9c-1 and P2.9c-2.

| Item | macOS | Windows 11 | Linux | Electron support | PR |
|---|---|---|---|---|---|
| Titlebar | `hiddenInset`, tabs in the titlebar | `hidden` + `titleBarOverlay` | native frame | `titleBarStyle`, `trafficLightPosition` (mac), `titleBarOverlay` (Win; Linux since #42682) | P2.9a |
| Vibrancy or Mica | **Flat in v1.** The sidebar uses an opaque tone close to the system sidebar. | Flat in v1 | Flat | `vibrancy` (mac), `backgroundMaterial` (Win 11). Mica is meant for long-lived surfaces and falls back to solid on Windows 10 ([Microsoft Learn](https://learn.microsoft.com/windows/apps/design/basics/titlebar-design)) | later |
| Font | **Chrome:** system font (SF Pro). **Document:** the page font preference, Default (Arial), at the Text size preference, 16 px in rem by default (owner Q1; preferences design §2.1). | Chrome: Segoe UI Variable | Chrome: `system-ui` (Cantarell, Adwaita Sans or Ubuntu) | CSS `system-ui`. Inter is self-hosted by `next/font` at build time, so it makes no network request (verify in S1). | P2.9a |
| Chrome text size | 13 px body, 11 px section labels | 14 px body, 12 px labels | 14 px body | CSS | P2.9a |
| Row height (sidebar, lists) | 28 px | 32 px | 32 px | CSS | P2.7 |
| Accent colour | Selected row (when its region has focus) and the focus ring use the system accent | Same | App default (no API) | `systemPreferences.getAccentColor()` (mac, Win), passed to CSS as `--os-accent`; live updates via `accent-color-changed` (verify) | P2.9a |
| Scrollbars | System overlay scrollbars, following "Show scroll bars" | Chromium's platform scrollbars | Chromium's | **No `::-webkit-scrollbar` styling on desktop.** Whether Chromium draws Fluent-style scrollbars on Windows 11 is unverified; check in S1. | P2.9a |
| Context menus | Native | Native | Native | `Menu.popup`; the `context-menu` event carries spelling suggestions ([Electron: spellchecker](https://www.electronjs.org/docs/latest/tutorial/spellchecker)) | P2.7 (tree, list, tabs), P2.9a (editor) |
| Drag regions | Empty titlebar space | Empty titlebar space | none (native frame) | `-webkit-app-region` | P2.9a |
| Double-click the titlebar | System setting (Zoom or Minimize) | Maximise or restore (native) | WM | Verify on drag regions in S1 | P2.9a |
| Window state restore | Bounds, display, maximised, full screen, sidebar width and collapsed state, tabs, active tab, each tab's history head | Same, plus snap state where Windows restores it | Same | `getNormalBounds`, `screen.getAllDisplays()`. If the saved bounds fall off every display, centre on the primary display. | P2.9a |
| Restore windows at launch | Respect the system "Close windows when quitting an application" setting (`NSQuitAlwaysKeepsWindows`, verify) | Always | Always | `systemPreferences.getUserDefault` | P2.9a |
| Full screen | Native full screen, ⌃⌘F | F11 | F11 | `setFullScreen`, `enter-full-screen` | P2.9a |
| Multiple windows | One window per document; ⌘\` cycles; Window menu lists windows | Taskbar groups windows | WM | `role: "windowMenu"` gives Minimize, Zoom, the macOS tiling items and Bring All to Front | P2.5 (registry), P2.9a (menu) |
| Closing the last window | The app keeps running. A Dock click opens a window on Recent. | Quits after flush | Quits after flush | `window-all-closed`, `activate` | P2.5 |
| Dock or taskbar badge | **None.** In the Local release there is nothing to count. | None | None | `app.setBadgeCount` (mac, Unity); `setOverlayIcon` (Win). The docs disagree about Windows (verify if it's ever needed). | — |
| OS recent documents | **Custom Dock menu**: New Document, New Window, then up to 5 recent titles | **Jump List** custom category "Recent" (5) plus tasks New Document and New Window | `.desktop` Actions: New Document, New Window (static) | `app.addRecentDocument` takes **file paths only** ([Electron: recent documents](https://www.electronjs.org/docs/latest/tutorial/recent-documents)), and our documents aren't files. Use `app.dock.setMenu` and `app.setJumpList` with arguments the argv filter accepts (§12, C3). | P2.9a + P2.5 |
| Open Recent | File › Open Recent ▸: 10 titles, then Clear Menu | Same | Same | A custom submenu rebuilt from the index (debounced 1 s). The `recentdocuments` role needs files. | P2.9a |
| Drop a file on the Dock icon or Open With | Imports `.md`, `.html` or `.tinydoc` | Open With and shortcut drops pass paths in argv | Same | `open-file` (mac); `second-instance` argv (Win, Linux). Needs file associations from electron-builder and a wider argv filter (§12, C3). | P2.8 + P2.5 |
| Drop a file on the window | Overlay "Drop to import" (§5.4) | Same | Same | DOM drop events, with paths read through `webUtils.getPathForFile` in the preload | P2.8 |
| Destructive confirmations | Window-modal sheet | Modal dialog | Modal dialog | `dialog.showMessageBox(win, …)`, which is a sheet on macOS | P2.8 |
| File pickers | Native | Native | Native (portal on Flatpak, later) | `dialog.showOpenDialog` / `showSaveDialog` | P2.8 |
| Show in Finder / File Explorer / Files | Reveals the document's **readable backup file** (§5.6) | Same | Same | `shell.showItemInFolder` | P2.8 |
| Mouse back/forward buttons, swipe | Two-finger swipe goes back and forward | Mouse buttons 4 and 5 | Mouse buttons 4 and 5 | `swipe` (mac); `app-command` `browser-backward`/`forward` (Win, Linux) | P2.7 |

### 2.3 Browser-isms to remove (desktop target only)

These are the small tells that give a web page away. Each one is CSS or a main-process flag and costs nothing on the web.

| Tell | Fix | PR |
|---|---|---|
| A pointing-hand cursor on buttons, tabs and rows | `cursor: default` on chrome controls. The hand stays only on real links in the document. | P2.9a |
| Chrome labels can be selected by dragging | `user-select: none` on chrome. Selection stays in the editor, inputs and list cells that are meant to be copied. | P2.9a |
| Images and links in the chrome can be dragged out | `draggable="false"` | P2.9a |
| Pinch or Ctrl+wheel zooms the page | `webFrame.setVisualZoomLevelLimits(1, 1)`. Ctrl/⌘ + wheel and pinch step the document's **Text size**, throttled to one step per 150 ms, never page zoom. Interface zoom has no key or gesture (preferences design C2). | P2.5, P2.9a |
| ⌘R / F5 reloads, DevTools open, Backspace navigates back | Not in the production menu; no accelerators for them | P2.5 |
| A white flash before the first paint | `show: false`, then show on `ready-to-show`, with `backgroundColor` from `nativeTheme` (§3.1) | P2.5 |
| A focus ring on mouse click | `:focus-visible` only. Already true for `Button`; extend it to tree rows, tabs and list rows. | P2.7 |
| Right-click shows nothing (Electron has no default menu) | Native context menus everywhere (§2.5) | P2.9a |
| ⌘F does nothing (there is no browser find bar) | An in-document Find bar (§12, C7, adopted by the plan as P2.11) | P2.11 |
| Links in the document replace the app | `will-navigate` is denied. `https` links open in the system browser (plan §7). | P2.5 |
| The web intro, SEO card, "Can't reach the collaboration server" and the offline banner | Never rendered on desktop (§3.3) | P2.4 + P2.9a |

### 2.4 Menus

The order follows the macOS HIG: app menu, File, Edit, Format, View, then app menus, Window, Help ([Apple HIG: the menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)). Plan §5.6 lists View before Format. This spec puts **Format before View**, as TextEdit and Pages do. Windows and Linux leave out the app menu: its items move to File and Help.

| Menu | Items (shortcuts in §4.6) |
|---|---|
| **TinyDocy** (mac) | About TinyDocy · Check for Updates… · Settings… · Services ▸ · Hide TinyDocy · Hide Others · Show All · Quit TinyDocy |
| **File** | New Document · New Folder · New Window · Quick Open… · Open Recent ▸ · Import… · Export ▸ (Markdown… / HTML… / TinyDocy document…) · Export All… · Close Tab · Close Window · *(Win/Linux)* Settings… · Exit/Quit |
| **Edit** | Undo · Redo · Cut · Copy · Paste · Paste and Match Style · Select All · Find ▸ (P2.11) · Spelling ▸ (Check Spelling While Typing, the same setting as Settings › Writing) · *(mac)* Emoji & Symbols |
| **Format** | Mirrors the action registry groups (marks, styles, lists, alignment, Clear formatting, Repeat), each item showing its registry shortcut |
| **View** | Show/Hide Sidebar · Show/Hide Outline · Simplified Toolbar ✓ · — · Page Width ▸ (Narrow / Standard / Wide / Full, this document) · Text Size ▸ (Larger Text ⌘+ / Smaller Text ⌘− / Actual Size ⌘0) · Font ▸ (Default / Sans / Serif / Mono / Legible) · Page… · Reading Mode ⌥⌘R ✓ · Hide Comments (Live) · — · Enter Full Screen. There are no Zoom items: interface zoom lives in Settings › General and the palette (preferences design §4.5). |
| **Document** | Rename · Duplicate · Move to… · Pin/Unpin · Show in Finder (OS label) · Restore from a Daily Snapshot… · Move to Trash · *(Playground only)* Reset Playground · *(Live release adds:)* Share… · Manage Sharing… |
| **Window** | `windowMenu` role, then Next Tab · Previous Tab · Reopen Closed Tab · Back · Forward · the window list |
| **Help** | TinyDocy Help · Getting Started · Where Are My Documents? · Backup and Restore · Moving Computers · Keyboard Shortcuts · Report a Problem… · Copy Diagnostics · *(Win/Linux)* About TinyDocy |

Rules:

- **Menu state follows focus.**
  - Items that act on "the selection" (Rename, Move to Trash, Duplicate) act on the focused tree or list row when the sidebar or a list has focus, and on the active document otherwise.
  - The label never changes. Enablement does.
- **One source for labels and shortcuts.**
  - The Format menu reads labels and `KeyCombo`s from `lib/editor-actions` through main.
  - Main receives a serialised table at startup: ids, labels and combos, no functions.
  - Clicking an item sends `app.menuIntent { actionId }` to the focused window, which calls `runAction`.
- **Menu shortcuts vs editor keymaps.** Many menu shortcuts are already bound inside the editor: marks, Undo, ⌘⌫.
  - The intended rule: the menu *displays* the combo but doesn't register it globally (`MenuItem.registerAccelerator: false`), and the editor keymap handles the key.
  - **Verify in S1, per OS:**
    - whether `registerAccelerator: false` still shows the combo on macOS and on Windows/Linux
    - whether a registered macOS key equivalent fires before the renderer's `keydown`
    - that one key press never runs an action twice
- **Edit › Undo and Redo** send a menu intent that runs the editor's Yjs-aware `undo`/`redo` (`lib/editor-actions` history actions).
  - They must not use the `undo` role. That calls `webContents.undo()`, which is contenteditable's own undo and bypasses ProseMirror and Yjs.
  - **Verify in S1** that the role-less items still get native enablement, or drive enablement from `can().undo()`.
  - When focus is in the sidebar or a list, Undo undoes the last file operation instead (§6.2).
- **Cut, Copy, Paste and Select All keep their roles.** Chromium routes them through the clipboard pipeline that ProseMirror already handles.

### 2.5 Context menus

All are native `Menu.popup` menus.
- The renderer asks main for a menu by **kind**, plus a list of item ids that are enabled.
- Main builds the labels. Titles appear only in labels main controls, such as "Move “Q4 plan” to Trash".
- The selected id comes back as a menu intent.

| Where | Items |
|---|---|
| **Editor text** | *Spelling suggestions (up to 5) · Add to Dictionary* (only on a misspelled word) · Cut · Copy · Paste · Paste and Match Style · Select All · Link… · *(on a link)* Open Link · Copy Link · *(mac)* Look Up “word” |
| **Editor image** | Copy Image · *(remote placeholder)* Load Images in This Document |
| **Tree or list: document** | Open · Open in New Tab · Open in New Window · Rename · Duplicate · Move to… · Pin/Unpin · Show in Finder · Export ▸ · Move to Trash |
| **Tree: folder** | New Document · New Folder · Rename · Move to… · Move to Trash |
| **Trash list** | Restore · Delete Forever · Empty Trash… |
| **Tab** | Close Tab · Close Other Tabs · Reopen Closed Tab · Move Tab to New Window (only if the window has 2+ tabs) · Show in Sidebar · Pin/Unpin |
| **Playground** (tree or tab) | Open · Reset Playground |

Keyboard: Shift+F10 and the Menu key open the same menu at the focused row, or at the caret in the editor.

### 2.6 Windows, tabs and lifecycle

- **One window per document** (D-A3).
  - Opening a document that is open in another window focuses that window and switches to its tab. A pill in that window says nothing; the focus change is the feedback.
  - Opening a document already in a tab of *this* window switches to that tab.
- **Tabs belong to their window.** Closing a tab never deletes anything.
- **⌘W on the last tab closes the window** (Safari, Chrome).
- **New Window** opens on the Recent list. It never creates an empty "Untitled" document.
- **Move Tab to New Window** moves the registry claim to the new window in one step, so there's no window in which the document is "open twice".
- **Quit (⌘Q).**
  - Quits immediately, with no "Are you sure?". The flush is invisible and capped at 3 s (architecture §6.3).
  - In the rare case that `saving_behind` is still true when the cap is hit, main shows a sheet:

    > **Some changes haven't been saved yet.**
    > TinyDocy is still writing your latest changes. Quitting now could lose the last few seconds of typing.
    > **[Wait]** [Quit Anyway]

    Wait has focus. A second ⌘Q means Quit Anyway.
- **Crash recovery.** After an unclean exit, windows and tabs come back as they were. The architecture's "Checking your library…" copy shows only if the check takes over 1 s (§5).

### 2.7 macOS-only niceties (cheap, high signal)

- **Services ▸ and Look Up** come with the app menu and the editor context menu.
- **Emoji & Symbols** (⌃⌘Space) works in contenteditable already. Keep the Edit menu item.
- **Window tiling** (macOS 15+) comes with `role: "windowMenu"`.
- **The `activate` event** opens a window on Recent when no windows are open.

---

## 3. Speed and perceived performance

### 3.1 Cold start

The architecture §10 budget stands: first editable document ≤ 1.2 s on an M1, ≤ 2.0 s on a mid-range Windows laptop. The UX rule is about **what the person sees in that time**.

| t (Mac / Win) | What is on screen |
|---|---|
| 0 → ~400 / 700 ms | Nothing. The window isn't shown yet. **No white frame and no empty window.** |
| Window shown (`ready-to-show`) | The **desktop shell skeleton**, already in the restored geometry: titlebar with the real tab titles and sidebar width (main passes the saved window state in the URL hash or via `additionalArguments`), sidebar section headers (Playground, Recent, Library, Trash), the toolbar row in its final size, and the page card **empty**. No shimmer. |
| ≤ 600 ms / 1.0 s | Sidebar rows populated in one paint, not row by row. |
| ≤ 1.2 s / 2.0 s | The active document is editable, with the caret at its "Continue where you left off" position. Back-tab documents hydrate lazily on first switch. |
| > 1.0 s extra (unclean exit only) | "Checking your library…" in the page card, then the document. |

- **`backgroundColor`** comes from `nativeTheme.shouldUseDarkColors` (and the user's Appearance setting), so the first frame matches the theme.
- The static shell is painted before JS. **The content skeleton (`SkeletonDocument`) appears only if the document takes more than 150 ms after the shell.** Below that it's never shown, so most opens don't flicker.

### 3.2 Switching and opening documents

| Action | Target (Mac / Win, 500 KB doc) | Visible behaviour |
|---|---|---|
| Switch to a tab whose Y.Doc is already loaded in this window | ≤ 100 / 150 ms to editable | Instant. No skeleton. |
| Open from the sidebar, Quick Open or Back (not loaded) | ≤ 150 / 250 ms | The title and toolbar update in the click frame. The page card stays blank (never a skeleton) for up to 150 ms, then shows `SkeletonDocument`. |
| New Document (⌘N) | ≤ 150 ms | New tab, caret in the empty title heading |
| Rename, move, pin, trash, restore from Trash | Same frame | Optimistic. On failure: revert, plus a pill "Couldn't move “Q4 plan”. [Try again]" |
| Quick Open keystroke → results | ≤ 16 ms for 1,000 titles | The renderer filters the index snapshot it already holds. No IPC per keystroke. Fall back to `index.searchTitles` above 5,000 documents. |
| Sidebar with 1,000 documents | First paint ≤ 1 s (P2.6 exit) | Virtualised tree. Rows have a fixed height, so scroll position is stable. |

- **Keep loaded documents resident.** The editor remounts on every tab switch (plan non-goal: undo is still lost on switch), but the **Y.Doc** for the last 5 active tabs in a window stays loaded.
  - A switch then costs only the editor bind, not a load.
  - The registry claim exists for every tab either way, so this doesn't change D-A3.
  - Engineering confirms the memory ceiling in P2.1. Suggested: 5 documents or 50 MB per window, whichever comes first.
- **Prefetch on intent.** Pointer-down on a sidebar row (not hover) starts `doc.open`, which saves about 50–100 ms.

### 3.3 Where web loading UI must not appear on desktop

| Web UI | Desktop |
|---|---|
| `AppSkeleton` with the SEO intro card (`components/app-skeleton`, `editor-app.tsx:124-146`) | Never. The desktop root has its own shell skeleton (§3.1). |
| "You're offline. TinyDocy opens your documents when you reconnect." | Never. Offline is normal. |
| "Can't reach the collaboration server. Check your connection and reload." | Never in the Local release. |
| `OfflineBanner` and the connection strip | Never. The status chip replaces them (plan §5.1). |
| `SkeletonTabBar` | Never. Tab titles are known from saved window state. |
| `SkeletonEditorBody` (toolbar and TOC placeholders) on tab switch | Never. The toolbar and outline stay mounted. Only the page card may show `SkeletonDocument` after 150 ms. |

### 3.4 Spinners allowed

Only these, and only after 400 ms:
- Settings › Updates while downloading (determinate)
- Back up now
- Export All
- an import of more than 10 files (determinate, in the pill: "Importing 37 of 100…")
- "Restore from backup…"

---

## 4. Navigation model

### 4.1 Sidebar, tabs and windows

```text
Window ──has many──> Tab ──shows one──> Place (a document, or a list: Recent / Pinned / Library folder / Trash)
   │                   └── its own Back/Forward history of places
   └── the registry: each document is claimed by at most one window (D-A3)
Sidebar = the map of places; it never owns documents and is per window (width, collapsed, expanded folders)
```

**Decision Q3 (§13): what does a click in the sidebar do?** The recommended model is the one Finder, Safari, Obsidian and Notion share: **a click navigates the current tab.**

| Gesture | Result |
|---|---|
| Click a row, or Enter | Opens it in the current tab. If the document is already in another tab of this window, switches to that tab. If it's in another window, focuses that window. |
| ⌘-click, or ⌘Enter | Opens in a new tab, in the background (⌘⇧-click opens in the foreground) |
| ⌥⌘-click, or ⌥⌘Enter (Win/Linux: Shift+click, Shift+Enter) | Opens in a new window |
| Middle-click | New background tab |
| Click a section (Recent, Pinned, Library, a folder, Trash) | Shows that list in the current tab |

- **Why not "every open is a new tab"** (today's web, or VS Code without preview)?
  - With a sidebar, tabs pile up fast.
  - The web habit of "tab = document" carries over through ⌘-click and ⌘T, which do open new tabs.
- **Why not a VS Code preview tab?** An italic, temporary tab is a state people have to learn, and it goes against "fixed faces".

### 4.2 Back and forward

- **Each tab** keeps a history of places, capped at 50.
- Each entry stores the place plus the document's continue-position heading id, so Back returns to the same section (`lib/continue-position.ts`, `goToHeading`).
- **Buttons:** ‹ › in the titlebar row, disabled at the ends. Tooltips "Back (⌘[)" and "Forward (⌘])".
- **Keys:** ⌘[ and ⌘] on macOS; Alt+← and Alt+→ on Windows and Linux. Also mouse buttons 4 and 5 and the two-finger swipe (§2.2).
- **A trashed document in history:**
  - Back still shows it, read-only, with the Trash banner (§5.3).
  - A purged document is skipped silently.

### 4.3 Quick Open (⌘O / Ctrl+O)

```text
            ┌───────────────────────────────────────────────────┐
            │ ⌕  q4                                             │
            ├───────────────────────────────────────────────────┤
            │ ▸ Q4 plan                     Library › Drafts    │  ← selected
            │   Q4 retro notes              Library             │
            │   Q4 hiring                   Library › Team      │
            ├───────────────────────────────────────────────────┤
            │ ↵ Open   ⌘↵ New tab   ⌥⌘↵ New window   esc Close   │
            └───────────────────────────────────────────────────┘
```

- **Surface.** The `components/ui/command.tsx` (cmdk) dialog, centred at 20% from the top, 560 px wide. Same component and row height as the Alt+/ palette.
- **Empty query.** The 8 most recent documents, the Playground excluded unless it is recent.
- **Matching.**
  - Metadata only, never body text (D-A8, D24): titles first, then tags and folder names. Case-insensitive and accent-folding through the shared normalizer (Arabic→Persian letter folding, Persian/Arabic-Indic digits → ASCII). Word-prefix matches first, then substring.
  - Operators narrow by metadata: `tag:finance`, `in:Drafts`, `is:live`. Templates (`kind='template'`) are never listed.
  - Ties go to the most recently opened.
  - Matched characters are bold (not colour alone).
- **Rows.** Title, plus a folder path in muted text, which tells apart documents with the same title.
  - A trashed document shows only when nothing else matches, with "In Trash" in the path column.
- **No match.**
  - The list shows one row: **Create “q4 plan draft”** (Enter creates and opens it).
  - Under it, muted text: "Search looks at titles, tags and folders, not inside documents." (D24; Find, ⌘F, searches inside the open document.)
- **Footer.** Key hints, plus "Import a file… ⌥⌘O" on macOS. That keeps the HIG meaning of "Open" one step away, since we bend ⌘O (the research doc's §4.2 reasoning).
- **The sidebar's "Search" field** is a button styled as a field. Clicking it opens Quick Open. There's one search surface, not a tree filter as well.
- **Focus.** When Quick Open closes, focus returns where it was. After an open, focus goes to the editor, at the caret position.

### 4.4 Command palette: decision

The editor already has a cmdk **action palette on Alt+/** (fallback Alt+Shift+Z), listed from the action registry (`components/smart-toolbar/command-palette-host.tsx`, toolbar contract §E).

**Recommendation: one palette, not two.**
- On desktop, the same palette also lists **app commands**: New Document, New Folder, Move to Trash, Export…, Toggle Sidebar, Settings…, Reset Playground, and so on. They come from the menu table main already serialises, in their own "App" group.
- It opens with **⌘⇧P / Ctrl+Shift+P** as well as Alt+/.

| Option | Pros | Cons |
|---|---|---|
| **⌘⇧P + Alt+/ (recommended)** | Free in every keymap we checked (no `Mod-Shift-p` binding in `lib/editor-actions`, the tiptap extensions or `@docs.plus/*`). VS Code and Sublime users know it. Doesn't disturb Alt+/. | Linear users expect ⌘K |
| ⌘K | Linear, Slack and Raycast muscle memory | **⌘K is Link** (`inline.ts:208`, and the hyperlink extension binds `Mod-k`), as in Docs, Word and Notion. Moving it breaks a far more common habit. |
| ⌘P | Obsidian's palette key | The HIG reserves ⌘P for Print, which plan §15 defers but doesn't cancel |

The palette's budget rule (A7, 20 KB gz) applies to the web chunk. On desktop the app-command group loads with the desktop chrome, not the editor chunk.

### 4.5 Sidebar behaviour

- **Width** 240 px by default, resizable from 200 to 360 px with a 4 px handle. Double-clicking the handle resets it. The width is remembered per window.
- **Narrow windows (< 720 px).**
  - The docked sidebar becomes an overlay that opens from the toggle and closes on Esc, on an outside click, or after an open.
  - The person's choice ("open" or "collapsed") is kept and comes back when the window is widened again.
  - That keeps "nothing changes on its own" honest: only the presentation follows the width, as the outline already does when the main area is narrower than the page card plus 302 px (plan §5.1, preferences design §5.9).
- **Sections.** Plan §5.1 order: Search, Playground, Recent, Pinned (after the first pin), Library tree, Tags (collapsed by default, D7), then Trash in the footer row.
  - In the Local release there is **no Live section**. The Live release adds it after Pinned.
- **Recent in the sidebar** shows the 5 most recent titles inline. Its header row opens the full Recent list.
- **Live updates.**
  - Rows update from `index.changed` without moving focus or scroll.
  - A row inserted above the viewport keeps the visible rows still, so scroll is anchored.

### 4.6 Keyboard map

"Conflict" records what the key already does in the editor (from `lib/editor-actions/core/*.ts`, `tab-bar.tsx`, `use-document-editor-effects.ts`, the tiptap extensions and `@docs.plus/*`, checked 2026-11-15). Shortcuts marked **(scoped)** fire only when the sidebar or a list has focus.

#### App and files

| Action | macOS | Windows / Linux | Conflict or note | PR |
|---|---|---|---|---|
| New Document | ⌘N | Ctrl+N | none | P2.7 |
| New tab (new document) | ⌘T | Ctrl+T | Same as the web's ⌘T | P2.9a |
| New Folder | ⌘⇧N | Ctrl+Shift+N | none | P2.7 |
| New Window | ⌥⌘N | menu only | Ctrl+Alt is AltGr on many layouts (plan §5.6) | P2.9a |
| Quick Open | ⌘O | Ctrl+O | none; bends the HIG meaning (§4.3) | P2.7 |
| Import a file | ⌥⌘O | menu only | AltGr | P2.8 |
| Command palette | ⌘⇧P, Alt+/ | Ctrl+Shift+P, Alt+/ | none (§4.4) | P2.9a |
| Settings | ⌘, | Ctrl+, | **Collides with Subscript `Mod-,`** (`inline.ts:165`, `@tiptap/extension-subscript`). Decision Q2. | P1.2 (Subscript key); binding P2.9a |
| Close Tab | ⌘W | Ctrl+W, Ctrl+F4 | Never deletes (web: deletes) | P2.9a |
| Close Window | ⌘⇧W | Ctrl+Shift+W | none | P2.9a |
| Reopen Closed Tab | ⌘⇧T | Ctrl+Shift+T | none | P2.9a |
| Next / previous tab | ⌃Tab / ⌃⇧Tab, ⌘⇧] / ⌘⇧[ | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+PageDown / PageUp | ⌘⇧[ ] already exist in `tab-bar.tsx` | P2.9a |
| Go to tab 1–8, 9 = last | ⌘1 … ⌘9 | Ctrl+1 … Ctrl+9 | none (headings are `Mod-Alt-n`) | P2.9a |
| Back / Forward | ⌘[ / ⌘] | Alt+← / Alt+→ | none found | P2.7 |
| Toggle Sidebar | ⌃⌘S | Ctrl+Shift+D | ⌃⌘S is the macOS standard; `Mod-Shift-d` is free | P2.7 |
| Rename **(scoped)** | F2 | F2 | Enter opens (plan §5.6). In the editor, Document › Rename selects the title heading. | P2.7 |
| Duplicate | ⌘D | Ctrl+D | Finder's Duplicate. `Ctrl-d` is a macOS-only Emacs binding in tiptap core, so ⌘D and Win/Linux Ctrl+D are free. | P2.8 |
| Move to Trash **(scoped)** | ⌘⌫ | Delete | **`Mod-Backspace`/`Mod-Delete` are bound** by tiptap core, list, table and hypermultimedia. Scoped to the tree and lists only. | P2.7 |
| Delete Forever **(scoped, Trash list)** | ⌥⌘⌫ | Shift+Delete | Confirms first | P2.8 |
| Show in Sidebar | menu only | menu only | Keep the map small | P2.7 |
| Larger text / Smaller text / Actual size (document text size) | ⌘= ⌘- ⌘0 | Ctrl+= Ctrl+- Ctrl+0 | none (`Mod-Alt-0` is Paragraph, `Mod-0` is free). Desktop only: the web never captures these keys, which stay browser zoom. Interface zoom has no key (preferences design C2). | P2.9a |
| Reading mode | ⌥⌘R | menu only | AltGr | P2.9a |
| Full screen | ⌃⌘F | F11 | system standard | P2.9a |
| Hide / Hide Others / Minimize | ⌘H / ⌥⌘H / ⌘M | — | `Ctrl-h` is macOS Emacs (Ctrl, not ⌘) | P2.9a |
| Help | ⌘? (Help menu search) | F1 | — | P2.9b |
| Quit | ⌘Q | Ctrl+Q (Linux); Alt+F4 closes the window (Win) | — | P2.5 |
| Next / previous region | F6 / ⇧F6 | F6 / Shift+F6 | none (§8.2) | P2.7 |
| Focus toolbar | Alt+F10 | Alt+F10 | existing | — |
| Context menu | ⇧F10, or ⌃-click | Shift+F10, Menu key | — | P2.7 |
| Open the menu (Windows) | — | Alt (alone), F10 | AltGr must not trigger it | P2.9a |
| Find in document | ⌘F, ⌘G, ⌘⇧G | Ctrl+F, F3, Shift+F3 | ⌘⇧F is the heading filter (`use-document-editor-effects.ts:107`). When a list has focus, ⌘F filters the list instead (P2.7b, **scoped**). | P2.11 |
| Replace | ⌥⌘F | Ctrl+H (desktop) | v7: Ctrl+Alt+F is AltGr. On the web, Replace is reached from the find bar only (the browser owns Ctrl+H, history). | P2.11 |
| Filter list **(scoped)** | ⌘F | Ctrl+F | Only when the tree or a list view has focus; metadata matching (D24) | P2.7b |
| Heading filter **(scoped to the editor)** | ⌘⇧F | Ctrl+Shift+F | v7: today `use-document-editor-effects.ts` listens on `window` and matches `event.key === "f"`, so it fires outside the editor and fails on Persian and Arabic layouts. Fix: listen on the editor and match with `matchShortcut` (languages design §4.5, L3). | existing; fix in L3 |
| Tags… | ⌥⌘T | menu only | v7: Ctrl+Alt+T is AltGr+T on many layouts and opens a terminal on GNOME | P2.9b |
| New comment | ⌥⌘M | menu only | v7: AltGr+M is taken on German layouts. Supersedes the comments design's Ctrl+Alt+M. | P4.10 |
| Keyboard shortcuts | ⌘/ | Ctrl+/ | The sheet lists only rows that work on the current target (desktop or web) (onboarding §2.2) | OB2 |

**Not in the map (v7):** ⇧↵ "All results" in Quick Open is gone with the Search view (D24). Block move and duplicate are **menu-only in v1** (details E4: Format › Move Block Up / Down, Duplicate Block): ⌥⇧↑/↓ extend the selection on macOS and ⌥⇧D types "Î" on the US layout. Keys may come later, once the keymap module's duplicate-combo test can prove them.

**On the web library** (web library design): ⌘W, ⌘N and ⌘⇧N are reserved by the browser and never reach the page, so those actions are menu, button and palette only there; the `close-tab` hint never fires on the web; the ⌘/ sheet shows only the rows that work in a browser.

**One keymap module (v7, owner PR: L3).** `APP_KEYMAP` (onboarding OB2), `matchShortcut` and `visualStep` (languages §4.5), `formatKeyCombo` (`lib/editor-actions/key-combo.ts`) and `lib/shortcuts.ts` merge into one module that both binds and formats. Today `lib/shortcuts.ts` only formats keys and binds nothing, so a "checked against `lib/shortcuts.ts`" claim proves no conflict. The module's duplicate-combo test is the check. **Open timing question:** L3 is a v1.1 PR under D26 (languages §9.1), but the ⌘⇧F scoping fix is v1 work. Either the module and `matchShortcut` move ahead of the rest of L3 (their bytes are already in L1a's ledger line), or ⌘⇧F keeps failing on Persian and Arabic layouts until v1.1. Not decided.

#### Editor keys (unchanged; listed so nothing above collides)

⌘B / I / U, ⌘⇧S Strike, ⌘. Superscript, ⌘, Subscript (see Q2), ⌘E Inline code, ⌘K Link, ⌘\ Clear formatting, ⌘Z / ⌘⇧Z / ⌘Y Undo/Redo, ⌘⇧L/E/R/J Align, ⌘⌥0–6 Paragraph and headings, ⌘⇧7/8/9 Lists, ⌘⇧B Blockquote, ⌘⇧H Highlight, ⌘⌥C Code block, ⌘⌥V Repeat formatting (and F4 off macOS), ⌘↵ Hard break, ⌘⌫ / ⌘⌦, ⌘A, ⌘⇧F Heading filter, Alt+/ Palette, Alt+F10 Toolbar. On macOS the Emacs keys ⌃A, ⌃E, ⌃H and ⌃D are also in use.

#### Region keys

| Region | Keys |
|---|---|
| **Tree** (WAI-ARIA APG Tree View) | ↑ ↓ move · → expands a folder or goes to its first child · ← collapses or goes to the parent · Home / End · type-ahead · `*` expands siblings · Enter opens · ⌘Enter new tab · F2 renames · ⌘⌫ / Delete trashes · Shift+↑↓ extends the selection · ⌘A selects all in the folder · Esc clears the selection |
| **List view** | ↑ ↓ · Home / End · PageUp / PageDown · Enter opens · Space toggles the selection (when more than one row is selected) · F2 · ⌘⌫ / Delete · ⌘A |
| **Tabs** | ← → move focus · Enter or Space activates · ⌘W closes · ⌘⌥← / ⌘⌥→ (Win: Ctrl+Shift+PageUp/PageDown) reorders |
| **Inline rename** | Enter commits · Esc cancels · Tab commits and moves to the next row |
| **Quick Open and palette** | ↑ ↓ · Enter · ⌘Enter · ⌥⌘Enter · Esc |

---

## 5. States and copy (Local release)

The tone matches `document-notice.tsx`: short, plain, and it says what happens to the person's work. **Where:**
- *Pill* is the status pill (transient).
- *Banner* is a document notice in the reserved notice slot above the page.
- *Page* is a full main-area state.
- *Sheet* is a native window-modal dialog.
- *Footer* is the sidebar footer health slot.

### 5.1 First run, reinstall, library states

| State | Where | Copy | Actions |
|---|---|---|---|
| **First launch** (library new, no backups) | Sheet over the window, with the Playground open behind it | **Welcome to TinyDocy**<br>Your documents are kept in TinyDocy's library on this computer. A readable backup goes to the TinyDocy Backups folder in your home folder every day. Uninstalling TinyDocy doesn't delete either.<br>*Backups: ~/TinyDocy Backups* [Change…] | **[Start writing]** (creates "Untitled", caret in the title) · [Explore the Playground] (closes the sheet) |
| Backup folder picked inside iCloud, OneDrive or Dropbox | Inline under the folder line | Backups in this folder will also be copied to iCloud Drive. | (informational) |
| **Reinstall** (library missing, backups found) | Sheet before any window content | **Restore your documents from the 12 Nov backup?**<br>TinyDocy found 214 documents in ~/TinyDocy Backups. | **[Restore]** · [Start Empty] |
| After reinstall restore | Recent list view, plus pill | Restored 214 documents from the 12 Nov backup. | — |
| Reinstall restore partly failed | Sheet | **212 of 214 documents were restored.**<br>2 backup files couldn't be read. They're still in ~/TinyDocy Backups. | [Show Files] · **[OK]** |
| **Checking the library** (unclean exit, check takes > 1 s) | Page | Checking your library… | — |
| **Library from a newer TinyDocy** (`library_too_new`) | Banner in every window (fixed slot above the tab content) and a lock on the chip | **Update TinyDocy to edit your documents.** This library was updated by a newer version. You can read everything, but you can't make changes until you update. | **[Update TinyDocy]** |
| **Library unavailable** (worker crashed 3 times in a minute; `Degraded`) | Banner in every window. Documents become read-only. | **TinyDocy can't reach your library right now.** Your documents are safe. Restart TinyDocy to keep editing. | **[Restart TinyDocy]** · [Copy Diagnostics] |
| **Library can't be opened** (startup `Failed`) | Page, with no sidebar | **TinyDocy couldn't open your library.** Your documents and backups haven't been changed. | **[Try Again]** · [Restore from Backup…] · [Copy Diagnostics] · [Quit] |
| **Disk full** (`disk_full`) | Banner. Editing stays on. | **Your disk is full, so new changes aren't being saved.** Free up some space. TinyDocy will save your changes as soon as there's room. Don't quit until this message goes away. | [Show Storage Settings] |
| **Saving behind** (more than 4 MiB unacked) | Footer ⚠, plus the ⚠ dot on the chip | Popover: Your latest changes are taking a while to save. Keep TinyDocy open until this goes away. | — |
| **Backups failing** (`backups_failing`) | Footer ⚠ and the ⚠ dot on the chip (plan §5.5). Pill **once per day**. | Pill: Backups aren't being written. Your documents are safe. [Open Settings]<br>Popover and Settings: Backups aren't being written to ~/TinyDocy Backups. Your documents are safe in the library. *Last backup: 14 Nov, 09:12. Reason: TinyDocy isn't allowed to write to this folder.* | [Open Settings] · in Settings: [Try Again] [Change Folder…] |

### 5.2 Empty states

Each empty state is the list view's body: centred, a lucide icon at 32 px in muted colour, a title, a sentence, and at most two buttons.

| State | Title | Sentence | Actions |
|---|---|---|---|
| **Empty library** (only the Playground exists) | No documents yet | Documents you create or import appear here. | **[New Document]** · [Import…] |
| **Empty folder** | “Drafts” is empty | Drag documents here, or create one. | **[New Document]** (created in this folder) |
| **Empty Recent** | Nothing opened yet | Documents you open appear here. | [New Document] |
| **Empty Pinned** | — | (The section is hidden until the first pin, plan §5.1. Unpinning the last item hides the section; the list view, if open, shows "No pinned documents. Pin a document to keep it here.") | — |
| **Empty Trash** | Trash is empty | Documents you delete stay here for 30 days. | — |
| **Trash, not empty** (list footer, fixed) | — | Documents in Trash are deleted after 30 days. | [Empty Trash…] |
| **Quick Open, no match** | — | Row: Create “q4 plan draft”. Under it: Search looks at titles, tags and folders, not inside documents. | Enter creates it |
| **Quick Open, empty library** | — | No documents yet. Type a title to create one. | — |
| **Sidebar Library, empty** | — | (A single muted row) No documents | — |

### 5.3 Document states

| State | Where | Copy | Actions |
|---|---|---|---|
| **Healthy Local** | Chip (Decision Q4) | Chip: `HardDrive` **Local**. Popover: Only on this computer and in its backups. | (Live release adds Share live…) |
| **Document from a newer TinyDocy** (`doc_too_new`) | Chip `Lock` **Read-only**, and a banner | This document was made with a newer TinyDocy. Update to edit it. | [Update TinyDocy] |
| **Can't be repaired** (`unrepairable`) | Chip **Read-only**, and a banner | Today's copy from `document-notice.tsx`, with no Reload and no "copy into a new tab" | [Copy Diagnostics] |
| **In Trash** (opened from Trash, from history, or trashed in another window) | Banner. Read-only. | This document is in Trash. It will be deleted on 15 Dec. | **[Restore]** · [Delete Forever…] |
| **Very large document** (crosses 5 MB; engineering confirms the threshold in P2.6/T8) | Pill, once per document per app run, never at open | “Q4 plan” is 5.2 MB. Very large documents can feel slower. Consider splitting it. | — |
| **Remote images blocked** (decided at open) | Banner rendered **with the document** (part of the first layout, never inserted later), plus a placeholder per image | This document has images from the internet. Loading them tells those sites you opened it.<br>Placeholder: `ImageOff` *Image from example.com* | **[Load Images]** (remembered for this document) |
| Remote image pasted during editing | The placeholder only. No banner appears mid-session. | Placeholder: *Image from example.com* [Load] | [Load] (this image) |
| **X post** (plan §7) | A link card in the document | `ExternalLink` **Post on X** · x.com/user/status/… | Click opens the system browser |
| **Playground** | Chip `FlaskConical` **Playground**. Popover: A sample document on this computer. It can't be shared or deleted. | — | [Reset Playground…] (sheet: **Reset the Playground?** Your changes to it will be replaced with the original sample. [Cancel] [Reset]) |

### 5.4 File operations: feedback and copy

| Operation | Feedback | Copy |
|---|---|---|
| Move to Trash | Pill with Undo, 5 s. ⌘Z also works while focus is in the sidebar or a list (§6.2). | Moved “Q4 plan” to Trash. [Undo] |
| Move to Trash, several | Pill | Moved 3 documents to Trash. [Undo] |
| Trash a folder | Pill | Moved “Drafts” and 12 documents to Trash. [Undo] |
| Restore from Trash | Pill | Restored “Q4 plan” to Drafts. (Or "to Library" if Drafts is gone.) |
| Delete Forever | Sheet | **Delete “Q4 plan” forever?** This can't be undone. Its readable backup file is also removed. [Cancel] **[Delete Forever]** (Cancel has focus) |
| Empty Trash | Sheet | **Delete 3 documents forever?** This can't be undone. [Cancel] **[Empty Trash]** |
| Rename | No pill. The row and tab update in place. | — |
| Move to… | A dialog with the folder tree (APG tree) and a "New Folder" button. Pill after. | Moved “Q4 plan” to Team. [Undo] |
| Duplicate | The new row is selected in the sidebar. Pill. | Duplicated as “Q4 plan copy”. [Open] |
| Drop files on the window | Overlay over the main area (or the hovered folder highlighted): **Drop to import**. Dropped on a folder: imports there. | — |
| Import, one file | Opens the new document in a new tab. Pill. | Imported “notes.md”. The original file isn't changed. |
| Import, many | Pill with progress while running (sticky), then a summary | Importing 37 of 100… → Imported 100 documents into Library. [Show] |
| Import, some failed | Sheet listing the failures | **3 of 40 files weren't imported.**<br>• report.docx: this file type isn't supported. Use .md, .html or .tinydoc.<br>• huge.md: too large to import (14 MB; the limit is [N] MB).<br>• old.tinydoc: this file is damaged or isn't a TinyDocy document.<br>• future.tinydoc: made with a newer TinyDocy. Update to import it.<br>[Copy List] **[OK]** |
| Import, all failed (one file) | Sheet | **“report.docx” wasn't imported.** This file type isn't supported. Use .md, .html or .tinydoc. **[OK]** |
| Opening a `.tinydoc` you already have | Sheet (plan §5.3) | This is a backup of “Q4 plan” from 12 Nov. [Open Current] [Restore This Version…] [Open as Separate Copy] |
| Export | Native save dialog with a cleaned filename. Pill. | Exported “Q4 plan.md”. [Show in Finder] |
| Export failed | Sheet | **Couldn't save “Q4 plan.md”.** You don't have permission to write to that folder. Choose another folder. [Cancel] **[Choose Folder…]** |
| Export All | Native folder picker, determinate progress in the pill, then a summary | Exported 214 documents to ~/Desktop/TinyDocy Export 15 Nov. [Show in Finder] |

### 5.5 Restore from a daily snapshot

This is Document › Restore from a Daily Snapshot…, a dialog with a preview:

```text
┌ Restore “Q4 plan” ──────────────────────────────────────────────────────────┐
│  Daily snapshots           │  Q4 plan                                       │
│  ▸ Today, 09:02            │  Goals                                         │
│    Yesterday, 08:41        │  Ship the desktop app before…                  │
│    Wed 12 Nov              │  (read-only preview of the selected day)       │
│    Tue 11 Nov  (no change) │                                                │
│    Sun 9 Nov   (not yet created)                                            │
│                            │                                                │
│  TinyDocy keeps one snapshot a day for the last 7 days.                     │
│                                         [Cancel]  [Restore This Version]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Rows.**
  - Days on which the document matches the next newer snapshot show "(no change)" and are disabled.
  - Days before the document existed show "(not yet created)" and are disabled.
- **Preview.** A read-only render of that day's state (`restore.readDay`). The editor isn't mounted twice: it's a static render from the snapshot's Markdown or HTML serialisation.
- **No snapshots yet:** "No daily snapshots yet. TinyDocy takes one each day you use it."
- **After restoring:** pill "Restored “Q4 plan” to how it was on 12 Nov. [Undo]".
- **Undo is an open check (P2.9b).** The restore is a forward edit through `updateYFragment` (architecture §5.4).
  - **Preferred:** apply it in a transaction the Yjs `UndoManager` tracks, so ⌘Z and the pill's Undo both revert it in one step.
  - **Fallback:** if it can't be tracked, keep the pre-restore content (`encodeStateAsUpdate`) in memory, and give the pill and Edit › Undo Restore a "revert to before restore" while the document stays open.
  - Either way, the dialog shows no "are you sure": undo is the safety net.
- **Two meanings of "restore"** must never share copy. *Restore from a daily snapshot* is per document, from internal copies. *Restore from backup* is in Settings › Storage, from readable files, and also at reinstall. Vocabulary is in §9.

### 5.6 "Show in Finder" for a document that isn't a file

- **The item reveals the document's readable backup file** in `~/TinyDocy Backups` (D-A7).
  - Its label is the OS label: Show in Finder, Show in File Explorer, Show in Files.
  - A tooltip and the Help page say: "Shows this document's latest readable backup."
- **No mirror yet** (new since the last backup run):
  - The item stays enabled.
  - It runs the mirror for that one document, then reveals the file.
  - If that takes over 400 ms, the pill says "Preparing the backup file…".
- **Backups failing:** the sheet says **“Q4 plan” has no backup file yet.** Backups aren't being written right now. [Open Settings] **[OK]**.

### 5.7 Updates (P3.3)

| State | Where | Copy | Actions |
|---|---|---|---|
| Update downloaded | Settings › Updates status, plus one pill per launch. **Never auto-restart.** | TinyDocy 1.4 is ready. It installs when you restart. | [Restart Now] |
| The app menu after a download | TinyDocy › Restart to Update… (macOS) or Help › Restart to Update… | — | — |
| Linux manifest unverified | Settings › Updates | TinyDocy 1.4 is available. Download it from the website to update. | [Download] (system browser) |
| Update failed | Settings › Updates | Couldn't download the update. TinyDocy will try again later. | [Try Again] |

---

## 6. Feedback and motion

### 6.1 Which channel

| Need | Channel | Rule |
|---|---|---|
| A transient result ("Moved to Trash") | **Pill**: `announce(msg, { action })` | 2.5 s, or 5 s with one action. It is also the screen-reader announcement (`lib/announce.ts`). |
| A long-running operation | Pill in sticky mode | **New in P2.9a:** a desktop `progress` notice that stays until done, then becomes a normal 2.5 s pill |
| A state of the document | Chip plus popover, banner in the notice slot | Fixed face; detail in the popover |
| A state of the app (backups, saving behind) | Sidebar footer health slot, plus the ⚠ dot on the chip | The slot's row always exists (it holds Trash), so a ⚠ appearing never moves anything |
| A decision that destroys data | Native sheet | Cancel has focus. The verb repeats the title's verb. |
| A form error (rename to empty) | Inline, under the field | "Enter a title." The field keeps focus. |

**Desktop pill host.** Today the pill positions itself under the editor's sticky toolbar row (`status-pill.tsx:72-80`). The desktop shell adds a second placement:
- when no editor is mounted (a list view, the empty Trash, the sidebar alone), the pill sits **centred over the main area, 8 px below the tab row**
- with an editor mounted, the existing placement applies unchanged
- only one pill shows at a time, as now

### 6.2 Undo patterns

- **Editor:** Yjs undo, unchanged.
- **File operations** (trash, move, rename, restore from Trash, pin): an **app-level undo stack** of 20 entries per window.
  - ⌘Z and Edit › Undo use it **while focus is in the sidebar, a list or Quick Open**.
  - The menu label names the action ("Undo Move to Trash"). That needs a label change, which the menu allows: the label changes, the face of a toolbar button does not.
  - The pill's [Undo] uses the same stack.
- **No undo:** Delete Forever and Empty Trash. They confirm instead.

### 6.3 Motion

| Element | Duration | Easing | Reduced motion |
|---|---|---|---|
| Hover and pressed backgrounds | 0 ms (instant, as native controls are) | — | — |
| Button pressed | existing `active:translate-y-px` on toolbar buttons only, **not** on sidebar rows, tabs or list rows | — | kept (no movement) |
| Popover, menu and palette enter | 120 ms (opacity, scale 0.98 → 1) | `cubic-bezier(0.2, 0, 0, 1)` | none (already in `globals.css:185`) |
| Popover exit | 80 ms opacity | linear | none |
| Sidebar collapse and expand | 180 ms width | `cubic-bezier(0.2, 0, 0, 1)` | instant |
| Narrow-window sidebar overlay | 160 ms slide + scrim fade | same | instant |
| Tree folder expand | 0 ms. Rows appear; no height animation, which scales badly with 1,000 rows. | — | — |
| Pill enter and exit | existing | existing | existing |
| Drop overlay | 100 ms fade | linear | instant |
| Tab open and close | 0 ms | — | — |

Native menus, sheets and full-screen transitions use the OS's own motion and respect its settings.

### 6.4 Focus, hover, pressed and selected

These follow the smart toolbar's language (`components/ui/button.tsx`):
- **Focus ring:** `outline 2px var(--focus-ring)`, offset 2px, `:focus-visible` only.
  - In the tree, the lists and the tabs, the offset is **−2px (inset)**, so the scroll container doesn't clip it.
  - On desktop, `--focus-ring` takes the OS accent when one is available (§2.2).
- **Hover.**
  - Ghost `hover:bg-muted` for toolbar and titlebar buttons on every OS.
  - **Sidebar and list rows:** no hover background on macOS (Finder and Notes have none). `bg-muted/60` on Windows and Linux, where Fluent and GTK lists do show hover.
- **Selected row:**
  - accent background with white text while its region has focus
  - `bg-muted` with normal text when focus is elsewhere
  - This inactive-selection grey is the macOS convention, and it shows where keyboard focus is.
- **Pressed toggle** (toolbar): the existing 12 px pressed bar. It is not used in chrome.
- **Current tab:** raised surface colour with full-weight text. Inactive tabs use muted text. No underline bar, which would read as the toolbar's pressed state.

---

## 7. Settings window

The [preferences design](2026-11-16-preferences-design.md) §4.1 owns the full layout, copy and keyboard model. This section is the summary.

- **Window.**
  - Its own window, 680 × 520, resizable in height only. One instance. It is its own page (`/settings`) and never loads the editor chunk.
  - ⌘, opens it (Decision Q2), and so do TinyDocy › Settings…, File › Settings… on Windows and Linux, "Page settings…" in the Page popover, and the palette.
  - A second ⌘, focuses it. ⌘W or Esc closes it.
  - It opens on the last pane used, or on the pane its opener names.
- **Layout.**
  - Left navigation (168 px) on every OS. macOS System Settings has used a sidebar since Ventura, so this isn't foreign there.
  - **Six panes: General, Page, Writing, Storage, Updates, About.** "Editor" is split into Page and Writing, so neither pane runs to 13 rows.
  - The window title follows the pane ("Storage").
  - Each control's hint states its scope: "For all documents on this computer.", "For this document, on this computer. Others see their own width.", "For this window only." or "For TinyDocy on this computer."
- **Changes apply immediately**, in every open window. No OK or Apply button. General, Page and Writing end with **[Reset to defaults]**, which resets that pane only and shows a pill with Undo. It never resets your name, per-document widths or the backup folder.
- **New UI dependency.** `components/ui` has no Switch, Select or RadioGroup today. P2.9b adds them as shadcn components on Base UI, named exports, hand-written to match `dialog.tsx` (the `sheet.tsx` precedent). The web Settings dialog (W13) reuses them.

| Pane | Control | Type | Default |
|---|---|---|---|
| **General** | Appearance | RadioGroup: System / Light / Dark | System |
| | Interface zoom | Select: 75 / 80 / 90 / 100 / 110 / 125 / 150 / 175 / 200%. No key and no menu item. | 100% |
| | When TinyDocy opens | Select: Reopen my windows / Show Recent / New document | Reopen my windows (on macOS, also follows the system "close windows when quitting" setting) |
| | Show recent documents in the Dock (mac) / in the Jump List (Win) | Switch | On |
| | Your name and colour (Live) | Text field + 8 colour swatches | A random "Adjective Animal" and caret colour |
| **Page** | Style | RadioGroup with previews: Default / Comfortable reading / Compact / High legibility ("· Custom" when a knob differs) | Default |
| | Text size | Stepper A− / A+: 14 / 16 / 18 / 20 / 24 / 28 / 32 px | 16 px (owner Q1) |
| | Width (default for all documents) | Segmented: Narrow / Standard / Wide / Full. Shows "3 documents have their own width. [Reset them]" when there are overrides. | Standard |
| | Font | Select: Default (Arial) / Sans (Inter) / Serif (Source Serif 4) / Mono (JetBrains Mono) / Legible (Atkinson Hyperlegible Next, Q3) | Default |
| | Spacing | Segmented: Compact / Normal / Relaxed | Normal |
| | Letter spacing (Q3) | Segmented: Normal / Wide / Wider | Normal |
| | Show the outline | Switch. It docks beside the page when the window has room, otherwise it is an overlay. | On |
| **Writing** | Check spelling while typing | Switch (the same setting as Edit › Spelling) | On |
| | Spelling languages (Win/Linux; macOS detects it) | Listbox, up to 3, bundled dictionaries only | the system language, if bundled |
| | Smart quotes and dashes (Q2) | Switch. Never in code. | On |
| | Simplified toolbar | Switch (the `toolbarDensity` slot) | Off |
| | Remember my place in each document | Switch (`rememberPlace`). Off deletes the stored places. It is a user setting, separate from the operator's `NEXT_PUBLIC_REMEMBER_CHOICES`, which forces it off on the web when 0. | On |
| | Forget my formatting choices… | Button. Clears remembered colours, list style, table size and recent commands. Settings stay. | — |
| **Storage** | Library | Path (read-only, selectable text) + [Show in Finder] | the OS app-data path |
| | Backups | Path + [Show] [Change…] + a status line ("Last backup: today, 09:12" or the failing copy) | ~/TinyDocy Backups |
| | Back up now | Button (spinner after 400 ms) | — |
| | Daily snapshots | Status line: "7 kept · last taken today, 09:02" | — |
| | Restore from backup… | Button → native picker opening at the backup folder | — |
| | Export all… | Button | — |
| | Trash | "3 documents · deleted after 30 days" + [Empty Trash…] | — |
| | Note | "Cleaner apps that remove app data will delete the library. Your backups stay." (plan §5.2) | — |
| **Updates** | Download and install updates automatically | Switch | On |
| | Channel | RadioGroup: Stable / Beta | Stable |
| | Status | "TinyDocy 1.3.2 is up to date. Checked today at 09:14." + [Check Now] / [Restart Now] | — |
| **About** | Version, build, channel, `format_version`, Electron/Chrome/Node versions | Text + [Copy Version Info] | — |
| | Licence (MIT), Third-party notices (including the bundled fonts' OFL), Source code, Release notes, Privacy policy | Links (bundled pages for notices; external links open the browser) | — |

Reading mode is not a setting: it is per window, from View › Reading Mode (⌥⌘R) and the Page popover, and it resets when the window closes. Hide Comments is per window too.

**Not a setting, on purpose:**
- **"Always load remote images".** It would make the privacy default ("images wait for a click") one switch away from silent tracking (plan anti-goal). It's per document only.
- **The library path.** It is fixed (plan §5.2). Only the backup folder moves.

---

## 8. Accessibility

The accessibility tier and criteria belong to the accessibility specialist. This section applies them to desktop flows.

### 8.1 Landmarks and names

| Region | Element and role | Accessible name |
|---|---|---|
| Titlebar tabs | `tablist` (each tab a `tab` with `aria-selected`; the close button is a sibling, never nested) | "Open documents" |
| Sidebar | `nav` | "Files" |
| Library tree | `tree` (`aria-multiselectable`) › `treeitem` (`aria-expanded`, `aria-level`, `aria-setsize`, `aria-posinset`, since rows are virtualised) › `group` | "Library" |
| Recent and Pinned inline lists | `list` of links/buttons | "Recent", "Pinned" |
| List views | `grid` (`aria-multiselectable`), column headers as buttons with `aria-sort` | the section name ("Trash") |
| Toolbar | existing `toolbar` | "Formatting" |
| Editor | `main` containing the editor | "Document" |
| Outline | `complementary` | "Outline" |
| Status chip | `button` with `aria-haspopup="dialog"` | "Status: Local" |
| Footer health slot | `button` when ⚠ shows; otherwise nothing is rendered in the slot (the row stays) | "Backups aren't being written" |

The tree implements the WAI-ARIA APG Tree View pattern ([APG Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)), with the keys in §4.6. If a folder collapses while one of its children has focus, focus moves to the folder.

### 8.2 Focus between regions (F6)

- **Order:** Tabs → Sidebar (the last focused row) → Toolbar → Document (the caret where it was) → Outline (when visible) → back to Tabs. Shift+F6 reverses.
- The region that receives focus gets a **1 s focus flash**: its focus ring, drawn on the region container. Under reduced motion it is a steady ring until the next key.
- The sidebar and outline are skipped when collapsed.

**Focus after actions:**

| After | Focus goes to |
|---|---|
| Opening from the tree, a list or Quick Open | The editor caret (continue-position, or the end of the title for a new document) |
| Enter on a folder row in a list view | The first row of that folder's list |
| Move to Trash from the tree or a list | The next row (the previous one if it was last) |
| Undo of a trash | The restored row |
| Commit or cancel an inline rename | The same row |
| Closing a dialog or sheet | The control that opened it (plan §5.6) |
| Closing a tab | The new active tab's editor caret |
| Closing Quick Open or the palette with Esc | Where focus was before |

### 8.3 Keyboard-only flows that must pass (P2.7 and P2.8 Playwright checklist)

Each flow runs with no pointer:
1. Create a document, type a title, create a folder, Move to… the folder.
2. Rename a document with F2.
3. Trash it, then undo with ⌘Z in the tree.
4. Open Trash, restore it.
5. Delete forever, with Cancel focused first.
6. Import a file (⌥⌘O, or the menu via Alt/F10 on Windows).
7. Export.
8. Quick Open, then ⌘Enter to a new tab.
9. Back and Forward.
10. Restore from a daily snapshot (arrow through the days, Enter on Restore).
11. Change a setting in each Settings pane.
12. Open a context menu with Shift+F10 and choose an item.

### 8.4 Text scaling

- **Interface zoom** (Settings › General and the palette only; no key and no menu item) uses `webContents.setZoomFactor`, 75–200% in Chromium's steps, stored per app. It scales the chrome and the document together. At 50%, chrome text drops below 7 px, which is why the floor is 75% (preferences design C4).
  - Breakpoints use CSS px after zoom, so the outline docking rule and the 720 px sidebar rule follow it.
- **Document text size** (the Text size preference: View › Text Size, ⌘+ / ⌘− / ⌘0, Ctrl/⌘ + wheel, the Page popover, Settings › Page) scales only the document. It is stored in rem, so on the web it also honours the browser's default font size. On the web the app never captures ⌘+ / ⌘− / ⌘0, which stay browser zoom (WCAG 1.4.4).
- Chrome text is never below 11 px at 100%. At 200% zoom, nothing truncates without a tooltip.
- **Verify in S1** whether Windows "Text size" and macOS "Larger Text" change Chromium's default font size inside Electron. If they don't, the first-run sheet doesn't mention it, and Settings › Page carries the control.

### 8.5 Colour and contrast

- **Never colour alone.** The chip has an icon plus a word, plus a shape-changing dot for ⚠ or the lock. The selected row has an accent fill plus a weight change. Matches in Quick Open are bold.
- Text contrast is at least 4.5:1, and non-text UI at least 3:1, in both themes, including on the OS accent. If an accent fails 3:1 against the sidebar background, fall back to the app's `--ring`.

### 8.6 High contrast and forced colours

- The existing `@media (forced-colors: active)` rules apply (`globals.css:199-219`). Extend them to tree rows, list rows, tabs and the chip:
  - selection uses `Highlight` / `HighlightText`
  - borders use `CanvasText`
  - the focus outline stays a real outline
- **Windows titlebar overlay.** On `nativeTheme.shouldUseHighContrastColors` (and its `updated` event), call `setTitleBarOverlay` with system-like colours, and use `ButtonFace` / `ButtonText` in the titlebar CSS ([Electron: nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)).
- **macOS Increase Contrast:** `@media (prefers-contrast: more)` applies the high-contrast token set (stronger text, borders and focus rings, no translucent fills; preferences design §5.4). Desktop follows the OS and has no override. **Verify in S1** that Chromium reports it.
- **Reduced motion:** `prefers-reduced-motion` comes from the OS, as in §6.3.

---

## 9. Copy guidelines

### 9.1 Voice

- **Plain and short.** Lead with what happened, then what happens to the person's work. "Your documents are safe" appears wherever an error could make them worry.
- **No blame and no drama.** "Couldn't save…", not "Error: failed to…". No exclamation marks and no "Oops".
- **No "please"** in instructions, and no "simply" or "just".
- **Sentence case** for messages and buttons. **Title Case** for macOS menu items and native dialog buttons (Apple HIG); sentence case on Windows and Linux menus. Electron menus take one label, so the label table holds both forms.
- **Numbers with units**, and real sizes: "5.2 MB", "30 days".
- **Dates** through `Intl.DateTimeFormat` in the OS locale. The deck writes "12 Nov" (en-GB); an en-US system shows "Nov 12".
- **Name the thing.** Use the document's title in quotes (“Q4 plan”), not "this item". Use “Untitled” when empty.
- **Curly quotes** in copy (“ ” ’). Straight quotes only in code.

### 9.2 Vocabulary

| Use | Never | Notes |
|---|---|---|
| **document** | file, page, note, pad, doc | "File" is only for things on disk: import, export, backup files, "Show in Finder" |
| **Library** | vault, workspace, database | The tree of folders and documents on this computer |
| **folder** | collection, notebook | |
| **Local** | offline, private, unsynced | A state, not a place. In the Local release it means "only on this computer". |
| **Live** (Live release) | cloud, synced, online | Plan §5.5 |
| **Trash** / **Move to Trash** | Recycle Bin, Bin, Delete (for the first step) | Same word on every OS: it's the app's Trash, not the system's |
| **Delete Forever** / **Empty Trash** | Purge, Remove permanently | The only uses of "delete" |
| **Close** (a tab) | — | Never deletes. The web's close-tab tooltip, "Delete tab for everyone", is web only. |
| **backup** (noun), **back up** (verb) | export (for backups) | Readable files in TinyDocy Backups |
| **daily snapshot** | version, history, restore point | The 7 internal daily copies. "Version" is reserved for the Live release's restore points. |
| **Restore** | Revert, Roll back, Recover | Three uses, always with an object: restore from Trash, restore from a daily snapshot, restore from backup |
| **Import** / **Export** | Open (for .md), Save As | "Open" means opening a document from the Library |
| **Playground** | demo, sample doc | A sample document on this computer |
| **Settings** | Preferences, Options | Every OS (macOS 13+ uses Settings; GNOME's "Preferences" is a known deviation) |
| **Show in Finder / Show in File Explorer / Show in Files** | Reveal, Open folder | Per-OS label |
| **Quick Open** | Search, Go to | The surface. Its field placeholder is "Search by title". |

### 9.3 Button verbs

- **Verb plus object** when it isn't obvious: [Empty Trash], [Restore This Version], [Delete Forever].
- **A dialog's primary button repeats the title's verb.** "Empty Trash?" → [Empty Trash]. Never OK/Yes/No for decisions. [OK] only acknowledges information.
- **[Cancel]** is always present on decisions, and it has focus when the action destroys data.
- **Button order is native.**
  - On macOS the primary button is on the right.
  - On Windows it is on the left of Cancel.
  - On GNOME it is on the right.
  - `dialog.showMessageBox` handles this when `cancelId` and `defaultId` are set.
- **An ellipsis (…)** only when the item needs more input before it acts: Move to…, Import…, Empty Trash… (confirms), Settings…

---

## 10. Web vs desktop differences people will notice

| Difference | Why |
|---|---|
| **Closing a tab never deletes** (web: "Delete tab for everyone") | Documents belong to the person. Delete is a separate, undoable Trash action. |
| **No shared tab list.** Tabs belong to the window. | The public `global-tabs` is a sandbox feature (plan §3.4). Desktop documents are private. |
| **The Playground is local and never public** | It's a sample on this computer, with bundled images and no network (Goal 1) |
| **No intro screen and no "connecting"** | The library is local, so the app opens straight to the last document |
| **Files sidebar, Quick Open, Trash, Back/Forward** | It's a file manager as well as an editor |
| **Menus, native context menus, native dialogs** | Platform conventions (§2) |
| **A "Local" chip instead of the connection strip** | Nothing is connecting (plan §5.1) |
| **"Update and restart" instead of "Reload"** | A reload doesn't fetch a new app build (plan §5.6) |
| **Images from the internet wait for a click** | Loading them tells those sites you opened the document (plan §3.5) |
| **X posts are link cards** | No third-party script next to the desktop bridge (plan §7) |
| **Links open in the system browser** | The app window only shows TinyDocy |
| **Spelling uses OS dictionaries** (or bundled ones) with no network | Goal 1 |
| **Settings may differ:** ⌘, opens Settings | macOS convention (Decision Q2) |
| **Undo still resets on a tab switch** (same as web) | Plan non-goal; worth saying in Help so it isn't reported as a desktop bug |
| **⌘+ / ⌘− / ⌘0 change the document's text size**, not the whole window (web: browser zoom) | Interface zoom is a setting, not a key (preferences design C2) |

---

## 11. The 15 details that most separate a real app from a web page

Ordered by how strongly they read as "web page" when missing.

| # | Detail | Owner PR |
|---|---|---|
| 1 | **No white flash and no web loading UI.** The window appears on `ready-to-show`, painted, in the restored geometry with real tab titles. The SEO intro, offline and "connecting" UI never render (§3.1, §3.3). | P2.5 (window) + P2.9a (shell skeleton) |
| 2 | **Titlebar integration per OS.** macOS tabs in the titlebar with traffic lights and correct drag regions; Windows overlay caption buttons with snap layouts; Linux native frame (§2.1). | P2.9a |
| 3 | **Native context menus everywhere, including the editor with spelling suggestions.** Electron shows nothing on right-click by default (§2.5). | P2.9a (editor), P2.7 (tree, list, tabs) |
| 4 | **A full native menu bar** with standard items, correct shortcuts shown, Edit › Undo running Yjs undo, Format mirroring the registry (§2.4). | P2.9a |
| 5 | **Arrow cursor, unselectable chrome, no page zoom, no reload, no draggable UI images** (§2.3). | P2.5 + P2.9a |
| 6 | **Always saved.** No Save command, no "Saving…", no edited dot; ⌘S flushes silently (§12, C8). | P2.1 (flush) + P2.9a |
| 7 | **Instant switching.** Tab switch ≤ 100 ms with no skeleton; optimistic file operations; Quick Open answers in one frame (§3.2). | P2.1 + P2.7 |
| 8 | **Window state restore**: bounds, display, full screen, sidebar, tabs, per-tab history and caret position (§2.2). | P2.9a |
| 9 | **One window per document, a real Window menu, window titles = document titles**, and macOS keeping the app alive with no windows (§2.6). | P2.5 (registry, lifecycle) + P2.9a (menu) |
| 10 | **Quick Open (⌘O) plus one palette (⌘⇧P / Alt+/)** with app commands (§4.3, §4.4). | P2.7 (Quick Open) + P2.9a (palette app group) |
| 11 | **System font for chrome, platform row density, system accent for selection and focus**, macOS inactive-selection grey (§2.2, §6.4). | P2.9a |
| 12 | **Native sheets and pickers** for every destructive confirmation, import, export and folder choice, with Cancel focused (§5.4). | P2.8 |
| 13 | **OS integration:** Open Recent, Dock menu or Jump List, drop on the Dock icon, Open With (§2.2). | P2.9a + P2.8, with the argv change in P2.5 (§12, C3) |
| 14 | **Keyboard model**: F6 regions, the APG tree, F2, ⌘[ ⌘], ⌘1–9, Shift+F10, file-operation undo with ⌘Z in the sidebar (§4.6, §6.2, §8.2). | P2.7 |
| 15 | **A Settings window** that applies changes immediately, with Storage telling the truth about the library, backups and snapshots (§7). | P2.9b |

---

## 12. Changes recommended to plan v4

*Adopted in plan v5 and v6 (plan §5.6 and §14): C1–C12, including the Find bar (P2.11) and the P2.9 split.*

| # | Change | Plan section | Why |
|---|---|---|---|
| C1 | **Add the ⌘, collision to P1.2.** Settings needs `Mod-,`, which is Subscript today. Decision Q2. | §5.6, §8 P1.2 | Without it, ⌘, on macOS either opens Settings and kills Subscript, or the reverse, depending on menu and keymap ordering, which is untested. |
| C2 | **Decide the palette**: one palette, ⌘⇧P / Ctrl+Shift+P plus Alt+/, with a desktop app-command group. Decision Q1. | §5.6, P2.9 | The plan names no palette. ⌘K is taken by Link. |
| C3 | **Widen the P2.5 argv and `open-file` filter** to accept existing `.md`, `.html` and `.tinydoc` paths, plus a local open argument for the Jump List and Dock menu (for example `tinydocy://local/<uuid>` parsed in main). | Appendix A P2.5, §5.3, P2.8 | §5.3 promises Open With in the Local release, but P2.5 accepts only `tinydocy://`, which arrives in P4.5. OS recent lists need custom items, because `addRecentDocument` takes file paths only. |
| C4 | **Add the editor context menu** (spelling suggestions, Add to Dictionary, Cut/Copy/Paste, Link) to P2.9's exit criteria. | P2.9, Appendix A | Electron has no default context menu, and spellcheck is on. |
| C5 | **Add S1 checks:** menu accelerators vs editor keymaps (`registerAccelerator: false` on each OS), Edit › Undo through Yjs (not the role), double-click on drag regions, snap layouts with `titleBarOverlay`, Chromium scrollbars on Windows 11, `prefers-contrast`, OS text size. | §8 S1 | Each one decides a native-feel detail that can't be designed around after the fact. |
| C6 | **Split P2.9** into **P2.9a**: window chrome, titlebars, menus, context menus, window state, palette app group, the pill host. And **P2.9b**: first run, Settings window and its new `components/ui` controls (Switch, Select, RadioGroup), backups UI, Restore from a daily snapshot, Help, About. | §8 P2.9 | P2.9 is the largest PR in the plan and needs design review on three OSes. Split, each half can merge and be screenshotted on its own. |
| C7 | **Owner decision: in-document Find (⌘F).** Web users rely on the browser's find bar, which Electron doesn't have. Either add a minimal Find bar to the Local release (Edit › Find, ⌘F / ⌘G / ⌘⇧G / Esc, scoped to the document, never counting sidebar text), or ship without it and say so in Help. | §1 scope, §15 | Not designed here, because it isn't in the stated scope. Leaving it out is the most likely "this is a web page" bug report. |
| C8 | **⌘S behaviour.** ⌘S flushes the batcher now and shows nothing, except the first time per install: a pill "TinyDocy saves as you type. Your changes are saved." No File › Save item. | §5.6 | Muscle memory. Making the flush real makes the key honest. |
| C9 | **Sidebar footer health slot and the desktop pill host** are named UI in P2.7 and P2.9a. | §5.1, §5.5 | So that "Backups failing" and file-operation feedback never move layout and have somewhere to appear when no editor is mounted. |
| C10 | **Restore from a daily snapshot: Undo is a P2.9b exit check** (UndoManager-tracked, or a held pre-restore state, §5.5). | §5.2, P2.9 | The pill copy depends on it. |
| C11 | **Menu order:** Format before View (§2.4). | §5.6 | Matches TextEdit and Pages. A minor change. |
| C12 | **Keep loaded Y.Docs resident for the last 5 tabs per window** (P2.1 decides the memory ceiling). | P2.1, architecture §5.1 | Turns a tab switch into an editor bind, which the speed targets in §3.2 assume. |

No change to plan §5.5's state table for the Local release, beyond Q4.

---

## 13. Decisions for the owner

**Q1. Command palette shortcut** (C2)
- **⌘⇧P plus Alt+/ (Recommended):** one palette, free key, no habit broken. Linear users don't get ⌘K.
- **⌘K, Link moves:** matches Linear and Slack, but breaks the Docs, Word and Notion link habit.
- **Alt+/ only:** nothing new to learn or bind, but it's hard to discover for desktop users.

**Q2. ⌘, for Settings vs Subscript** (C1)
- **Desktop: Settings takes Mod-, and Subscript moves to Mod-Shift-, (Recommended):** follows platform convention, and the web stays unchanged. The cost: Subscript's key differs between web and desktop.
- **Same change on the web too:** one keymap everywhere, at the cost of a visible web change for existing users.
- **Settings is menu-only:** no keymap change, but it breaks the strongest macOS convention.

**Q3. Sidebar click model** (§4.1)
- **Navigate the current tab (Recommended):** Finder, Safari, Obsidian and Notion work this way. Tabs stay few, and ⌘-click opens a new tab.
- **Always a new tab:** closest to today's web, but tabs pile up.
- **Preview tab:** fewer tabs, but a temporary italic tab is a new state to learn.

**Q4. The healthy "Local" chip in the Local release**
- **Keep it (Recommended):** stable layout, it teaches the Local/Live model before sharing exists, and it carries the ⚠ dot. The cost: a quiet chip that says what's already true.
- **Hide it and reserve its slot:** less to look at, but it leaves an empty slot in the toolbar row, and the ⚠ needs that slot anyway.

---

## 14. S1 and S5 verification list (UX-owned items)

| Check | Pass |
|---|---|
| `registerAccelerator: false` shows the combo and leaves the key to the renderer | macOS, Windows, Linux |
| Edit › Undo and Redo through a menu intent run the editor's Yjs undo; native enablement works or is driven by `can().undo()` | all |
| No action runs twice when a key is both a menu accelerator and a keymap binding | all |
| Double-click on a drag region follows the macOS system setting | macOS |
| Snap layouts flyout on hovering the overlay maximise button | Windows 11 24H2+ |
| Chromium scrollbars look native without CSS | macOS overlay; Windows 11 |
| `prefers-contrast: more` and forced colours reach the renderer | macOS, Windows |
| OS text-size settings change Chromium's default font size | macOS, Windows |
| Inter loads from the bundle, with no network request | all |
| Electron GTK frame and IME on GNOME Wayland, and KDE | Linux |
| `accent-color-changed` / `getAccentColor` live updates | macOS, Windows |

---

## 15. Sources

**Apple**
- [Human Interface Guidelines: The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)
- [Human Interface Guidelines: Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)
- [WWDC20 10104: Adopt the new look of macOS](https://developer.apple.com/videos/play/wwdc2020/10104/)

**Microsoft**
- [Title bar design](https://learn.microsoft.com/windows/apps/design/basics/titlebar-design)
- [Support snap layouts for desktop apps on Windows 11](https://learn.microsoft.com/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)
- [Top 11 things you can do to make your app great on Windows 11](https://learn.microsoft.com/windows/apps/get-started/make-apps-great-for-windows)

**GNOME**
- [HIG: Header bars](https://developer.gnome.org/hig/patterns/containers/header-bars.html)
- [HIG: Menus](https://developer.gnome.org/hig/patterns/controls/menus.html)
- [HIG: Keyboard](https://developer.gnome.org/hig/guidelines/keyboard.html)

**Electron**
- [Custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [Window customization](https://www.electronjs.org/docs/latest/tutorial/window-customization)
- [Recent documents](https://www.electronjs.org/docs/latest/tutorial/recent-documents)
- [Represented file](https://www.electronjs.org/docs/latest/tutorial/represented-file)
- [Spellchecker](https://www.electronjs.org/docs/latest/tutorial/spellchecker)
- [nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)
- [Tech talk: Wayland](https://www.electronjs.org/blog/tech-talk-wayland)
- [electron#29600: Windows Controls Overlay](https://github.com/electron/electron/pull/29600)
- [Mica and Acrylic support (#38163)](https://ayakael.net/mirrors/electron/commit/e19500fa03bf08af1466dac5dbca39f1b4281d9c)
- [WCO on Linux (#42682)](https://ayakael.net/mirrors/electron/commit/342ef8e7e14e233078bd86af9bd6f0d9dc27b36c)
- [Tahoe cornerMask fix (#48400)](https://ayakael.net/mirrors/electron/commit/9a2b4f84be2f4bcc468a63ef93520e60790b8f3c)
- [app.setBadgeCount docs discussion (electron#34476)](https://github.com/electron/electron/issues/34476)

**Accessibility**
- [WAI-ARIA APG: Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

**Prior art**

These are secondary sources: community reports and cheat sheets.
- [AppleInsider: the Electron Tahoe slowdown fix](https://appleinsider.com/articles/25/10/10/update-your-slack-discord-clients-the-electron-tahoe-gpu-slowdown-bug-is-fixed)
- Obsidian shortcuts: [Kapeli cheat sheet](https://kapeli.com/cheat_sheets/Obsidian.docset/Contents/Resources/Documents/index) (Quick switcher ⌘O, palette ⌘P, back and forward ⌘⌥← / ⌘⌥→)

**Repository facts** (checked 2026-11-15)
- `lib/editor-actions/core/inline.ts` and `blocks.ts`
- `components/tab-bar/tab-bar.tsx:185-217`
- `components/document-editor/use-document-editor-effects.ts:104-117`
- `components/smart-toolbar/status-pill.tsx`
- `lib/announce.ts`
- `components/ui/button.tsx`
- `app/globals.css:185-219`
- `components/editor-app/editor-app.tsx`
- `components/app-skeleton/app-skeleton.tsx`
- tiptap and `@docs.plus/*` keymaps in `node_modules`
