# TinyDocy comments: design

> **Owner answers (2026-11-16):** D13, cutting the margin rail is pre-approved if comments run late; markers and the Comments panel stay. D14, the owner runs the read-only production root audit before P4.2f-1 deploys.

> **Plan v8 (2026-11-16):** **D39** widens D9: comments also work in the personal web library's documents, as on desktop (§6.3). **D36** makes phones and tablets fully supported in v1: the phone bottom sheet and the 640–767 px sheet over the right (§11.2), built in M26 ([phones and tablets design](2026-11-16-phones-tablets-design.md)). The view-link token is the S1 derived `auth_view` (plan §6).


> **Built in P4.9 (2026-11-22), amending this design where the anchor fuzz disagreed:**
> - **The fallback pair (§5.2, §5.3):** a re-anchor keeps the pair the thread had before its *first* re-anchor as `ps`/`pe`, not the pair it replaces; Re-attach still keeps the current pair. With "the pair it replaces", undoing two structural edits lost the thread (321 of 31,584 fuzz threads); now 5 untrimmed threads do. When undo deletes a character the current pair sticks to and brings back every character of the earlier pair, the earlier pair wins.
> - **What a local edit checks (§5.3):** every thread in the *textblocks* a change touches, not only threads it overlaps, because the sync plugin diffs a block's text as strings and in repeated text deletes other, equal characters than ProseMirror did; a structural change checks the top-level blocks it spans, and `ReplaceAroundStep` (type change, wrap, lift) counts as structural. Re-anchors are made on the mapped range's text characters, never on a block boundary.
> - **The author id (§6.1) is per document** (SEC-002, [offline data-model revision](2026-11-22-offline-data-model-revision.md) §8): the first 128 bits of HMAC-SHA-256(`deviceSecret`, `lineage`) as 22 base64url characters (`authorIdFor`, `lib/comments/author-id.ts`). `deviceSecret` is 128 random bits under its own key, `tinydocy-author` (not inside `tinydocy-user`, so the editor chunk carries no identity code), minted on first use and never written to a Y.Doc, awareness, a URL or analytics; `lineage` is the document's frozen lineage (desktop `docs.lineage`, or a share's), which the host passes to `mountComments`. The id is resolved once when the controller loads (WebCrypto is async), so the store stays synchronous. Copies of one document share an id; two documents never do. Without WebCrypto (an insecure context, such as a LAN address over http) the id is random for the session and the lineage, so after a reload the writer no longer owns earlier messages. Nothing shipped the earlier per-browser id, so nothing migrates.
> - **The loader is split (§8):** the editor chunk holds only `mountComments`'s gate registration, the `COMMENTS_DEPS` object and one `import()`; deciding when the controller loads and resolving the author id are in a small lazy chunk (`comments-host.ts`, about 1.2 KB gz) that, like the controller, imports editor-chunk modules as types only. That host chunk loads on every `mountComments` call; the controller chunk still loads only on idle when the document has a `t:` key, on the first thread, or on the first Comment command. Nothing on the web mounts comments, so the web loads neither. `mountComments` needs the document's `lineage`, so web library documents (W2) and live shares (P4.0) must supply a frozen lineage before they mount comments.
> - **`listThreads(ydoc)`** (`lib/comments/list-threads.ts`) lists every thread of a bare Y.Doc with no editor, schema or DOM, marks Detached ones (neither anchor pair spans text, which agrees with the editor's resolution) and returns orphaned keys, without writing. Repair (offline data-model §4.5) reports from it; a later `comment_index` derives from it.
> - **The feature switch:** `canComment()` reads `NEXT_PUBLIC_COMMENTS` (`on`, default off) until the server reports `features.comments` (P4.2f-2).
> - **Residuals (§13), measured:** see §13's last bullet.
> - **Undo brings threads back (§5.3, §9.1), amended after review:** a remote or undo transaction also re-resolves every thread whose anchor is failing, so undo restores a deleted thread without a comment write. Yjs follows undo's re-created text (`redone`) only on the client that undid, so that client writes fresh anchors for a thread it alone can resolve (the only remote-side anchor write, and it comes from a Yjs resolution, never from a mapping). The re-anchor after a local structural edit runs in a microtask, not the next frame, so a collaborator's update can't map the ranges first and a hidden tab can't hold it back. One re-anchor pass is one Yjs update.

- **Status:** Draft for owner review (2026-11-16). P4.9 (comments core) is built; the rest is not.
- **Why now:** the owner decided **D9 = comments ship with live sharing**, in the single combined release (**D6 = one release**). This document is the complete design for that.
- **Decides:**
  - the comments data model and anchoring
  - who can do what
  - the server hardening that must land first
  - the UI, copy, performance, undo and tests
  - the PR breakdown and the cut order
- **Parent documents:**
  - [Plan](2026-11-15-desktop-local-first-design.md): §6 server, §7 security, K3, K5
  - [Architecture](2026-11-15-desktop-architecture.md)
  - [Details spec](2026-11-15-desktop-documents-and-editor-details.md): §1 rules (`WriteGate`, decoration-host stub), §7 review, §8 sharing
- **Replaces:** the comments section of the [organize, sort and review study](../../research/2026-11-15-organize-sort-review.md) (§5.2, §6, §7.2, §8). Where they disagree, **this document wins** (§14).
- **Evidence:** a headless anchor spike against the installed `@tiptap/y-tiptap` 3.3.0 and `yjs` 13.6.33 (§3). Everything marked *verified* was run. Everything marked *(unverified)* was not.

---

## 1. Decisions at a glance

| # | Decision |
|---|---|
| C1 | Threads live in a **flat** root `Y.Map` named `comments`. Its values are plain JSON (Yjs `ContentAny`), never nested Y types. One key per thread head, anchor, status and message (§4). |
| C2 | Anchors are `Y.RelativePosition` pairs: the start sticks to the first quoted character, the end to the last. **The client that makes a structural edit re-anchors** the threads it touched, from ProseMirror's own mapping. The previous anchor is kept as a fallback for undo (§5). |
| C3 | **No comment marks** in the schema (§4.4). |
| C4 | **Edit-link holders** comment, reply, resolve and reopen. They edit and delete **their own** messages. The **sharer** and the owner of a **Local** document can delete any thread. "Own" means the same local author id, which is **not verified** and says so (§6). |
| C5 | **View-link holders** read comments and never write (decided). The client gate is its own `canComment()`, not `WriteGate`. The server's `readOnly` is the backstop, never the gate (§6.2). |
| C6 | Comments work on **Local documents** as notes to self. They are off on the **web sandbox** and in the **Playground** (§6.3). |
| C7 | **Duplicate** leaves comments out (decided). **Send a copy** strips them by default and offers "Include comments" for TinyDocy documents only. Markdown, HTML, PDF and print never include them. Backups keep them (§6.4). |
| C8 | **Version restore and daily-snapshot restore touch only the text** by default. They never wipe comments; threads whose text is gone show as Detached. An additive option, **"Also bring back deleted comments"**, re-sets keys that exist in the version and are missing now, and never deletes anything (K3: a leaked link can't erase the discussion for good). (This supersedes the study.) |
| C9 | The server gets a **root allowlist per document kind**, a **comments validator** that rejects bad updates and never repairs them, caps, per-connection rate limits, a kill switch and takedown tooling. All of it lands **before** any client can write comments (§7). |
| C10 | Comment actions are **outside** the editor's undo stack, with an Undo pill. Applying a suggestion is **inside** it (§9). |
| C11 | **Zero new eager plugins.** Highlights use a `comments` layer of the P2.2 decoration host. All other code is one lazy chunk. Comments take **at most 150 B gz** of the 600 B shared editor allowance (§8). |
| C12 | No mentions, no notifications and no email. Activity shows only through the existing **Updated** marker and a local **New** dot (§11.9). |

---

## 2. Prior art and licences

| Product or library | What it does | What we take | Sources |
|---|---|---|---|
| **Tiptap Comments** | A paid Pro extension. Its overview page says to "subscribe to the Start plan", installs from Tiptap's private registry, and needs a Document server configured in the Tiptap dashboard. The page says nothing about self-hosted Hocuspocus, or about how threads are stored or anchored. | Nothing. It is paid and tied to Tiptap's platform, and its storage is undocumented. | [overview](https://tiptap.dev/docs/comments/getting-started/overview), [pricing](https://tiptap.dev/pricing), [Pro licence](https://tiptap.dev/docs/pro-license) |
| **BlockNote** | Comments live in `@blocknote/core/comments`, which uses a `comment` mark (`mark.ts` in the repository). Threads go in a `Y.Map` (the docs use `doc.getMap("threads")`). Core is **MPL-2.0**; only the `xl-*` packages are GPL-3.0. The docs warn that the Yjs thread store needs server-side validation, or users can change other people's comments, and that `DefaultThreadStoreAuth` only shows and hides UI. | The `Y.Map` shape. The warning, which is why the server PR comes first (§7). | [comments docs](https://www.blocknotejs.org/docs/features/collaboration/comments), [repo licence](https://github.com/TypeCellOS/BlockNote/blob/main/LICENSE.txt) |
| **Lexical playground** | Its collaboration page says the comment plugin syncs through a separate provider and Yjs room. The page does not say how comments are anchored. Lexical is MIT. | Comments kept apart from the text. We use one Y.Doc with a separate root, so versions, backups and the size cap cover both. | [Lexical collaboration](https://lexical.dev/docs/collaboration/react) |
| **Google Docs** | Reply (shortcut **R**), Resolve (**E**), Reopen, and Edit or Delete from More. You need comment or edit permission. Make a copy offers "Copy comments and suggestions". | R and E on a focused card, the copy checkbox pattern, and pulling the active card to its line. | [Docs help: comments](https://support.google.com/docs/answer/65129) |
| **Figma** | "Show resolved", unread first, and undoing a resolve by unticking it. | The Open and Resolved filter, and the New dot. | [Figma help](https://help.figma.com/hc/en-us/articles/360041547593) |
| **GitHub** | Suggested changes inside review comments. | Suggested replacement (§9.2) as the cheap form of suggestion mode. | [reviewing changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request) |
| **Yjs relative positions** | `createRelativePositionFromTypeIndex(type, index, assoc)`. `assoc >= 0` binds to the character after the index, and `assoc < 0` to the character before. The result is `null` if the type is deleted. | Everything in §5. | [Yjs docs](https://docs.yjs.dev/api/relative-positions) |
| **`prosemirror-suggest-changes`** | Tracked changes for ProseMirror. MIT (checked with `gh api`). | Kept for the later suggestion-mode spike. Not in this release. | [repository](https://github.com/handlewithcarecollective/prosemirror-suggest-changes) |

**Conclusion.** We build our own. Nothing open source fits our constraints together:
- no schema change
- view-only clients that read without writing
- server validation on Hocuspocus
- the editor-chunk budget

---

## 3. Spike: how anchors behave (verified)

**Setup.**
- A headless harness:
  - `updateYFragment` writes each ProseMirror state into a Y.Doc, the way the sync plugin does.
  - Anchors come from `absolutePositionToRelativePosition`, with the start rebuilt at `assoc 0`.
  - Anchors are resolved with `relativePositionToAbsolutePosition`.
  - A `Y.UndoManager` tracks the fragment.
- Run on 2026-11-16 from a session scratch folder, outside the repository. PR P4.9 turns these cases into the fuzz suite (§10).

| Case | What Yjs alone gives | After the editing client re-anchors from `tr.mapping` |
|---|---|---|
| Typing inside the range | Follows the edit ("beXta") | — |
| Typing just before the start, or just after the end | Not included. Start `assoc 0`, end `assoc −1`. | — |
| A remote concurrent insert inside the range | Follows it ("beZZta") | — |
| Bold on the anchored text (`addMark`) | Survives | — |
| Heading level 2 → 3 (`setNodeMarkup`, same node name) | Survives. Attributes are updated in place. | — |
| Paragraph → heading (`setBlockType`) | **Detached** (`null`). y-prosemirror recreates the element. | Re-anchored ("beta") |
| Wrap in a blockquote or list | **Detached** | Re-anchored |
| Join with the previous paragraph (Backspace at block start) | **Detached** | Re-anchored |
| Enter **before** the range, in the same paragraph | **Detached** | Re-anchored |
| Enter **inside** the range | Truncated to "be" | Re-anchored. The range spans both blocks. |
| `moveSection` (delete plus insert in one transaction, `lib/editor-utils.ts:287-289`) | **Detached** | Needs the move offset. PM mapping collapses a moved range, so `moveSection` adds a meta (§5.3). |
| Delete the anchored text, then undo | Collapsed while deleted, then **back to "beta"** after undo (Yjs `followRedone`) | — |
| Delete the whole paragraph, then undo | `null` while deleted, then back after undo | — |
| Re-anchor after paragraph → heading, a split or a move, then **undo** | New anchor: **Detached**. Previous anchor: **"beta"**. | That is why each thread keeps one previous anchor (§5.2). |

**Two more facts from the code:**
- y-tiptap's `absolutePositionToRelativePosition` always creates `assoc −1` (`index.js:52-56`). The start anchor is rebuilt with `assoc 0` from the decoded type and index.
- Remote changes reach ProseMirror as one replace step over **only the changed top-level children** (`replaceChangedChildren`, `index.js:1134-1156`). Decorations outside that range map exactly. Decorations inside it must be re-resolved from Yjs.

**Also verified:**
- `Uint8Array` values survive a `Y.Map` round trip inside a plain object (`ContentAny`).
- `XmlElement.clone()` copies a fragment into a new Y.Doc with attributes and formatting, and leaves the `comments` root behind (§6.4).

---

## 4. Data model

### 4.1 The `comments` root: one flat map

`doc.getMap("comments")` holds **plain JSON values only**. Each kind of entry gets its own key:

| Key | Value | Written when | Overwritten when |
|---|---|---|---|
| `t:<tid>` | `ThreadHead` | Create | Never. Deleted with the thread. |
| `a:<tid>` | `Anchors` | Create | Re-anchor, Re-attach |
| `s:<tid>` | `Status` | First resolve | Resolve, reopen, apply |
| `m:<tid>:<mid>` | `Message` | Each post. The opening message has `mid = tid`. | Edit, or delete (the body is replaced by a marker) |

```ts
// lib/comments/model.ts: shared by the client, the server validator and the import guard
type Id = string;                 // 22 chars of base64url, 128 random bits
type Author = { id: Id; n: string; k: CaretColor };       // n: 1–40 chars; k: one of CARET_COLORS
type ThreadHead = { v: 1; q: string; c: number; au: Author; sg?: string };
//   q: the quoted text, ≤ 280 chars; sg: a suggested replacement, ≤ 2,000 chars, no line breaks
type Anchors = { s: Uint8Array; e: Uint8Array; ps?: Uint8Array; pe?: Uint8Array };
//   each ≤ 64 bytes; item- or type-based relative positions (Yjs makes type-based ones at a
//   block's start or end); never name-based (tname), which `doc.get(tname)` would turn into a root
type Status = { r: boolean; at: number; by: Author; ap?: true };   // ap: resolved by Apply
type Message =
  | { au: Author; b: string; c: number; ed?: number }   // b: 1–2,000 chars
  | { au: Author; c: number; del: true };                // "Reply deleted"; keeps the ORIGINAL au and c,
                                                         // so a sharer's delete passes the same-author check
```

**Why flat keys, not nested Y types:**
1. **Server validation stays per struct.** `createRootResolver` (`hocus-document-guard.ts:149-226`) returns `null` for any item whose parent is another item. Nested `Y.Map` or `Y.Array` content can't be attributed to a root without walking the server document. A flat map keeps every struct one hop from its root.
2. **Last-writer-wins at the right grain.** Concurrent replies never clobber each other, because each has its own key. Editing your own message overwrites only that key. A resolve never races an anchor rewrite.
3. **Cheap counts.** Threads = `t:` keys, messages = `m:` keys.

**Timestamps** are claimed by the client. They are used only for display and sorting, and the server bounds them (§7.3).

**Reading the model.** Messages are grouped by the `tid` in their key and sorted by `c`, then `mid`. A key whose `t:` head is missing (a reply that raced a delete) is an **orphan**. Clients ignore orphans, and the server drops them when the document loads (§7.3).

### 4.2 Limits (one constants module, enforced by the client first)

| Limit | Client (UI refuses) | Server (hard, rejects) |
|---|---|---|
| Message body | 2,000 UTF-16 units | 2,000 |
| Quote | 280 (cut at a grapheme boundary, plus "…") | 300 |
| Suggestion | 2,000, single line | 2,000 |
| Author name | 1–40 after cleaning | 40 |
| Anchor bytes | — | 64 each |
| Threads per document (open plus resolved) | 300 | 320 (slack for concurrent creates) |
| Messages per thread | 100 | 120 |
| Messages per document | 3,000 | 3,200 |
| Comment bytes per document (live values) | 320 KiB | 384 KiB |
| New threads per minute | 6 | 10 per connection, live updates only (§7.4) |
| New or edited messages per minute | 20 | 40 per connection, live updates only |

- **The rule:** an honest client never produces an update the server rejects, because the client refuses first. A rejected update would stay pending in the client and be resent, and reconnect loops get IPs banned (K4).
- **CI test:** every update the client library produces passes the server validator (§10).
- **The comment byte budget** keeps comments from pushing a document into the 2 MiB size refusal, which would lock its text.
- **Measured the same way on both sides:** the encoded size of the **live** values in the map (`lib/comments/measure.ts`, shared). An overwrite subtracts the old value, and a delete subtracts it. A cumulative estimate would grow with every re-anchor and refuse an honest client whose own check passes.
- **Caps count net live keys after the update.** Keys created and deleted in the same update don't count, so "delete some comments, then retry" is a real way out (§7.3).
- **Offline and concurrent posting can still cross a cap honestly**: a week of offline comments, or many people posting at 299 threads. That is the one case where an honest client is refused, so it gets its own reason and recovery (`comments_full`, §7.3), never a silent stall.

### 4.3 Cleaning and rendering

- Names and bodies are cleaned on write and again on render:
  - strip bidi overrides and isolates (U+202A–202E, U+2066–2069)
  - strip C0 and C1 control characters, except `\n` in bodies
  - normalise to NFC
- Text is rendered as **plain text** in React text nodes. No HTML, no Markdown.
- **URLs are not made clickable in v1.** A clickable link from an unverified author is a phishing surface.
- The author colour is used in a `style` attribute, so it must be one of `CARET_COLORS`. The server checks this.

### 4.4 Why not marks

A mark wins on one point: it travels with the text through moves, splits and type changes (§3). That is real. It still loses overall:

1. **Schema.** A new mark is a schema bump through the server allowlist (`findDisallowedSchemaNames`) and the schema floor.
2. **View-only.** Adding a mark is a content edit. A view-link holder could never comment, and a future "can comment" role would be impossible to enforce.
3. **Undo.** Commenting would enter the text's undo stack. ⌘Z after posting would remove the highlight.
4. **Leaks.** Marks travel through copy and paste into other documents, and into Markdown export.
5. **Overlap.** Overlapping comment marks are fragile with y-prosemirror (BlockNote's own PR notes this, see the study).
6. **Modified and Updated.** Every comment would count as a text edit.

Re-anchoring by the editing client, plus one previous anchor, covers every structural case in §3 except the residual risks in §13.

---

## 5. Anchoring

### 5.1 Creating a thread

1. The selection is turned into a text range: trim whitespace at both ends, and require at least one character of text. With no selection, use the word at the caret. With no word, the command is disabled.
2. `start` = `assoc 0` at the first character, rebuilt from y-tiptap's `assoc −1` position. `end` = `assoc −1` after the last character. The positions come from the binding's `mapping` (`ySyncPluginKey.getState(state).binding.mapping`).
3. The quote is `doc.textBetween(from, to, " ")`, cut to 280.
4. One `doc.transact(…, COMMENT_ORIGIN)` writes `t:`, `a:` and `m:<tid>:<tid>`.

### 5.2 Resolving an anchor

```text
resolve(thread):
  r = rel→abs(a.s, a.e)                // y-tiptap relativePositionToAbsolutePosition
  if r is null or empty and a.ps exists:
      r = rel→abs(a.ps, a.pe)          // the anchor before the last re-anchor: covers undo
  if r is null or empty: Detached
  else the range [from, to)
```

- **Before resolving**, each anchor is checked to decode with `tname = null`. Item-based positions (`item` set) and type-based ones (`type` set: Yjs makes these at the start of a type with `assoc −1`, and at its end with `assoc ≥ 0`) are both valid. Name-based positions are refused: `createAbsolutePositionFromRelativePosition` calls `doc.get(tname)` for them, which would create a stray root on this client.
- **Cost.** One resolution walks the item's left siblings, then each ancestor's earlier siblings (`getParentOffset`). That is O(top-level blocks) per thread, so §8 bounds *when* it runs.

### 5.3 Re-anchoring (the editing client only)

The lazy chunk keeps `ranges: Map<tid, {from, to}>`, the current highlight ranges. It listens with `editor.on("transaction")`, which is an event listener, never `registerPlugin`.

| Transaction | What happens |
|---|---|
| Local, no doc change | Nothing |
| Local doc change that is **not** structural and touches no thread range (`changedRanges` from `extensions/shared`) | Map `ranges` through `tr.mapping`. Nothing else. |
| Local doc change that touches a thread range, **or** any structural transaction (`isStructuralTransaction(tr, tr.before)`: Enter, Backspace at a block start, type changes, wraps) | The threads to check are those whose ranges touch the changed ranges **plus every thread in the textblocks and top-level blocks the steps span**. The spike's "Enter before the range" and "join with the previous paragraph" cases detach anchors that the changed range never overlaps (§3). Map those ranges (start `assoc 1`, end `assoc −1`). In the next animation frame, after the sync plugin has written Yjs, resolve those threads from Yjs. If the resolved range differs from the mapped one, and the mapped range is not empty, write `a:` = `{ s, e, ps: old s, pe: old e }`. If the mapped range is empty, the text was deleted: **keep the anchor**, so undo brings it back. |
| Local `moveSection` (it gets `tr.setMeta("sectionMove", { from, to, insertAt })`) | Ranges inside `[from, to)` are shifted by the move offset instead of mapped. Then the same check. |
| Remote (`isChangeOrigin`) | Map `ranges` through the replace step. Threads whose ranges fell inside the replaced span are re-resolved from Yjs, at most once per frame. **Never re-anchor from a remote transaction.** Its mapping is a whole-span replace and would invent positions. |
| A `comments` map change (`observe`, `keysChanged`) | Re-resolve only the changed threads |

- **Who writes:** only the client that made the edit, which holds the exact mapping. If two clients re-anchor concurrently, the last write wins and both positions are valid.
- **Gated:** re-anchor writes go through `canComment()`. A view-only client never makes structural edits, so it never re-anchors.
- **Collaborators** briefly see the old anchor fail, between the fragment update and the `a:` update. **Detached is shown only if it lasts 1.5 s**, so nobody sees a flicker.
- **Missed re-anchors.** The re-anchor can be missed if an edit lands before the lazy chunk loads, the chunk fails to load, or the change came from a version restore. The thread then shows **Detached**, with **Re-attach to selection** (§11.8). No automatic matching on the quote: two clients doing it at once would race, and a repeated phrase would anchor to the wrong place.

### 5.4 Overlaps

- Ranges may overlap. Each open thread draws its own inline decoration, and nested tints darken.
- A click picks the **innermost** (shortest) range. ⌥-click cycles through the others.

---

## 6. Who can do what

### 6.1 Roles

| Action | Edit link | Sharer (owner secret on this computer) | View link | Local document |
|---|---|---|---|---|
| Read threads, open the panel | ✓ | ✓ | ✓ | ✓ |
| New comment, reply | ✓ | ✓ | — | ✓ |
| Resolve, reopen | ✓ any thread | ✓ | — | ✓ |
| Edit a message | own | own | — | own |
| Delete a message | own | any | — | any |
| Delete a thread | if you wrote its first message | any | — | any |
| Re-attach a Detached thread | ✓ | ✓ | — | ✓ |
| Apply a suggestion | ✓ (it's a text edit, so it passes `WriteGate`) | ✓ | — | ✓ |

**"Own" is honest, not secure.**
- `lib/user-identity.ts` stores only `{ name, color }`. The author `id` is per document (SEC-002, as built in P4.9): HMAC-SHA-256(`deviceSecret`, `lineage`), the first 128 bits as base64url, so comments in two documents can't be tied to one browser.
  - `deviceSecret` lives in `tinydocy-author` (P4.9; first planned as an id inside `tinydocy-user`), never in a Y.Doc.
  - On desktop the secret may move to `meta` when P4.0 moves identity there.
- The id is visible in the Y.Doc. Anyone holding an edit link can copy it and act as that author.
- The UI uses it only to prevent accidents. The panel footer says **"Names aren't verified."**, the same words as the People list.
- **Later, not now:** sign messages with a per-device Ed25519 key, for "same author as before" continuity. That still isn't identity.

**The sharer can delete any thread.** Otherwise a vandal's thread on your own shared document could never be removed. On a Local document every comment is yours to manage. This includes a joined document kept as Local after its link ended.

### 6.2 Enforcing view-only

1. **Client gate.**
   ```text
   canComment() = role ≠ view
                  && no readOnlyReason other than reading mode
                  && the document kind allows comments
                  && features.comments = "on"
   ```
   - It reads a ref, the same way `WriteGate`'s `canWrite` does.
   - **Every write** to the `comments` map goes through it: create, reply, resolve, delete and re-anchor.
   - `WriteGate` can't cover these, because they bypass ProseMirror.
   - Rule 1 applies: an update that has been created must never be dropped, so the gate runs **before** the `transact`.
2. **Server backstop.** The view token sets `connection.readOnly` (P4.2b), so their writes are ignored.
   - An honest client never reaches this.
   - The view-only test (§10) asserts that a view client produces **zero** Yjs updates.

**Reading mode** (⌥⌘R) blocks text edits but **allows comments**, because reviewing while reading is the point. It is the one exception to "reading mode makes no writes", and the zero-append check in P2.9a gets that exception.

### 6.3 Document kinds

| Kind | Comments | Why |
|---|---|---|
| Local desktop document | On | Notes to self. They go live with the document. |
| Web library document (`my.tiny.docs.plus`) | **On** (D39, v8), as for local desktop documents | The library is the user's own private place, like desktop. They go live with the document (W10). |
| Live (`share:*`), desktop and web `/s/` | On, per role | The feature itself |
| Web sandbox (tiny.docs.plus tabs) | **Off.** No button, and the server refuses the root. | An anonymous public surface. No abuse review exists for it, and the web has no Report path for sandbox content. |
| Playground (web and desktop) | Off. Disabled with a tooltip. | A system document that resets. |
| `global-tabs*` | — | Not a document |

### 6.4 Copies, exports and backups

| Path | Comments | How |
|---|---|---|
| Duplicate | **Left out** (decided) | A throwaway Y.Doc in the **renderer** gets the `default` children copied with `XmlElement.clone()` (verified, §3). The result goes to the worker as a state, like a `.tinydoc` import. The worker never parses Yjs, so the clone isn't done there. No `comments` root and no comment bytes. |
| Send a copy › TinyDocy document | **Stripped by default.** The checkbox "Include comments (12)" appears only when there are threads. | Unchecked: the same clone as Duplicate. Checked: the full state. |
| Send a copy › Markdown, HTML, PDF, print, Copy as Markdown | Never | The print stylesheet hides highlights. "Export with comments as footnotes" is later work. |
| Daily backups (`.tinydoc` mirror) and daily library copies | Kept | They are your own document |
| Going live (Invite to edit) | Uploaded | The consent window says: "Everyone with the link will see this document and its 12 comments." |
| Import (`.tinydoc`) | Kept, if valid | The P2.6 import guard accepts the `comments` root and runs the same validator as the server (`lib/comments/validate.ts`). An invalid map refuses the import: "This file has comments TinyDocy can't read. Import it without comments? [Import without comments] [Cancel]". |
| Version restore (P4.8), daily-snapshot restore | Untouched by default (C8) | Restore is a forward edit of `default` only (`updateYFragment`). It never deletes discussion that happened since. The restore sheet's checkbox **"Also bring back deleted comments (4)"** (shown only when the version has comment keys missing now) re-sets those keys in one `COMMENT_ORIGIN` transaction. It goes through `canComment()` and the caps, and only adds. |

---

## 7. Server hardening (PR P4.2f, before any client writes comments)

Today the server already:
- checks schema names and loose content in the editor root
- passes any other root, bounded only by size (`hocus-document-guard.ts:262-280`)
- passes delete-only frames even at the cap (`:422`)
- relays awareness with only a size check (`:443`)

### 7.1 Root allowlist per document kind

| Kind | Allowed roots |
|---|---|
| `global-tabs`, `global-tabs-*` | `tabs`, `meta` (`hooks/use-synced-tabs.ts:66-67`) |
| Sandbox documents and `playground` | `default` |
| `share:*` | `default`, `comments` |

- **How:** every item whose resolved root is outside the list is rejected with `schema_rejected` (4422). The resolver is the existing one, unchanged for new items.
- **Unresolvable roots:** a root that resolves to `undefined` (pending, origin not on the server yet) is allowed only for `default`, as today. For other roots it fails closed. The Yjs map writes we make always carry a parent or an origin that is on the server.
- **Deploy prerequisite (owner):** run `bun scripts/audit-doc-roots.ts` (new, read-only) against the production database before enforcing. It counts the roots in each stored document. Stray roots in stored documents are left in place; only new writes are refused. The CHANGELOG Deploy note gives the command.

### 7.2 Delete-set root checks

- For each range in the update's delete set, walk the server's items covering the range (`Y.findIndexSS` over the client's structs, as Yjs does when it applies deletes) and resolve each one's root. One range can span several roots. A deletion in a root the kind doesn't allow is rejected.
- **Honest scope:** this is **defence in depth only.** An edit-link holder may delete anything in `default` or `comments` by design. The check only becomes load-bearing with a future comment-only role.
- The cost is O(items deleted), the same order as Yjs applying the delete set. It runs on every frame that has one. Over the cap, delete-only frames still pass, as today.

### 7.3 The comments validator

`lib/comments/validate.ts` is pure, with no Hocuspocus imports. The guard, the desktop import guard and the client tests all use it.

| Check | Rejected when |
|---|---|
| Content type | Anything in `comments` other than `ContentAny` with one value, or `ContentDeleted`. That rules out nested types, strings, formats, embeds, binary and subdocs. |
| Map shape | An item with no key. That means an array-style insert into the map root. |
| **Key** | The key is read from `parentSub` for a new key. For an **overwrite**, which encodes an origin instead of a parent and key, it is read from the origin item, in the update or on the server. **This extends `createRootResolver`** to return `{ root, key }`. The key must match `^(t\|a\|s):[A-Za-z0-9_-]{22}$` or `^m:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{22}$`. |
| Value shape | It doesn't match its key's type (§4.1). Unknown fields, wrong types, or lengths over the server limits (§4.2). The colour isn't in `CARET_COLORS`. The name is empty after cleaning. `v` ≠ 1 for a *new* head (future versions bump the client floor). |
| Anchors | Not decodable, longer than 64 bytes, or name-based (`tname` set). Item- and type-based positions are valid. |
| Times | `c`, `at` or `ed` aren't finite, are before 2026-01-01, or are more than 24 h after server time |
| Overwrites | Of a `t:` key, which is immutable. Or of an `m:` key with a different `au` or `c` than the value it replaces. Edits and delete markers keep the original author, so the sharer's delete passes. *This is a consistency check, not security, since ids are spoofable.* |
| Caps (refused as `comments_full`, not `schema_rejected`) | **Net live keys after the update:** live `t:` keys > 320, messages per thread > 120 or per document > 3,200, or live comment bytes > 384 KiB (`measure.ts`, the same function as the client). Keys created and deleted in the same update don't count. An update that lowers or keeps every count always passes, so deletes and `a:` and `s:` overwrites are never refused by a cap. |

- **Counters** (live keys and live bytes) are kept per document in memory. They are recomputed on `afterLoadDocument` and updated from each applied update's changed keys in `onChange`. Overwrites subtract the old value's bytes, so re-anchors don't grow the count.
- **Two refusal reasons, two meanings:**
  - `schema_rejected` (4422): shape, key, content type, anchors, times, overwrites. Only a hostile or broken client gets here.
  - **`comments_full`** (new, 4409): a cap. An **honest** client can get here: a week of offline comments, or many people posting at 299 threads. The client maps it to **Paused (comments full)**. Text sync is paused too, because the pending update holds both. The chip copy is in §11.10.
  - **Recovery** is real because caps count net live keys: the user deletes comments on this computer (their own offline ones, or resolved ones) and chooses **Retry**. The next sync step 2 carries the creations and the deletions together and passes.
- **Reject, never repair.** Nothing deletes an honest collaborator's comment after it is applied.
- **The one load-time cleanup:** orphaned `a:`, `s:` and `m:` keys whose `t:` head is gone are deleted in `afterLoadDocument`, before any client connects. This mirrors `sweepEditorRoot` at load.

### 7.4 Rate limits

- Counted per connection, in `beforeHandleMessage`, on **live update frames** (`SYNC_UPDATE`) only:
  - new `t:` keys: `HOCUS_COMMENT_THREADS_PER_MINUTE` (default 10)
  - new or edited `m:` keys: `HOCUS_COMMENT_MESSAGES_PER_MINUTE` (default 40)
- **Catch-up is exempt.** The first sync step 2 of a connection carries everything written offline. It isn't rate-limited, only capped (§7.3). Otherwise a week of offline comments would be refused on reconnect and pause the whole document. Later step 2 frames on the same connection count toward the rate.
- Over the limit, the connection is refused with a `comment_rate` guardrail refusal.
- Honest clients stop earlier (6 and 20) with their own copy, so only scripted clients hit this. Reconnects are bounded by the existing upgrade rate limit and Throttle.
- `a:` rewrites aren't rate-limited (a section move can touch many threads at once). Their size is bounded by the thread cap.

### 7.5 Awareness

Nothing comment-related goes into awareness: no drafts and no typing state. P4.2b's viewer marking is unchanged.

### 7.6 Abuse, reports and takedown (K3, K5)

- **Report:**
  - The **Report…** item in a thread's ⋯ menu (desktop and `/s/`) posts `{ share_id, thread_id, reason, contact? }` to the P4.2e endpoint.
  - It has the same rate limits as reporting the whole document.
- **Operator:**
  - `share-admin comments <id>` lists threads with authors, times and the first 80 characters.
  - `share-admin delete-comment <id> <tid>` deletes the thread's keys in a server-side transaction. Live clients receive the deletion.
  - `share-admin export` already includes the comments, since they are Y.Doc state.
- **Logs:**
  - `ws_comment_rejected` (reason, ip, documentName; never the text) and `ws_comment_rate`. Both count toward the hourly alert thresholds.
  - Log lines never contain comment bodies or names.
- **The takedown runbook** gains a "remove one comment" step.

### 7.7 Kill switch and the schema floor

- **`HOCUS_COMMENTS=on|readonly|off`**, reported in `/api/info.features.comments`.
  - `readonly`: reading and deleting are allowed, and the server refuses new `t:` and `m:` keys and edits.
  - `off`: the server refuses every comment write except deletes, and clients hide comment creation.
- **Schema floor.** `comments` is a root, not a node or mark, so the ProseMirror schema floor (`minDesktopSchema`) is untouched.
  - Because D6 is one combined release, **no desktop client without comments will ever exist**, and `/s/` ships in the same deploy.
  - Future format changes bump `v`. A client meeting a head with an unknown `v` shows that thread read-only: "This comment was made in a newer TinyDocy. Update to see it." The server accepts new heads only at versions `minClientSchema` allows.

### 7.8 OWASP notes for the Gate 4 write-up

- **Injection:** plain-text rendering, bidi cleaning, the colour allowlist.
- **Access control:** view-only on the server, plus "own" as UI only, stated.
- **DoS:** caps, the byte budget, rate limits, and the per-update decode bounded by the existing frame cap.
- **Logging:** no content.
- **Spoofing:** names aren't verified, said in the UI.
- **Phishing:** links aren't clickable.

---

## 8. Performance

| Concern | Design | Budget and check |
|---|---|---|
| **Eager code** | No new plugin. Highlights are the `comments` layer of the P2.2 decoration host. The host's layer option `map: true` maps the set on doc changes (`DecorationSet.map`, O(log n) per change). The action-preview layer keeps clearing instead. The comment command is one entry in `lib/editor-actions`. `moveSection` gets one `setMeta`. As built in P4.9, `mountComments` adds the `COMMENTS_DEPS` object, the gate registration and one `import()` once a host imports it (measured in the D23 ledger row; not in the 150 B). | **≤ 150 B gz** of the 600 B allowance, measured by `scripts/check-editor-chunk-size.ts`. If the allowance can't fit it, the toolbar count button moves into the lazy toolbar menu first. |
| **Lazy chunk** | `comments` (store, anchors, re-anchor, layout, rail, panel, cards). Preloaded on idle when the opened document has any `t:` key, and loaded on the first Comment command. Like the continue chip, it **imports no editor-chunk module**; the editor helpers it needs (y-tiptap position helpers, `changedRanges`) are passed in as props. It never calls `registerPlugin` (that re-creates every plugin view). | Target ≤ 14 KB gz, reported per PR |
| **Typing** | Per local keystroke: the host maps its set, and the lazy listener checks `changedRanges` against `ranges`. Yjs resolution runs only for threads the change touched, one frame later. | `perf` project: a 1,000-heading document with 300 threads keeps typing p95 within 5% of the same document with none |
| **Opening** | The first resolution of every thread is O(threads × top-level blocks). It runs in idle slices of 50 threads, with on-screen threads first. | ≤ 50 ms of total main-thread time for 300 threads on a 2,000-block document. No single slice over 8 ms. |
| **Remote bursts** | Re-resolve only the threads inside the replaced span, at most once per frame. Never all threads per update. | A remote paste of 100 blocks re-resolves in ≤ 8 ms. **Measured in P4.9** (stress probe, headless): 7.8–9.4 ms, so **over budget in some runs**; the probe allows a 4× margin and is non-blocking in CI. |
| **Card positions** | Only cards whose anchors are within one screen of the viewport are rendered (virtualised). Positions are read with `coordsAtPos` in one rAF, all reads before any writes. The pass is triggered by scroll, a `ResizeObserver` on the content, and range changes. It never runs synchronously in a transaction. Blocks with `content-visibility: auto` give estimated positions off screen, which is why only near-viewport cards are placed. | ≤ 1 ms per frame for 20 visible cards |
| **Shell** | No subscription in the editor shell. The toolbar count reads a coarse `commentCountStore` that emits only when the open-thread count changes (the presence-store pattern, details rule 4). | The existing toolbar re-render test also covers a comment arriving |
| **Memory** | All listeners, observers and the `ResizeObserver` are removed on editor destroy and on document switch. One store per document session. | A unit test checks that nothing is left after 20 open and close cycles |

---

## 9. Undo, redo and suggested replacements

### 9.1 Comment actions are outside the editor's undo stack

- The editor's undo manager tracks only the fragment, with the sync plugin's origin. Comment writes use `COMMENT_ORIGIN` in the `comments` root, so ⌘Z in the text never unposts, unresolves or re-deletes a comment.
- Resolve, delete and Apply each show a pill with **[Undo]** (8 s). The pill's Undo is a **forward write**:
  - after a resolve, it reopens
  - after a delete, it re-writes the keys kept in memory
- Drafts use the text field's own undo.
- The undo of an anchored **text** deletion restores the anchor by itself (Yjs `followRedone`, verified). Undoing a structural edit falls back to the previous anchor (verified).

### 9.2 Suggested replacement (the first thing to cut, §12)

- **Writing one:** the draft card has a **Suggest a change** toggle. It pre-fills the quoted text for editing, as one line.
  - It is disabled when the range spans blocks, with the tooltip "Select text inside one paragraph to suggest a change."
- **[Apply]:**
  - One ProseMirror transaction replaces the anchored range with the suggestion as plain text. It is **inside** the editor's undo and passes `WriteGate`.
  - It carries meta `commentApply: { tid, from, to: from + length }`, so the re-anchor points the thread at the new text.
  - It then writes `s:` = `{ r: true, ap: true, … }`. The card reads "Applied by Ana".
- **Undo after Apply:**
  - ⌘Z reverts only the text, and the thread stays resolved.
  - The pill's **[Undo]** does both: an editor undo, but only if the Apply is still the top undo step, then a reopen.
- **Stale guard:** if the anchored text no longer equals `q`, Apply is disabled, with the tooltip "The text has changed since this suggestion. Edit it by hand."
- **Formatting:** if the range has marks, the card warns "Replaces formatting in this range."

---

## 10. Tests

| Layer | Test | PR |
|---|---|---|
| **Anchor fuzz** (`tests/unit/fuzz/comment-anchors.test.ts`) | Random documents with 1–30 threads. Random sequences of typing, deletes, split, join, `setBlockType`, wrap, lift, `moveSection`, `addMark` and paste-replace, with **required fixed cases** for a split or join *before* the range in the same block (the spike's detaching cases), each run through `updateYFragment` and the re-anchor logic. **Oracle:** the original range mapped through every ProseMirror step. **Invariants:** a thread whose text survives resolves to the oracle's text; a thread whose text was fully deleted is Detached; after undoing everything with `Y.UndoManager`, **every** thread resolves to its original quote. Seeded and reproducible, 2,000 cases per run, with the stress probe taking 50,000. | P4.9 |
| **Convergence** | Three Y.Docs, interleaved random edits, comments and re-anchors, synced in random orders and with random delays. After a full sync, every client resolves every thread to the same range and status. Concurrent create at 299 threads stays ≤ 320 on the server. | P4.9 |
| **Server validator** (`tests/unit/lib/security/`) | A refusal matrix: unknown root per kind; nested Y type, string, format or binary in `comments`; array-style insert; a bad key; overwrite of `t:`; an overwrite whose key comes only from the origin chain (in the update, and on the server); oversized body, quote or name; an unknown colour; bidi characters; a name-based anchor; anchors over 64 bytes; future and ancient times; the thread, message and byte caps; a delete set in a disallowed root; rate limits per connection; `HOCUS_COMMENTS=readonly\|off`. Load-time orphan cleanup. | P4.2f |
| **Client-server agreement** | A property test: every update produced by `lib/comments` operations (create, reply, edit, delete, resolve, re-anchor, Apply) over random histories passes `validate.ts`, including ranges at a block's start and end (type-based anchors) and a sharer deleting someone else's message. **Offline catch-up:** 30 comments written offline arrive in one step 2 and pass; crossing a cap yields `comments_full`, and deleting locally then retrying passes. A 1,000-re-anchor history never moves the byte count. | P4.9 |
| **View-only** | The unit test checks that a store with `role = view` produces **zero** `update` events across every action. The e2e test opens `/s/` with a view token, finds no enabled Comment control, and asserts through a test hook that the provider sent no sync update frames. A raw comment update injected over a view connection is not applied on the server. | P4.11 |
| **e2e** (`chromium`, against `make dev` with shares enabled) | Create, reply, resolve, reopen and delete across two browser contexts. A Detached thread after a remote deletion, with Re-attach. Offline posting syncs on reconnect. The section-move re-anchor. Narrow-window panel. Keyboard-only flow. | P4.10 |
| **Copies** | Duplicate and Send a copy (default) contain no `comments` root and none of the comment text in their bytes. "Include comments" keeps them. Markdown export never contains them. Import of a hostile `.tinydoc` is refused with the copy above. | P4.11 |
| **Performance** | `perf` project cases from §8. A nightly `yjs-soak` variant with 3 clients commenting at the client rate limits for 10 minutes: no refusals and no bans. | **P4.9:** the opening and remote-burst budgets, measured headless in the stress probe (`tests/unit/stress/comment-anchors.test.ts`, non-blocking; see §8 for the remote-burst result). The `perf` Playwright typing case ("typing p95 within 5% with 300 threads") is written in P4.9 (`tests/e2e/performance.spec.ts`, "typing latency with comments") but skipped unless `PERF_COMMENTS=1`, because nothing on the web mounts comments yet: a dev-only hook mounts them and seeds the threads. Run it with `PERF_COMMENTS=1 CI= bun playwright test --project=perf -g "threads"` against `make dev`. **P4.10:** turns that case on in CI once a page mounts comments, and the nightly `yjs-soak` variant. No blocking timing test runs in the default suite: shared CI runners make tight timings flaky. |
| **Design review** | Screenshots at 1440, 1100 and 820 px, light and dark, every state in §11.10 | P4.10 |

---

## 11. UI and UX

### 11.1 Adding a comment

| Entry | macOS | Windows / Linux |
|---|---|---|
| Keyboard | **⌥⌘M** (Docs parity; free in the editor's key registry; on desktop the app menu owns it, so the macOS "Minimize All" alternate never fires; check in S1) | Menu only on Windows and Linux (Ctrl+Alt+M is AltGr+M, which types µ on German layouts; plan v7) |
| Selection bubble | A **Comment** button (lucide `MessageSquarePlus` from `lib/icons.tsx`), last in the bubble | same |
| Context menu | "Comment…" | same |
| Menu and palette | Insert › Comment; the palette's "Comment" | same |
| Toolbar | Not a toolbar button. The toolbar holds only the count (§11.7). | — |
| Phones and tablets (v8, D36; phones design §5.5, M26) | The phone bar's 🖌 cell becomes 💬 where `canComment()` is true; on tablets the row's count button becomes Comment while there is a selection | same |

- The **draft card** opens beside the range (in the rail, or at the top of the panel). Focus goes to its field. The range gets a "draft" tint.
- On first use, the card shows "Commenting as **Calm Otter** · Change", which opens the existing identity field.
- **⌘Enter** posts and **Esc** cancels. If the draft has text, Esc asks first: "Discard this comment? [Keep Editing] [Discard]".
- After posting, focus **returns to the editor**, with the selection collapsed to the end of the range.

### 11.2 Layout: rail, markers and panel

**Principle:** the content column never moves for comments. That matches the margin-positioned outline.

| Space to the right of the page | What shows |
|---|---|
| ≥ 280 px (card 248 + gutters) | The **rail**: cards beside their lines |
| < 280 px, gutter ≥ 28 px | **Markers**: a 20 px speech-bubble icon at each commented line. One per line, never a count. Clicking one opens the panel scrolled to that thread. |
| Large phones and small tablets (640–767 px: phone landscape, iPad mini portrait, narrow iPadOS windows; v8) | **Markers** if the gutter allows (≥ 28 px), else highlights. The Comments panel opens as a **360 px sheet over the right** of the page; the page doesn't move. (Phones design §4.1, M26.) |
| Phones (< 640 px) | Highlights only. Tapping one opens the thread in a bottom sheet. |

- **The rule is CSS only**, as container queries per page width on the editor pane. The pane is the window minus the 240 px sidebar.

  | Page width | Rail when the pane is at least | Window, sidebar open |
  |---|---|---|
  | Narrow 552 | 1,112 px | 1,352 px |
  | Standard 648 | 1,208 px | 1,448 px |
  | Wide 864 | 1,424 px | 1,664 px |
  | Full | never (markers plus panel) | — |

- **Alongside the outline.** The outline docks in the **left** margin (details §4: 1,240, 1,400 and 1,640 px), and the rail uses the **right** margin.
  - The outline docks slightly earlier than the rail appears, so between those widths you get the docked outline plus markers.
  - Neither takes space from the other.
- **The Comments panel** is the list view at any width:
  - a 360 px sheet over the right side
  - like the outline overlay below its breakpoint
  - it never pushes the content
  - opened from the count button, View › Comments, the palette, a marker, or **⌥⌘⇧M** (check in S1)
  - **Esc** closes it and returns focus to the editor
- **Hide comments:** View › Hide Comments hides the rail, markers and highlights for this window. It is remembered in `tinydocy-ui`.

### 11.3 Card placement and collision avoidance

1. Each card wants the top of its anchor line.
2. Walk down in document order, placing each card at `max(wanted, previous bottom + 8)`.
3. The **active** card is pinned to its own line. The cards above it are walked **upward**, making way (Google Docs).
4. Cards slide in 120 ms. Under reduced motion they don't animate.
5. Cards more than one screen away aren't rendered (§8). A thread whose anchor is in a folded section sits at the fold's heading line, labelled "In a folded section".

### 11.4 Highlights (decorations via the host)

- Open threads get `Decoration.inline(from, to, { class: "comment-range", "data-comment-thread": tid })`. The style is an underline plus a tint, never colour alone, with forced-colours `Mark`.
- The **active** thread adds `comment-range--active`, a stronger tint.
- Resolved and Detached threads draw nothing.
- **Clicking** a highlight activates the thread (§5.4 for overlaps). It is a delegated `click` listener on `view.dom`, added by the lazy chunk.
- **Caret into a range** activates its thread without moving focus. This runs on `selectionUpdate`, as an O(log n) `find` on the host's set.

### 11.5 Keyboard

| Where | Key | Does |
|---|---|---|
| Editor | ⌥⌘M | New comment |
| Editor | ⌥⌘⇧M | Open the panel and focus the active thread, or the first one |
| Editor | Palette: "Next comment" and "Previous comment" (no default key; a candidate pair is checked in S1) | Move the caret to the next thread's start and activate it |
| Card or panel (focus not in a field) | ↑ / ↓ or J / K | Previous or next thread |
| Card | **R** | Reply (Docs) |
| Card | **E** | Resolve or reopen (Docs) |
| Card | Enter | Go to the text: caret at the start of the range, scrolled to the top of the viewport after selection and focus settle (rAF), as for TOC clicks |
| Card | Delete | Delete your own message, after a confirm |
| Field | ⌘Enter / Esc | Post / cancel |

- The panel is a `complementary` landmark named "Comments". Its list is a `list`.
- Each thread is an `article` labelled "Comment by Sam on “desktop app”, 2 replies".
- Highlights carry no ARIA inside the contenteditable. Navigation is through the landmark and "Next comment".

### 11.6 Resolve, reopen, filters

- **Resolve** hides the card and its highlight. Pill: "Resolved. [Undo]".
- **Reopen** is on resolved cards, in the panel's Resolved tab.
- **Panel controls:**
  - tabs **Open (5) | Resolved (12)**
  - sort **Document order** (default) or **Newest**
  - nothing else, since "Only mine" needs identity

### 11.7 Count

- When the document has open threads, the toolbar shows a **comment count button** (`MessageSquare` + "5"). It opens the panel.
- With no open threads, the button is hidden, unless the panel is open.
- When the toolbar is collapsed, the count is inside ⋯ as "Comments (5)".
- On desktop the status chip doesn't show comments. It shows sync, not activity.

### 11.8 Detached threads

- They appear in the panel (Open tab) with a **Detached** badge, the line "The text this comment was on was deleted or changed.", and the quote in muted italics.
- Actions:
  - **[Re-attach to selection]** writes new anchors from the current selection, keeping the old pair as `ps` and `pe`. Without a selection it is disabled, with the tooltip "Select text, then re-attach."
  - **[Resolve]**
  - **[Delete]**, by the rules in §6.1
- **No rail card and no marker**, since there is no line.

### 11.9 Activity without accounts

- **No notifications.** No mentions: "@" stays plain text.
- Comments by others set the existing **Updated** marker (P4.8), because the comments root changes the state vector the marker compares against.
- **Desktop only:** inside the document, a thread with a message whose Yjs item isn't covered by the stored `seen_sv` (P4.0), and whose author id isn't yours, gets a **New** dot. "New" is cleared when the thread is shown on screen for 1 s or opened. The web `/s/` view has no `seen_sv` and shows no New dot.
- **Presence (P4.7):**
  - Comment authors use the same name and colour as their caret.
  - The People list is unchanged.
  - The active thread, drafts and "is replying" aren't broadcast (later work).
  - A **viewer** sees the same threads as an editor, read-only.

### 11.10 Copy, every state

| State | Where | Copy |
|---|---|---|
| Comment button tooltip | bubble, menu | "Comment (⌥⌘M)" |
| Draft placeholder | card | "Add a comment…" |
| Reply placeholder | card | "Reply…" |
| Post buttons | card | [Comment] [Cancel]; for a reply, [Reply] |
| Discard a draft | dialog | "Discard this comment?" [Keep Editing] [Discard] |
| No text to anchor | tooltip | "Select text to comment on." |
| First use | draft card | "Commenting as Calm Otter · Change" |
| Near the length limit | under the field, from 1,800 | "212 characters left" |
| Too long | under the field; Post disabled | "Comments can be up to 2,000 characters." |
| Too many threads | tooltip, command disabled | "This document has 300 comments, the most it can hold. Delete resolved comments to add more." |
| Too many replies | tooltip, Reply disabled | "This thread has 100 replies, the most it can hold. Start a new comment." |
| Comment storage full (320 KiB) | tooltip | "Comments in this document are full. Delete resolved comments to add more." |
| Client rate limit | under the field | "You're commenting very fast. Wait a moment and try again." |
| Offline (live document) | card footer, muted | "Will be sent when you're back online." |
| View link | disabled tooltip and panel footer | "You can read this document and its comments. Ask for an edit link to comment." |
| Document from a newer version | tooltip | "Update TinyDocy to comment on this document." |
| Size limit reached (`document_too_large`) | panel footer | "This document reached its size limit, so comments are read-only." |
| Server comment cap reached (`comments_full`, Paused) | status chip and its popover | Chip "Paused". Popover: "This document has more comments than the server allows. Your changes are kept on this computer and aren't syncing. Delete some comments, then choose Retry." [Show Comments] [Retry] |
| Restore with comments | version restore sheet | "Also bring back deleted comments (4)" |
| Comments turned off on the server (`readonly`) | panel footer | "Comments are read-only on the server right now." |
| Playground | tooltip | "Comments aren't available in the Playground." |
| Empty, Open tab | panel | "No comments yet. Select text and press ⌥⌘M to comment." |
| Empty, Resolved tab | panel | "No resolved comments." |
| Detached | card | Badge "Detached". "The text this comment was on was deleted or changed." The quote. |
| Re-attach without a selection | tooltip | "Select text, then re-attach." |
| Resolved | pill | "Resolved. [Undo]" |
| Resolved card header | panel | "Resolved by Ana · 14:10" |
| Delete a thread (live) | dialog | "Delete this comment and its 2 replies? It's deleted for everyone with the link." [Cancel] [Delete] |
| Delete a thread (Local) | dialog | "Delete this comment and its 2 replies?" [Cancel] [Delete] |
| Deleted | pill | "Comment deleted. [Undo]" |
| Deleted reply | in the thread | "Reply deleted" |
| Edited | after the time | "(edited)" |
| Thread deleted while you were replying | inline | "Your reply wasn't posted because this comment was deleted. [Copy Reply]" |
| Unknown version | card | "This comment was made in a newer TinyDocy. Update to see it." |
| Suggestion is stale | Apply tooltip | "The text has changed since this suggestion. Edit it by hand." |
| Suggestion over formatting | card | "Replaces formatting in this range." |
| Applied | resolved card | "Applied by Ana" |
| Names | panel footer | "Names aren't verified." |
| Report | thread ⋯ | "Report…" → "Report this comment to the server operator? [Cancel] [Report]" |
| Going live with comments | consent window | "Everyone with the link will see this document and its 12 comments." |
| Send a copy | checkbox | "Include comments (12)" |
| Hostile import | dialog | "This file has comments TinyDocy can't read. Import it without comments? [Import without comments] [Cancel]" |

---

## 12. PRs, dependencies, effort, cut order

| PR | Contents | Depends on | Lens | Effort |
|---|---|---|---|---|
| **P4.2f-1** Root allowlist | Per-kind root allowlist, delete-set root checks, `audit-doc-roots.ts`, Deploy note. **Independent: it can ship any time, before shares.** | — | SE | S (2–3 days incl. review) |
| **P4.2f-2** Comments validator | `lib/comments/model.ts` + `validate.ts` (shared), the resolver returning `{root, key}`, caps, counters, byte budget, rate limits, load-time orphan cleanup, `comments_full` (4409), the step-2 rate exemption, `HOCUS_COMMENTS`, abuse events, `share-admin comments` and `delete-comment`, Report with `thread_id`, runbook step, OWASP notes. | P4.2a/b/d/e | SE | M (1–1.5 weeks) |
| **P4.9** Comments core | Identity `id`; store with `canComment()`; anchors; re-anchor listener; `sectionMove` meta in `moveSection`; `comments` layer on the P2.2 host; limits; cleaning; anchor fuzz, convergence and client-server agreement tests; the headless `perf` budgets in the stress probe. | P2.2 (host, `WriteGate`), P4.2f-2 for live documents (Local documents work without it) | SE | L (1.5–2 weeks) |
| **P4.10** Comments UI | Draft card, rail, markers, panel, filters, count button, keyboard, every copy row, Hide Comments, reading-mode exception; e2e; turning on the `perf` Playwright typing case (written in P4.9, skipped by default) and the comments `yjs-soak` variant (§10); **design review**. | P4.9, P2.9c (page widths), the smart toolbar bubble and palette | UX + DE | L (2 weeks) |
| **P4.11** Comments in sharing and copies | View-only state and e2e (P4.4), presence colours and viewer read-only (P4.7), New dot from `seen_sv` (P4.0, P4.8), the consent-window count, the `comments_full` Paused state and Retry, "Also bring back deleted comments" in the restore sheet, Send a copy option, Duplicate clone, import guard, export and print stripping. | P4.4, P4.7, P4.8, P2.6, P2.8, P2.9a | SE + UX | M (1 week) |
| **P4.12** Suggested replacement | §9.2 | P4.10 | UX + SE | S–M (4–5 days) |

- **Total:** six PRs plus the usual follow-up tail (plan §8.1: about 20 for a feature this size).
- **Calendar:** about **4–5 weeks** of added Phase 4 work. With parallel tracks, P4.2f-1 early and P4.9 alongside P4.2, **Gate 5 moves by about 3 weeks**.

**Risks**

| # | Risk | Mitigation |
|---|---|---|
| CR1 | A missed re-anchor (edit before the chunk loads, a version restore) detaches threads | Preload on idle when threads exist; previous-anchor fallback; Re-attach; the fuzz suite measures how often it happens |
| CR2 | A validator bug refuses an honest client, causing a reconnect loop and an IP ban (K4) | One shared validator, the client-server agreement property test, client limits below server limits, a staging soak, `HOCUS_COMMENTS=readonly` |
| CR3 | Resolving every thread is slow on very large documents | Resolve only touched threads, idle slices, `perf` gates; cap 300 |
| CR4 | Spoofed names ("Approved by Alex") in review | "Names aren't verified." everywhere names appear; no claims of identity; later, signed continuity |
| CR5 | Comment spam on shared documents, or illegal content in comments (K5) | Per-thread Report, `delete-comment`, caps, rate limits, the kill switch |
| CR6 | Rail layout complexity with folding, `content-visibility` and page widths | Near-viewport cards only; fixed breakpoints in CSS; the panel always works |
| CR7 | The 600 B allowance is already used up by P2.2 | Comments need ≤ 150 B. The count button moves to lazy first. |

**Cut order if it slips** (each cut keeps a coherent feature):
1. **P4.12 suggested replacement**
2. **The rail.** Ship markers plus the panel only. The highlights and the draft card in the panel stay.
3. **The New dot** and Newest sort
4. **"Also bring back deleted comments"** on restore. K3 then relies on versions for the text only; say so in the K3 row.
5. **Editing messages.** Delete and repost stay.
6. **"Include comments"** in Send a copy. Always strip.
7. **Re-attach to selection.** Detached threads can still be resolved or deleted.

**Never cut:**
- the server PRs
- view-only enforcement
- the previous-anchor fallback
- the fuzz suite

---

## 13. Residual risks stated plainly

- **Anchors depend on the editing client.** A structural edit from a client that misses the re-anchor detaches threads for everyone. Detached threads keep their quote and discussion, and can be re-attached by hand.
- **Undo on a client without the comments controller can leave a thread Detached.** Undo re-creates deleted text as new items, and Yjs follows the old items to them (`redone`) only on the client that undid; `redone` is never sent. A client that runs the controller writes fresh anchors for such a thread (§5.3, as built in P4.9). A client that doesn't (an older build, or one where comments aren't mounted: today every web editor) restores the text but writes nothing, so for every client the thread stays Detached, keeping its quote and discussion, until someone re-attaches it. Undo on a client that runs the controller doesn't have this gap.
- **"Own" is a convention.** Anyone with an edit link can delete or resolve anything an edit holder can, and can pretend to be another author by copying their id.
- **A leaked edit link can delete every comment.** Versions bring them back only through the additive restore option (C8). If that option is cut, deleted discussion is gone for good.
- **Comments are as public as the link.** Anyone with a view link reads every comment, including resolved ones. The consent window's copy says so.
- **Anchor residuals, measured by the P4.9 fuzz** (50,000 cases, 769,424 threads): a thread resolves to other text than ProseMirror's mapping for 20 threads (0.003%) and fully deleted text still resolves for 213 (0.03%), both after the sync plugin's string diff deleted other, equal characters than ProseMirror did; after undoing everything, 214 untrimmed threads (0.03%) and 8.7% of threads whose text was partly deleted before a structural edit come back on part of their original text. The fuzz bounds these rates in CI.
- **Resolved comments are kept** until deleted. Deleted comments leave small Yjs tombstones (the key, not the text, once garbage collected).

---

## 14. Changes to other documents

| Document | Change |
|---|---|
| Organize, sort and review study §5.2 | Superseded by this document: flat keys instead of a nested `Y.Map` with a `replies` `Y.Array`; body 2,000 instead of 4,000; cap 300 threads in total, not 300 open; versions **don't** restore comments; the "can comment" link stays later; delete rights add the sharer and Local owners; `moveSection` re-anchors by meta instead of matching the quote. |
| Details spec §5 (E13), §7, §12 (D9), §13 | Comments move into the combined release. The calls "Duplicating leaves comments out" and "view-only reads comments" are kept. |
| Details spec §1 rule 6 | The decoration host gains a per-layer `map: true` option for comments. |
| Details spec §1 rule 2 | `WriteGate` covers text only. Comment writes have their own `canComment()` gate, under the same rule. |
| P2.9a exit check | Reading mode makes no writes **except comments**. |
| Plan §6 and Appendix A | P4.2f-1 and P4.2f-2 added. `HOCUS_COMMENTS` added to §8.5. Report gains `thread_id`. The OWASP write-up covers comments. |
| Plan §11 | CR1–CR7 added. K5 notes comments. K3's "versions" mitigation covers comments only through the additive restore option (C8). |
| Architecture §6.1 | A new Paused reason, `comments_full`, with Retry. Like the other Paused reasons it persists and is never retried automatically. |
| AGENTS.md (after merge) | Comments root, the re-anchor rule, `canComment()`, the root allowlist per kind. |
| CHANGELOG | Deploy notes for P4.2f-1 (audit first) and P4.2f-2 (`HOCUS_COMMENTS*` env). |

---

## 15. Owner questions (blocking only)

1. **Schedule.** Comments in the combined release add about 4–5 weeks of work and move Gate 5 by about 3 weeks. Accept that with the cut order in §12, or pre-approve shipping **without the rail** (cut 2) to save about a week?
2. **Run the root audit on production** (`audit-doc-roots.ts`, read-only) before P4.2f-1 is deployed. This is an owner action: the allowlist refuses writes to any root it finds in use, and only the owner can run against the production database.

Every other choice above is a call with a stated default, and the owner can reverse any of them.

---

## 16. Sources

- Tiptap: [Comments overview](https://tiptap.dev/docs/comments/getting-started/overview) · [Pricing](https://tiptap.dev/pricing) · [Pro licence](https://tiptap.dev/docs/pro-license)
- BlockNote: [Comments](https://www.blocknotejs.org/docs/features/collaboration/comments) · [Licence (MPL-2.0 core, GPL-3.0 xl-*)](https://github.com/TypeCellOS/BlockNote/blob/main/LICENSE.txt)
- Lexical: [Collaboration](https://lexical.dev/docs/collaboration/react)
- Google Docs: [Use comments and action items](https://support.google.com/docs/answer/65129)
- Figma: [Comments](https://help.figma.com/hc/en-us/articles/360041547593)
- GitHub: [Reviewing proposed changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- Yjs: [Relative positions](https://docs.yjs.dev/api/relative-positions) · `node_modules/yjs` 13.6.33 `createAbsolutePositionFromRelativePosition` (`followRedone`, `doc.get(tname)`)
- y-tiptap 3.3.0 (MIT): `absolutePositionToRelativePosition`, `relativePositionToAbsolutePosition`, `isStructuralTransaction`, `replaceChangedChildren` in `node_modules/@tiptap/y-tiptap/dist/index.js`
- [prosemirror-suggest-changes](https://github.com/handlewithcarecollective/prosemirror-suggest-changes) (MIT)
- Code: `lib/security/hocus-document-guard.ts`, `lib/editor-utils.ts` (`moveSection`), `extensions/action-preview/action-preview.ts`, `extensions/table-of-contents/toc-id-plugin.ts`, `lib/user-identity.ts`, `hooks/use-synced-tabs.ts`, `scripts/check-editor-chunk-size.ts`
