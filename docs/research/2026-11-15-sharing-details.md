> **Superseded in part.** Some of this study's advice was changed by the staff feasibility review. See [the details spec §11](../superpowers/specs/2026-11-15-desktop-documents-and-editor-details.md) before building from it.

# Sharing in detail: send a copy, invite to edit, join, presence

- **Status:** UX research for owner review (2026-11-15). Nothing is built.
- **Builds on:** plan v4 [2026-11-15-desktop-local-first-design.md](../superpowers/specs/2026-11-15-desktop-local-first-design.md) (§3.3, §5.3–5.5, §6, §7, D5, K3/K5/K17), architecture [§6.1 and §8.3](../superpowers/specs/2026-11-15-desktop-architecture.md), [file manager and sharing UX](2026-11-15-desktop-file-manager-and-sharing-ux.md), [local-first storage and sharing](2026-11-15-local-first-storage-and-sharing.md), and the desktop UX spec's copy rules (§9).
- **Brief:** "Ensure users can share the document properly; the devil is in the details." No accounts.
- **Marking:** anything not checked against a primary source or the code is marked *(unverified)*.

---

## 0. Summary

1. **Two verbs, never mixed.** **Send a copy** gives someone a snapshot. Later changes don't reach them, and it needs no server. **Invite to edit** makes the document live, so everyone with the link edits one shared document. Apple Notes uses the same split in its share sheet ("Send Copy" vs "Collaborate"; [Apple](https://support.apple.com/guide/notes/share-your-notes-and-folders-apda5307056b/4.9/mac)), and so does Excalidraw ("shareable link" snapshot vs live room). One Share button opens both, under two headings with a one-line consequence each.
2. **The Local release can ship "Send a copy"**: Export, Print/Save as PDF, Copy as Markdown, and the macOS Share menu (§2.4).
3. **Two link roles: Can edit and Can view. No Comment role in v1** (§1.2).
4. **The link is copied, never displayed in full.** The secret is treated like a password, as the W3C TAG advises for capability URLs ([TAG finding](https://www.w3.org/2001/tag/doc/capability-urls)).
5. **No user-set expiry in v1.** The server's 30-days-without-edits rule is shown with the last-edit date (§1.7).
6. **Presence is honest.** Names are self-chosen and unverified. Nothing in the UI implies identity, ownership or a full list of people who have the link (§4).
7. **The plan changes** are listed in §8, each with its owning PR.

---

## 1. The share dialog

### 1.1 Where Share lives, and what it opens

| Entry point | Local release | Live release |
|---|---|---|
| Toolbar **Share** button (lucide `Share2` plus the word "Share", icon-only when narrow, plan §5.1) | Opens the **Share menu** with only "Send a copy" items | Opens the Share menu with both sections |
| **File › Share ▸** (macOS: the native Share submenu, §2.4) | Send a copy items | Plus **Invite to Edit…** and **Manage Sharing…** |
| **Document › Share…** / **Manage Sharing…** | — | As plan §5.6 |
| Command palette | "Send a copy as Markdown…", "Export…", "Print…" | Plus "Invite to edit…", "Copy edit link", "Copy view link", "Manage sharing…" |
| Status chip popover | — | Copy link, Manage sharing…, Report… |

**Share menu (Live release), the one surface that answers "how do I share this?":**

```
┌ Share “Q4 plan” ─────────────────────────────────────────┐
│  SEND A COPY                                             │
│  A snapshot. Changes you make later won't reach them.    │
│    Export as Markdown…                                   │
│    Export as HTML…                                       │
│    Export as TinyDocy document…                          │
│    Print or save as PDF…                       ⌘P        │
│    Copy as Markdown                                      │
│    Share via ▸   (macOS: Mail, Messages, AirDrop…)       │
│  ──────────────────────────────────────────────────────  │
│  INVITE TO EDIT                                          │
│  Anyone with the link edits this document with you.      │
│    Invite to edit…                                       │
└──────────────────────────────────────────────────────────┘
```

Once the document is live, the second section becomes **Copy edit link** · **Copy view link** · **Manage sharing…**.

- A menu, not a dialog, because every item does one thing. Arrow keys move through it, Enter acts, Esc closes, and focus returns to Share.
- Section headings are `role="group"` with `aria-labelledby`, so a screen reader says "Send a copy, group" before the items.
- **Why one button and not two:** people look for one "Share" control (Google Docs, Figma, Notion, Apple). The two headings carry the mental model at the moment of choice, which is progressive disclosure without hiding the live option.

### 1.2 Link roles: edit and view. Should "comment" exist?

| Role | v1 | Why |
|---|---|---|
| **Can edit** | Yes | The reason to go live. |
| **Can view** | Yes | Plan §6 already reserves `view_hash`, and Hocuspocus sets `connection.readOnly` for it. It is the safe choice for handouts. Google defaults links to Viewer for that reason ([Google Drive help](https://support.google.com/drive/answer/2494822)). |
| **Can comment** | **No** | TinyDocy has no comment system. Comments without accounts are anonymous and spoofable, and they need moderation and abuse tooling of their own. Google's Commenter role works because comments are attributed to accounts ([Google](https://support.google.com/docs/answer/2494886)). Revisit when a comment feature exists. |

**Mint both secrets at creation.** `POST /api/shares` returns edit, view and owner secrets together. Then "Copy view link" needs no server call and works offline. Plan §6 already has `view_hash`; this only makes it non-null at creation (P4.2a).

**Default copied role.** Copy edit link is the primary button, because the user chose "Invite to edit". Copy view link sits beside it with equal size and its own label, never hidden in a menu.

### 1.3 First share, step by step

**Step 0. Guards before anything opens** (checked locally, in this order):

| Condition | What the user sees |
|---|---|
| Playground | "Invite to edit…" is disabled. Tooltip and palette hint: "The Playground can't be shared. Duplicate it to share a copy." Send a copy items stay enabled. |
| Document in Trash | Disabled: "Restore “Q4 plan” from Trash to share it." |
| Read-only (too new, library too new) | Disabled: "Update TinyDocy to share this document." |
| Server kill switch `off` or `readonly` (last known `/api/info`) | Item stays visible and disabled with the reason: "Sharing is turned off on the server for now." Hiding it (plan §8.5) makes people hunt for a control that moved. **Change**, §8. |

**Step 1. Consent window** (main-owned, §1.10). The title names the document so the wrong one isn't shared:

```
┌ Invite people to edit “Q4 plan” ───────────────────────────┐
│                                                            │
│  Anyone with the link can open and edit this document.     │
│  There's no sign-in, so treat the link like a password.    │
│                                                            │
│  • A copy goes to tiny.docs.plus. The people who run it    │
│    can read it.                                            │
│  • The server deletes it after 30 days without edits.      │
│  • Your copy stays on this computer, whatever happens.     │
│                                                            │
│  Document   “Q4 plan” · 412 KB · edited today at 14:02     │
│  You appear as  [ Swift Otter            ] ● (colour)      │
│                                                            │
│  By creating a link you agree to the Terms of use ↗.       │
│                                                            │
│                         [ Cancel ]  [ Create link ]        │
└────────────────────────────────────────────────────────────┘
```

- **Document line:** title, size and last-edit time. It catches the "wrong document" mistake (§5.1).
- **Naming yourself:** prefilled with the current identity (today a random "Adjective Animal" from `lib/user-identity.ts`). It is editable and never required, because the random name works. The plan's "asks for one if you haven't set a name yet" becomes this inline field (**change**, P4.4). Max 30 characters, as today. Saving updates the identity used everywhere.
- **Terms:** a sentence with a link that opens in the system browser. No checkbox: a checkbox on every share is consent theatre. The owner may want an explicit first-time checkbox for legal reasons (**owner question Q3**).
- **Focus:** initial focus on **Create link**, because creating is not destructive and everything after it is reversible. Esc = Cancel.
- **No "don't show again".** The dialog is short, and it is shown only when a Local document goes live.

**Step 2. Pre-checks, inside the same window after Create link** (button shows a spinner and "Checking…", all inputs disabled):

| Check | Failure copy (inline, above the buttons; the button changes) |
|---|---|
| Offline (`net.online` false, or `/api/info` fails without a response) | "You're offline. Connect to the internet to create a link." [Cancel] [Try again] |
| Captive portal (HTML or TLS error from `/api/info`) | "Couldn't reach tiny.docs.plus. If you're on hotel or café Wi-Fi, sign in to the network first." [Try again] |
| Kill switch `off` / `readonly` | "Sharing is turned off on the server for now. Your document is unchanged." [OK] |
| Too large (`Y.encodeStateAsUpdate` after compaction > `maxDocBytes`) | "“Q4 plan” is too large to share: 2.4 MB, and the limit is 2 MB. Images take the most space. Remove some, or split the document." [OK]. Show the size with one decimal and the limit from `/api/info`, never a hard-coded "2 MB". |
| Near the cap (≥ 90%) | Not a failure. Note: "This document is close to the 2 MB limit for live documents (1.9 MB). If it grows past it, syncing pauses." [Create link] stays enabled. |
| App too old (`minDesktopSchema`) | "This version of TinyDocy is too old to share. Update and restart to share." [Update and restart] |
| Server busy (429, per-IP or total caps, `MAX_TOTAL_SHARES`) | "The server can't take new live documents right now. Try again later." [OK]. Never auto-retry, because loops risk a Throttle ban (K4). |
| Creation rate limit | "You've created several links in a short time. Try again in a few minutes." |

**Step 3. Uploading.** The window closes. The chip shows **Sharing…** (plan §5.5). Its popover: "Uploading “Q4 plan”. The link appears when it's ready." [Cancel]. Editing continues during upload. Quitting during upload publishes nothing (T10).

**Step 4. Link ready.** The Manage panel (§1.4) opens by itself, the chip becomes **Live**, and `announce("“Q4 plan” is live. Copy the link to invite people.")` runs once. **The link is not copied automatically**: a silent clipboard write surprises people and can overwrite what they had copied ([file-manager UX §2.2](2026-11-15-desktop-file-manager-and-sharing-ux.md)).

**Upload failure:** chip back to **Local**, popover "Couldn't finish sharing. Nothing was published." [Try again] (plan §5.5).

### 1.4 Manage panel (reopened from Share, the chip or Document › Manage Sharing…)

A dialog, not a popover: it has destructive actions, a form control and a list. It is a renderer dialog (shadcn `Dialog`). The owner actions it starts are confirmed in main (§1.10).

```
┌ Sharing “Q4 plan” ─────────────────────────────── ● Live ┐
│                                                          │
│  Edit link   tiny.docs.plus/s/7Hq2…kP9w  ••••            │
│              Anyone with it can edit.     [ Copy edit link ]
│  View link   tiny.docs.plus/s/7Hq2…kP9w  ••••            │
│              Anyone with it can read.     [ Copy view link ]
│                                                          │
│  WHO HAS ACCESS                                          │
│  Anyone with a link. TinyDocy can't tell who has it,     │
│  only who has the document open right now.               │
│  Here now (3):  ● Swift Otter (you)  ● Calm Wren  ● Ana  │
│                                                          │
│  You appear as  Swift Otter ●   [ Change… ]              │
│                                                          │
│  On the server until 30 days after the last edit         │
│  (last edit today, 14:02). Your copy stays here.         │
│  ──────────────────────────────────────────────────────  │
│  Reset links…   Make view-only for everyone…             │
│  Stop sharing…                        Report a problem…  │
│                                              [ Done ]    │
└──────────────────────────────────────────────────────────┘
```

**Showing the link vs hiding the secret.** The panel shows the host and the share ID, truncated, followed by `••••` for the fragment. The full URL never appears on screen.
- The W3C TAG finding says capability URLs leak because URLs aren't treated as secrets, and should be handled like passwords ([TAG](https://www.w3.org/2001/tag/doc/capability-urls)). Screen shares, screenshots and shoulder-surfing are the everyday leaks.
- The share ID part shows which link it is. Someone comparing "is this the link I sent?" can match the first characters.
- There is no "Show link" toggle in v1. Anyone who needs the text pastes it. *(Revisit if testers ask.)*
- **Copy feedback:** the button label changes to "Copied" with a check for 2 s, keeping its width. `announce("Edit link copied")` (the existing `lib/announce.ts` region, no new live region). If the clipboard write fails: "Couldn't copy. Select the link in Manage sharing and copy it." That needs a fallback read-only text field, revealed only in this error case.

**Who has access (no accounts).** The honest answer is "anyone with a link". The panel never says "Shared with 3 people". "Here now" is the awareness list (§4), labelled as presence, not access.

**Joiner's version of the panel.** A device that joined has no owner secret. It shows the same links (the joiner got them, and resharing is possible), "Here now", and one action: **Stop syncing here…**. It adds the line: "Only the computer that created this link can reset or stop it." With a view link, the edit link row is absent.

### 1.5 Reset links

- **What it does** (plan §6): a new share ID and secrets, the current state uploaded, and the old ID tombstoned with `link_reset`.
- **Confirmation** (native, Cancel focused, because it cuts people off):
  > **Make new links for “Q4 plan”?**
  > The current edit and view links stop working. People who opened them keep their own copies, but they won't get new changes. Send the new link to anyone who should keep editing.
  > [Cancel] [Make New Links]
- **After:** the panel shows the new links with a short highlight. `announce("New links made. The old links no longer work.")`. Nothing is auto-copied.
- **Reset only the view link?** Not in v1. One action is easier to understand, and a leaked view link is resolved by the same reset.

### 1.6 Make view-only for everyone

Plan §5.4 calls this "Make view-only". The name collides with the **view link**, so a person may think it makes *their* link view-only. Rename it to **Make view-only for everyone…** (**change**, P4.4).

> **Make “Q4 plan” view-only for everyone?**
> No one can edit it through the links any more, including you on other computers. People can still read it. Changes they made offline that haven't synced are kept in their own copies.
> [Cancel] [Make View-Only]

- The owner's device keeps editing? **No.** The owner's device is also a client of the shared document. If the owner edits, nobody sees it, which is confusing. The owner's chip shows **View only**, and the panel offers **Allow editing again…**, which needs the owner secret.
- **Is "Allow editing again" possible?** It needs a new edit secret (the old one is revoked). The panel then shows a new edit link. *(Server shape for P4.2c.)*

### 1.7 Expiry

| Option | v1? | Reasoning |
|---|---|---|
| User-set expiry (1 day, 7 days, a date) | **No** | Bitwarden Send has deletion and expiry dates because a Send is one-way and short-lived, max 31 days ([Bitwarden](https://bitwarden.com/help/send-lifespan/)). A live document is ongoing work. Expiry adds server state, a new Ended reason and a new owner surface, while joiners keep their copies anyway. Notion has link expiry only on paid plans *(unverified)*. |
| **The server's 30-days-without-edits rule** | **Yes, shown** | The Manage panel shows it with the last-edit date. When the owner's app sees fewer than 7 days left, the chip popover adds: "The server deletes this in 5 days unless someone edits it. Your copy stays here." No notification. |
| Max-views count | No | It conflicts with reconnects: every reconnect would be a "view". |

### 1.8 Stop sharing

Native, Cancel focused:

> **Stop sharing “Q4 plan”?**
> The links stop working and the copy on the server is deleted. People who already opened it keep their own copies, and nothing can take those back. Your document stays here as a Local document.
> [Cancel] [Stop Sharing]

- After: chip **Local**, toast "Stopped sharing “Q4 plan”." No Undo: the tombstone is permanent (plan §6: an ended share never comes back), so the toast offers **Share again…** instead, and that makes a new link.
- If offline: "You're offline. Sharing stops when you reconnect." The request is queued in `remotes` with `pending_stop`. The chip shows **Stopping…**. *(New state, §8.)* Owner question Q5 asks if a queued stop is wanted, or a refusal ("Connect to stop sharing").

### 1.9 Errors after going live

The plan's §5.5 rows stand. Additions:

| State | Chip | Popover | Actions |
|---|---|---|---|
| **Sharing off on the server** (`HOCUS_SHARES=off`; the reducer's `SharesOff`, which has no §5.5 row) | Paused | Sharing is turned off on the server for now. Your changes are saved here and will sync when it's back on. | — |
| **Server read-only** (`HOCUS_SHARES=readonly`) | View only | The server is accepting no changes for now. You can read the live document. Your changes are saved here. | Make a Local copy |
| **Stopping** (queued stop, §1.8) | Stopping… | Sharing stops when you reconnect. | Cancel |
| **Joined with a view link, edit link opened later** | Live | — (toast "You can now edit “Q4 plan”.") | — |

### 1.10 Native dialog or main-owned window?

Plan §7 says going live uses a native dialog owned by main, so a compromised renderer can't publish quietly. `dialog.showMessageBox` gives a title, a message, detail text, buttons and one checkbox. It has **no text field, no link and no rich layout**. So the consent screen in §1.3 can't be a message box.

| Option | Pros | Cons |
|---|---|---|
| **A. Message box only** | Simplest, fully native | No name field, no terms link (a "Read terms" button would close the dialog), no inline size error |
| **B. Main-owned modal window (Recommended)** | A small `BrowserWindow` sheet with its own minimal preload, its own HTML and no editor code. Main decides what it shows (title, size from the worker) and receives the click. Same security property: the document renderer can't publish. | A second tiny UI bundle to build and test |
| **C. Renderer dialog + native final confirm** | Familiar shadcn UI | Two dialogs for one action |

**Recommendation: B** (**change** to plan §7, P4.4). Destructive owner actions (Reset, view-only, Stop) use plain message boxes, where text and two buttons are enough.

---

## 2. Other ways to share: "Send a copy"

### 2.1 The distinction, in words people use

| | **Send a copy** | **Invite to edit** |
|---|---|---|
| What they get | A file or text, frozen now | A link to the same live document |
| Your later changes | Don't reach them | Appear as you type |
| Their changes | Don't reach you | Appear as they type |
| Needs the server | No | Yes, and the operator can read it |
| Can you take it back? | No | You can stop the link; copies already opened stay |
| Release | **Local** | Live |

The one-line descriptions in the Share menu (§1.1) are these rows compressed. Help › Sharing safely carries the full table.

### 2.2 Inventory

| Method | Format and behaviour | Release | PR |
|---|---|---|---|
| **Export as Markdown…** | `.md` with the existing serializer *(unverified that it covers tables, task lists and Mermaid)*; images as data URLs are written to a sibling `Q4 plan files/` folder, or dropped with a note in the summary pill *(owner pick, Q6)* | Local | P2.8 (exists in plan) |
| **Export as HTML…** | One self-contained `.html`, images inline, no scripts, a minimal stylesheet. Mermaid as rendered SVG *(unverified feasibility from the static export)*. | Local | P2.8 |
| **Export as TinyDocy document…** | `.tinydoc`, secrets and remote rows stripped (plan Appendix A, P2.8). It opens as a new Local document on the recipient's machine, because they don't have the lineage. | Local | P2.8 |
| **Print or save as PDF… (⌘P)** | `webContents.print()` with the OS dialog. macOS has "Save as PDF" in it, Windows has "Microsoft Print to PDF", and GNOME has "Print to File". Print stylesheet: no toolbar, no carets, no outline, page breaks avoided inside images and tables. This gives PDF in the Local release without a PDF exporter (plan §15 defers "PDF export"). | **Local, new** | P2.8 |
| **Copy as Markdown** | Whole document, or the selection when there is one. Toast "Copied “Q4 plan” as Markdown." | **Local, new** | P2.8 |
| **Copy (rich text)** | Already works: ⌘C puts HTML and plain text on the clipboard. Help says so: "To paste into an email with formatting, select all and copy." No new item. | — | — |
| **macOS Share menu** (Mail, Messages, AirDrop, Notes…) | Electron's `shareMenu` role with a `sharingItem` of file paths ([Electron ShareMenu](https://electronjs.org/docs/latest/api/share-menu), macOS only, Electron ≥ 12). Main exports to a temp folder first (format picker: PDF via `printToPDF`, Markdown or TinyDocy) and passes the path. The Mail item is how "Email a copy" works on macOS. | **Local, new (macOS)** | P2.9a (menus) + P2.8 (temp export) |
| **Windows Share** | Needs `IDataTransferManagerInterop::ShowShareUIForWindow` from a native addon ([Microsoft](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/integrate-sharesheet-send)). One package claims both OSes, `electron-native-share`, maintenance unverified. A native addon in the signed main process is a supply-chain cost (K6). | **Deferred** | — |
| **Linux** | No standard share sheet. Export and Show in Files. | — | — |
| **Email a copy** (`mailto:`) | `mailto:` can't attach files. A body with the whole document breaks on length limits. Don't build it. On Windows and Linux: export, then "Show in File Explorer" so the file can be dragged into mail. | Not built | — |
| **Drag the document out** | Drag a sidebar item to Finder or a mail window to drop a `.tinydoc` (or `.md` with ⌥) copy. Nice, but not needed for v1 *(defer)*. | Later | — |

**Secrets in a copy.** Every send-a-copy path is a copy: no link, no secrets, no `remotes` row. A copy of a live document carries a note in the HTML and PDF footer only if the owner wants it (Q6). The default is none, because a copy should not advertise that a link exists.

### 2.3 Feedback for send-a-copy

| Action | Feedback |
|---|---|
| Export | Native save dialog with a clean filename, then pill "Exported “Q4 plan.md”. [Show in Finder]" (UX spec §6). |
| Export failed | Sheet: "Couldn't save “Q4 plan.md”. You don't have permission to write to that folder. Choose another folder." (UX spec). |
| Copy as Markdown | Pill "Copied as Markdown" plus `announce()`. |
| Print | The OS dialog is the feedback. |
| macOS Share | The OS sheet is the feedback. On failure to export the temp file: "Couldn't prepare “Q4 plan” to share. Try Export instead." |

### 2.4 What fits in the Local release (P2.8 scope)

Ship: Export (Markdown, HTML, TinyDocy, already planned) **plus** Print / Save as PDF, Copy as Markdown, and the macOS Share submenu. Defer: Windows Share, drag-out, a dedicated PDF exporter.

Cost guess: print stylesheet and menu item about 1 PR; Copy as Markdown about half a PR on top of the serializer; macOS Share menu about 1 PR (temp-file lifecycle: write to `app.getPath('temp')/tinydocy-share/<uuid>/`, delete on next launch). All Local, no server, no secret handling.

---

## 3. The joiner's experience

### 3.1 The link

`https://tiny.docs.plus/s/<shareId>#e=<secret>` (edit) or `#v=<secret>` (view), per [storage research §3.2](2026-11-15-local-first-storage-and-sharing.md). The fragment is never sent to the server, to Referer headers or to analytics. Chat apps and mail scanners still see it in the text.

### 3.2 Chat preview card

Slack's bot fetches the page with Range requests and reads Open Graph and Twitter Card tags ([Slack robots](https://api.slack.com/robots)). The preview fetch **never sees the fragment**, so the card can't know the role, and it must not know the title.

| Tag | Value |
|---|---|
| `<title>` / `og:title` | Shared TinyDocy document |
| `og:description` | Open it to read or edit. |
| `og:image` | The generic TinyDocy card image (no content) |
| `robots` | `noindex, nofollow` |
| `Referrer-Policy` | `no-referrer` |

The page HTML is static. It opens no WebSocket, makes no `/api` call with the share ID and runs no analytics until a human clicks. Teams and iMessage previews behave the same way *(unverified per client)*.

### 3.3 Handoff page (`/s/<id>`, P4.3)

On load, the script reads the fragment into memory, then calls `history.replaceState` to drop it (plan §5.4). The page does nothing else until a click: no auto-attempt of `tinydocy://`. Mail scanners that detonate links in a browser can run scripts, and a click-free open would count as a "view" and connect ([reports on Safe Links pre-fetching](https://techcommunity.microsoft.com/t5/office-365/o365-url-scan-safe-links-impact-to-one-time-url/m-p/977132)). That replaces the research doc's "tries the scheme once on load" (**change**, P4.3).

```
┌──────────────────────────────────────────────────────┐
│  TinyDocy                                            │
│                                                      │
│  Someone shared a live document with you.            │
│  Anyone with this link can edit it.                  │   (view link: "can read it")
│                                                      │
│  [ Open in TinyDocy ]      [ Open in browser ]       │
│                                                      │
│  Don't have the app? Download for macOS              │   (OS-detected; others below)
│  ☐ Always open live links in this browser            │
│                                                      │
│  The document is stored on tiny.docs.plus and its    │
│  operator can read it. Report a problem              │
└──────────────────────────────────────────────────────┘
```

- **Title on the page:** not shown before the click. Showing it needs a content fetch, which is what click-to-open avoids. After the click, the web view shows the title. (Plan Decision 6 in the research doc is still open: **owner question Q1**.)
- **Open in TinyDocy:** navigates to `tinydocy://open?server=tiny.docs.plus&id=<id>#e=…`. Browsers show their own "Open TinyDocy?" prompt. There is no reliable way to detect if the app is installed. If the page is still visible and focused after 2 s, a line appears under the button: "Nothing happened? Download TinyDocy, or open in your browser." No loops, no repeated tries.
- **Open in browser:** the single-document web view (§3.6).
- **Remembered choice:** "Always open live links in this browser" stores `{ open: "browser" }` in this browser's localStorage (no secret, no share ID). With it set, the page shows a 1-second "Opening in your browser… [Cancel]" and then opens. Linear and Figma keep a similar per-browser preference ([Linear](https://linear.app/docs/get-the-app)). The app-side preference is set in the app (Settings › Sharing), not on the page.
- **Reload after the fragment is gone:** the secret is kept in `sessionStorage` for this tab only, keyed by share ID, so a reload works. Closing the tab forgets it. Without it, the page says: "To open this document again, use the link you were sent."
- **Bad or dead link:** after the click, the server answers. Copy per plan §5.5: "This live document doesn't exist anymore. Ask the person who sent it for a new link." For a reset: "This link was replaced. Ask the person who sent it for the new one." For removed: "This document was removed by the server operator."
- **Malformed fragment** (truncated by a mail client): "This link looks incomplete. Copy the whole link, including everything after the #."
- **Phone:** the desktop app button is hidden (no mobile app). "Open in browser" is primary, with the line "The TinyDocy app is for Mac, Windows and Linux."

### 3.4 In the app: first moments

1. **Deep link arrives** (`open-url` on macOS, `second-instance` argv on Windows and Linux). Main validates host, ID and fragment shape.
2. **Native confirmation** (plan §7):
   > **Open a live document from tiny.docs.plus?**
   > Anyone with the link can edit it. A copy is saved in your Library under Live, and it stays even if sharing ends.
   > [Cancel] [Open]
   For a view link: "Anyone with this link can read it. You can't edit."
3. **Joining:** a tab opens with the document skeleton and the chip **Joining…**. The editor is not editable until the first sync. That avoids the seed race (storage research §4.1).
4. **One-time banner** (per document, plan §5.4) with identity:
   > You joined a live document. Anyone with the link can edit it. You appear to others as **Swift Otter**. [Change name] [Got it]
5. **Presence** appears (§4). The joiner's name was never prompted. The banner is the prompt.

**Where the document goes:** Library › Live list and the sidebar's Live section. Not into a folder. The joiner can Move to… later.

**Joining failures in the app:** offline → "You're offline. The document opens when you reconnect." (the document stays in Live with chip **Offline**, and no empty seed is ever created); server busy → Paused (busy); too old → Paused (update needed); link dead → the Ended row, and no Library entry is created when nothing was ever synced.

### 3.5 Edge cases for joiners

| Case | Behaviour and copy |
|---|---|
| **Joining twice (same link)** | Opens the existing document (plan). Toast: "You already have “Q4 plan”." |
| **View link, then the edit link** | Upgrades the stored token. Toast "You can now edit “Q4 plan”." |
| **Edit link, then the view link** | Keeps edit. Toast "You already can edit “Q4 plan”." |
| **Your own link, on the computer that created it** | Opens the document. Toast "This is your shared document “Q4 plan”." No second copy. |
| **Your own link, on your other computer** | You join like anyone else, without the owner secret (D5). Manage panel line: "Only the computer that created this link can reset or stop it." |
| **Opening an old link to a document you have, after a reset** | The Ended (link replaced) row, plus "Ask for the new one." |
| **Link reset while open** | Chip **Ended**. Popover: "This link was replaced. Ask for the new one. Your copy is kept." If edits hadn't synced: "Your last changes didn't reach the shared copy. They're in your copy here." Actions [Keep as Local] [Open Link…] |
| **Sharing stopped while open** | Chip **Ended**. "The person who shared this stopped sharing. Your copy is kept and still editable." |
| **Made view-only while you type** | Chip **View only**. Unsynced edits fork to a Local copy (plan row). Toast: "“Q4 plan” is now view-only. Changes you hadn't synced are in “Q4 plan (your changes)”. [Open it]" |
| **Opening a link while a native dialog is up** | Queued and shown after. |
| **Paste a link into the editor** | It's a link, as today. Pasting a TinyDocy share link in the editor shows no auto-join. File › Open Link… (⌘⇧O) is the explicit path. |

### 3.6 Web view (`/s/<id>` after Open in browser)

- Header strip: "Live document · Anyone with the link can edit · Get the app · Report" (view: "can read").
- Name: same identity as the sandbox (`tinydocy-user` in this browser). A one-time banner per browser, as in §3.4.
- No tab list, no delete, no Share. Closing the browser tab deletes nothing.
- Uses the 14-day offline cache *(as in research §2.3)*. The secret stays in `sessionStorage` only, so an offline copy of the document can exist without the means to reconnect after the tab closes. That trade is deliberate: the browser profile is the leak.
- **Phone:** the existing responsive editor. Presence collapses to a count (§4.4).

---

## 4. Presence while live

### 4.1 What exists today (code)

- `lib/user-identity.ts`: a random "Adjective Animal" name (20 × 20 = 400 combinations) and one of 8 pastel caret colours, in localStorage.
- `components/tiptap-ui/user-identity-dialog.tsx`: name (max 30) and colour. **Colour buttons are labelled by hex** ("Select color #E57373"), which tells a screen reader nothing.
- `components/tiptap-ui/connection-status.tsx`: "N users online", counting yourself. Its live region announces only offline and online transitions, never peer counts. That rule is kept.
- `@tiptap/extension-collaboration-caret`: remote carets with name labels.

### 4.2 Presence row (toolbar, next to the chip)

```
 … toolbar …   (S)(C)(A) +2   ● Live   [Share]
                └ initials on the person's colour; you are not in the row
```

- **Cap:** 3 avatars below 1000 px wide, 5 above, then "+N". On narrow windows only a people icon with the count.
- **You are not in the row.** Your own identity is in the People list as "(you)". It is a common pattern and avoids "3 here" meaning "2 others".
- **Avatar:** first letters of the first two words, on the caret colour, with dark text. The pastel colours likely fail with white text *(contrast unverified)*. Colour is never the only cue: initials and the name on hover/focus.
- **Hidden in Local documents.**

### 4.3 People list (click the row or press its button)

```
┌ Here now · 4 ────────────────────────────────┐
│  ● Swift Otter (you)            Change…      │
│  ● Calm Wren        editing     Go to  Follow│
│  ● Ana              viewing                  │
│  ● Calm Wren (2)    idle        Go to  Follow│
│  ──────────────────────────────────────────  │
│  Names are chosen by each person and aren't  │
│  verified.                                   │
└──────────────────────────────────────────────┘
```

- **Status words:** *editing* (caret moved in the last 60 s), *idle* (no caret change for 5 min, or their window is hidden: an `idle` awareness field), *viewing* (view-link connection). No typing dots: the caret moving is the typing indicator.
- **Go to:** scrolls their caret into view, once. It doesn't move your own selection (Google Docs-style jump; [Alice Keeler](https://alicekeeler.com/2019/11/29/click-the-collaborator/)).
- **Follow:** keeps their caret in view as they move, like Google Slides and Figma follow ([Figma](https://help.figma.com/hc/en-us/articles/360040322673)). A bar at the top: "Following Calm Wren · Stop (Esc)". Following stops when you type, click in the text, scroll, or they leave (tldraw stops on interaction; [tldraw](https://tldraw.dev/sdk-features/user-following)). The followed person is not told. Figma doesn't tell either; its forums ask for it. Owner question Q7.
- **Viewers:** no caret, no Go to. Whether a read-only Hocuspocus connection can still send awareness is *(unverified)* and decides if viewers appear at all.

### 4.4 Collisions, spoofing and limits

- **Name collisions:** identical names are shown with a local suffix, "(2)", ordered by awareness clientID. Each viewer sees their own numbering. Colour collisions are expected beyond 8 people, so initials and names carry identity.
- **Spoofing (no identity):** anyone can call themselves anything, including your name.
  - "(you)" is only ever on the entry whose clientID is yours.
  - No "owner", "creator" or "host" badge, because awareness can't prove it. The owner secret never touches awareness.
  - No "verified" or account icons.
  - The People list footer says so, and Help › Sharing safely explains it.
- **Many people:** the server caps per-IP connections at 10 (plan §2). The list scrolls. Over 20 people, the list shows the 20 most recently active and "and 14 more".
- **Phone:** count only ("4 here"), the list in a bottom sheet, no Follow.

### 4.5 Screen readers and live regions

- The row is a button: `aria-label="4 people here. Show list"`. Its label updates silently.
- **No announcements for joins and leaves by default.** That matches the existing rule (never announce peer counts) and WCAG's caution that polite regions should carry meaningful status only ([W3C ARIA22](https://w3.org/WAI/WCAG22/Techniques/aria/ARIA22)). A Settings toggle "Announce when people join or leave" (off) batches changes, at most one message per 10 s: "Calm Wren and Ana joined."
- **Follow start/stop** is announced once ("Following Calm Wren. Press Escape to stop.").
- The list is a dialog with a list of buttons; Esc closes and focus returns to the row.
- The identity dialog's colour buttons get names: "Red", "Pink", "Purple", "Blue", "Teal", "Green", "Orange", "Brown" (a web fix too, small, outside this plan).

### 4.6 Offline edits arriving later

When a collaborator who edited offline reconnects, a large batch of their changes arrives at once. Yjs updates carry no names.

- **Detection:** a remote batch after this client has been synced for at least 5 s changes more than 2,000 characters or 20% of blocks *(thresholds to tune)*.
- **Before applying it:** P4.0 saves a version ("Before changes synced from another copy, 14:32"). This extends the plan's pre-wipe version to any large arrival (**change**, P4.0/P4.4).
- **Pill (no announcement unless it removed text):** "Changes made elsewhere just synced into “Q4 plan”. [Versions…]". The wording doesn't name a person, since we can't know who.
- **Most of the text removed:** the plan's wipe toast wins (plan §5.5 Other prompts).

---

## 5. Safety in the details

### 5.1 Preventing accidental sharing

- **Wrong document:** the consent title, document line and size (§1.3). Invite to edit acts on the **active tab's document** only, never a selection in the sidebar. From the sidebar context menu it acts on that item, and the dialog names it.
- **Playground:** can't be shared (§1.3).
- **Never by accident:** no keyboard shortcut for Invite to edit. Copy edit link has none either. ⌘P is Print, a copy.
- **Folders:** you can't share a folder.
- **Sensitive content hint:** if the document contains strings that look like secrets (API keys, "password:")? Cheap, but false positives teach people to ignore warnings. *(Not recommended for v1.)*

### 5.2 Consent wording (final for review)

Shown in §1.3. Each sentence covers one fact from plan §5.4: who can open it (anyone with the link), no sign-in (treat like a password), where it goes (server, operator can read), how long (30 days without edits), your copy stays, terms.

### 5.3 Link-leak guidance (Help › Sharing safely)

> **Where links leak.** Chat previews, clipboard history (Windows clipboard history and cloud clipboard, clipboard managers), browser history and sync, screenshots and screen shares, forwarded mail, and mail security scanners that open links.
> **If a link leaked.** Open Manage sharing and choose Reset links. The old links stop at once. People who opened the document already keep their copies; nothing can recall those.
> **If someone vandalised the document.** Open Versions and restore the version before it (Live release). Then reset the links.
> **What stays on the server.** The document text and images until 30 days after the last edit. Not your name, not your other documents.

### 5.4 Report flow

From the chip popover, the Manage panel and the `/s/` page.

```
┌ Report “Q4 plan” ────────────────────────────┐
│  What's wrong?                               │
│  ○ Illegal content                           │
│  ○ Harassment or hate                        │
│  ○ Spam, scam or malware links               │
│  ○ Someone's personal information            │
│  ○ Something else                            │
│  Details (optional)      [               ]   │
│  Your email (optional, so we can reply) [  ] │
│                                              │
│  We send the document's ID, not its link.    │
│                        [Cancel] [Send report]│
└──────────────────────────────────────────────┘
```

- Sends `{share_id, reason, details, contact}` (plan §6). The operator inspects with `share-admin`, which reads the document server-side, so the secret isn't needed.
- After: "Thanks. The operator reviews reports and may remove the document." The reporter's own copy is unaffected.
- **Why it matters:** Firefox Send, an anonymous link-sharing service, was shut down in 2020 after it was used for malware and phishing ([Mozilla](https://support.mozilla.org/kb/what-happened-firefox-send)). Anonymous edit links invite the same abuse (K5).
- A desktop joiner who reports can also **Stop syncing here** from the same dialog: a checkbox "Also stop syncing it on this computer".

### 5.5 Trash, wipe protection, removed

- **Trash:** the plan's §5.3 prompts stand. Add "Trash empties after 30 days" vs "the server deletes it after 30 days without edits" wording (already in plan).
- **Wipe protection copy:**
  - Toast: "“Q4 plan”: a collaborator removed most of the text. [Restore]"
  - Restore confirm: "This replaces the text for everyone with the link. The current version is saved first." [Cancel] [Restore for Everyone]
  - In a Local document the same restore uses "daily snapshot" wording (UX spec §9.2: "version" is reserved for the Live release).
- **Removed by the operator:** plan row stands. No Share again.

---

## 6. States, keyboard and data

### 6.1 Keyboard and a11y checklist

- [ ] Share menu: arrow keys, Enter, Esc; focus back to Share.
- [ ] Consent window: focus on Create link; Esc cancels; the name field is labelled "Your name, shown to people editing with you".
- [ ] Manage dialog: focus on the first Copy button; Tab order follows the visual order; destructive buttons last; Esc and Done close; focus back to its opener.
- [ ] Every copy action announces through `announce()`; no new live regions.
- [ ] Presence row: one button with a count label; the list is a dialog.
- [ ] No colour-only meaning: chip word, avatar initials, status words.
- [ ] Destructive native dialogs: Cancel focused (UX spec §5.4).
- [ ] The handoff page works with keyboard only and at 200% zoom, and needs no hover.

### 6.2 Data: local vs shared

| Data | Where | Shared? |
|---|---|---|
| Document content, title, `meta.lineage` | Library + server while live | Yes, to anyone with a link and the operator |
| Your name and colour | `tinydocy-user` (web), `meta` (desktop after P4.0) | Yes, in awareness, while connected only. Never stored on the server. |
| Caret, selection, `idle` | Awareness | Yes, ephemeral |
| Owner secret | Main, `safeStorage` | Never |
| Edit and view tokens | `remotes` (encrypted), renderer while open | Only by you copying the link |
| Web share secret | `sessionStorage` of that tab | No |
| "Always open in browser" | Browser localStorage | No |
| Versions, daily snapshots | Library | No |
| Folder, pin, Recent, continue position | Library / local | No |
| People list, follow state | Memory | No |
| Reports | Server: share ID, reason, optional contact | To the operator |
| Analytics | None on `/s/` (plan) | — |

---

## 7. Sketches

All sketches are above: Share menu (§1.1), consent window (§1.3), Manage panel (§1.4), handoff page (§3.3), presence row and People list (§4.2–4.3), report (§5.4).

---

## 8. Gaps and changes vs plan v4

| # | Change | Plan section | PR | Release |
|---|---|---|---|---|
| G1 | One Share button with "Send a copy" and "Invite to edit" sections; the Local release ships the copy half | §5.1, §5.4 | P2.9a (button, menu), P4.4 (live half) | Local + Live |
| G2 | Print / Save as PDF, Copy as Markdown, macOS Share submenu | §5.3 (export), §15 (PDF) | P2.8, P2.9a | Local |
| G3 | Consent is a main-owned modal window, not a message box (name field, terms link, inline errors) | §5.4, §7 | P4.4 (+ DE review) | Live |
| G4 | Name prefilled and optional in consent; banner prompt for joiners | §5.4 step 1 | P4.4, P4.5 | Live |
| G5 | ~~Mint edit, view and owner secrets at creation~~ **Superseded (plan v8, S1, D40): the client generates the secrets and the server mints only `share_id`, storing hashes of derived tokens ([details spec §8.2](../superpowers/specs/2026-11-15-desktop-documents-and-editor-details.md)).** View link always available | §6 shares | P4.2a | Live |
| G6 | No Comment role; no user-set expiry; show last-edit and days left | §5.4 | P4.4 | Live |
| G7 | Link displayed truncated with the secret hidden; copy only | §5.4 step 4 | P4.4 | Live |
| G8 | "Make view-only" → "Make view-only for everyone…", plus "Allow editing again…" (new edit secret) | §5.4, §6 owner endpoints | P4.2c, P4.4 | Live |
| G9 | Kill switch shows a disabled Share with a reason instead of hiding it; §5.5 rows for SharesOff and server read-only | §5.5, §8.5 | P4.0 (reducer rows), P4.4 | Live |
| G10 | Queued Stop sharing while offline ("Stopping…") or refuse (Q5) | §5.4, arch §6.1 | P4.0, P4.4 | Live |
| G11 | Handoff page never auto-tries the scheme; secret kept in `sessionStorage`; role-neutral generic preview; malformed-link copy; phone variant | §5.4 joining | P4.3 | Live |
| G12 | Join edge cases: role upgrade, own link, second computer copy | §5.4 | P4.5 | Live |
| G13 | Presence row, People list, Go to, Follow, `idle`, collision suffixes, "unverified names" footer, opt-in join/leave announcements | — (absent) | **New P4.7** (UX + SE), or inside P4.4 | Live |
| G14 | Version saved before a large remote arrival; "changes made elsewhere" pill | §5.5 Other prompts | P4.0, P4.4 | Live |
| G15 | Report dialog fields and the "also stop syncing" option | §6 abuse | P4.2e (server), P4.3/P4.4 (UI) | Live |
| G16 | Help › Sharing safely gets the leak and send-a-copy content | §5.2 Help | P2.9b (copy half), P4.4 (live half) | Local + Live |
| G17 | Colour buttons named, not hex (web and desktop) | — | Small web PR, any time | Web |

P4.6 (schema skew) has no UX change beyond the existing Paused (update needed) row.

---

## 9. Owner questions

- **Q1.** Show the document title on the handoff page before the click? (Recommended: no.)
- **Q2.** In the Local release, does the toolbar Share button appear (with only Send a copy), or does it wait for the Live release? (Recommended: appear.)
- **Q3.** Terms: a sentence with a link (recommended), or a first-time checkbox?
- **Q4.** Should a second computer of yours be able to manage a share (export the owner secret), or is "only the creating computer" final (D5)?
- **Q5.** Stop sharing while offline: queue it (recommended) or refuse?
- **Q6.** Markdown export of images: sibling folder or dropped with a note? Should copies of a live document mention that a live link exists?
- **Q7.** Tell people when someone follows them? (Recommended: no, as Figma.)

---

## Sources

- W3C TAG, [Good Practices for Capability URLs](https://www.w3.org/2001/tag/doc/capability-urls)
- Google, [Share files from Google Drive](https://support.google.com/drive/answer/2494822); [anonymous viewers](https://support.google.com/docs/answer/2494888); [Follow a collaborator in Slides](https://support.google.com/docs/answer/12815819)
- Figma, [Spotlight and following](https://help.figma.com/hc/en-us/articles/360040322673)
- Excalidraw, [E2EE blog](https://plus.excalidraw.com/blog/end-to-end-encryption); [session workflow discussion](https://lightrun.com/answers/excalidraw-excalidraw-investigate-simplifying-collaboration-session-workflow)
- HackMD, [note permissions](https://hackmd.io/@docs/note-permission-en)
- Etherpad, [documentation](https://etherpad.org/doc/v1.8.0/)
- Notion, [sharing and permissions](https://www.notion.com/help/sharing-and-permissions); [publish to web](https://www.notion.com/help/guides/publish-notion-pages-to-the-web)
- Dropbox, [Paper sharing](https://help.dropbox.com/files-folders/paper/share-doc)
- Apple, [Share notes in Notes on Mac](https://support.apple.com/guide/notes/share-your-notes-and-folders-apda5307056b/4.9/mac)
- tldraw, [user following](https://tldraw.dev/sdk-features/user-following); [collaboration](https://tldraw.dev/docs/collaboration)
- Linear, [desktop app links](https://linear.app/docs/get-the-app)
- Bitwarden, [Send lifespan](https://bitwarden.com/help/send-lifespan/)
- Proton, [Drive shareable links](https://proton.me/support/drive-shareable-link)
- Mozilla, [What happened to Firefox Send?](https://support.mozilla.org/kb/what-happened-firefox-send)
- Slack, [robots](https://api.slack.com/robots); Microsoft Tech Community, [Safe Links and one-time URLs](https://techcommunity.microsoft.com/t5/office-365/o365-url-scan-safe-links-impact-to-one-time-url/m-p/977132)
- Electron, [ShareMenu](https://electronjs.org/docs/latest/api/share-menu); Microsoft, [Windows share sheet](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/integrate-sharesheet-send)
- W3C, [ARIA22 role=status](https://w3.org/WAI/WCAG22/Techniques/aria/ARIA22)
