# Phase 1 Web Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1's web-safe fixes to tiny.docs.plus as small independent PRs:
- stop offline edits being overwritten (P1.1, P1.1b)
- clear the shortcut clashes (P1.2)
- fix the dark-mode contrast, the System theme and link underlines (F1, F3, F5)
- validate identity (F2)
- strip image metadata (A0)
- make closing a sandbox tab a soft delete with Undo (W1a server, W1b UI)

**Architecture:** Every PR changes existing web code in place, behind no new runtime flag, except P1.2's desktop branch (keyed on `NEXT_PUBLIC_APP_TARGET`, web unchanged) and W1a's `CLOSED_DOCUMENTS_LIST=0` kill switch. Offline fixes share one primitive: saves merge into the stored copy. W1a adds a `document_closures` table beside the untouched `documents` table and turns DELETE into a soft delete, with restore and list routes; W1b adds Undo and Recently closed on top.

**Tech Stack:** Next.js 16 App Router, Tiptap 3, Yjs 13.6, Hocuspocus 4, `bun:sqlite`, IndexedDB, Bun ≥ 1.4.4, `bun test` with happy-dom, Playwright.

**Base:** `main` at `e93169d`. Locate code by symbol, not by `:line`; line numbers are hints.

**Dispatch unit:** one whole PR section plus Global Constraints per implementer. Tasks reference their PR's Decisions block.

**Spec:**
- [docs/superpowers/specs/2026-11-15-desktop-local-first-design.md](../specs/2026-11-15-desktop-local-first-design.md) (v8): §2, §8.1 (review lenses), §8.4 Phase 1, §8.4b, D8
- [details spec](../specs/2026-11-15-desktop-documents-and-editor-details.md) §9 (W1)
- [preferences design](../specs/2026-11-16-preferences-design.md) (F1, F2, F3, F5)
- [image store design](../specs/2026-11-16-image-store-design.md) (A0)
- [web library design](../specs/2026-11-16-web-library-design.md) (P1.1b)
- [UX spec](../specs/2026-11-15-desktop-ux-design.md) §4.6 (P1.2)

Spikes S1–S5 are planned separately in [2026-11-16-phase-1-spikes.md](2026-11-16-phase-1-spikes.md).

## Global Constraints

- **Tooling:** Bun only (`bun test`, `bun run typecheck`, `bun run check`, `bun run lint`, `bun playwright test`). Never `npm`, `npx`, `yarn` or `pnpm`.
- **Code style:** named exports only; kebab-case file names; shadcn/ui and `lib/icons.tsx` for any UI.
- **Hydration:** never `useState(() => loadFromLocalStorage())`. Read storage in an effect behind a ready flag, or through `useSyncExternalStore` inside the `ssr: false` editor.
- **Offline rule:** never apply a device copy to a live doc after the provider has synced (AGENTS.md). A copy that arrives late merges into **storage** only.
- **Dev servers, one set per PR worktree.** `make dev` hardcodes Hocus on 1234 with `DB_PATH=db.sqlite`, so parallel worktrees run the two processes by hand, each PR on its own ports and DB (pattern from the smart-toolbar "later" plans). Ports 3000, 1234, 5000 and 6000 are off limits. Run `lsof -i :62NN -i :42NN` first and stop only what you started. Never test against tiny.docs.plus.

  | PR | P1.1 | P1.1b | P1.2 | F1 | F3 | F5 | F2 | A0 | W1a | W1b |
  |---|---|---|---|---|---|---|---|---|---|---|
  | `NN` | 51 | 52 | 53 | 54 | 55 | 56 | 57 | 58 | 59 | 60 |

  ```bash
  DB=$TMPDIR/tinydocy-<pr>.sqlite
  DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 \
    HOCUS_THROTTLE=0 MAX_TOTAL_DOCUMENTS=1000000 HOCUS_PORT=42NN DB_PATH="$DB" \
    HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun run hocus
  NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:42NN DB_PATH="$DB" HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun next dev -p 62NN
  ```

  Every `bun playwright test …` in this plan runs with the prefix `CI= E2E_BASE_URL=http://localhost:62NN E2E_HOCUS_URL=ws://127.0.0.1:42NN DB_PATH="$DB"` (W1's e2e helpers open the same SQLite file from the Playwright process). "The CI e2e command" means `bun playwright test --project=chromium --project=perf --retries=1`.
- **Production-build checks.** Stop `next dev` in the worktree first (both use `.next`), then `NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:42NN bun run build && PORT=63NN bun run start` (the URL also sets the CSP `connect-src`). A production build has no `window.__tiptap_editor`. Used by:
  - P1.1 and P1.1b: the `pwa` project once, `CI= PWA_BASE_URL=http://localhost:63NN bun playwright test --project=pwa`.
  - F3: `tests/e2e/theme-system.spec.ts` once with `E2E_BASE_URL=http://localhost:63NN`.
  - Editor-chunk PRs (below): the build the chunk script reads.
- **WebKit check (A0).** `tests/e2e/image-metadata.spec.ts` also runs with `--project=webkit` on the dev servers. A0 adds it to that project's `testMatch` in `playwright.config.ts`; the run is manual (CI runs chromium only; `bun playwright install webkit` once). Safari cannot encode WebP, so the JPEG fallback must hold.
- **Editor chunk** (P1.2, F2.3, A0.2, F3): stays within `EDITOR_CHUNK_BUDGET_BYTES`. Run `bun run build && bun scripts/check-editor-chunk-size.ts` on the branch and on `main`, and record both "growth" lines and their difference (gz) in the PR. The D23 ledger belongs to Phase 2.
- **Review lens** (spec §8.1): each PR header names the lens that must approve it. P1.1, P1.1b: SE · P1.2: UX · F1, F3, F5: UX · F2: SE+UX · A0: SE · W1a: SE · W1b: SE+UX.
- **Design review** for visible UI, before merge: screenshots at 1440, 1100, 820 and 375 px, light and dark (F1, F3, F5, F2, W1b). A tooltip- or label-only change (P1.2) needs 1440 px light and dark only.
- **CHANGELOG** (Keep a Changelog, under `## [Unreleased]`, in the PR's last commit), one template for every PR:

  ```markdown
  ### <title>

  <one paragraph: what a person notices>

  #### Fixed | Added | Changed
  - <one bullet per change>

  #### Deploy
  - <only when the operator must act>
  ```
- **Docs:** a PR that adds a test file adds it to the tree in `tests/TESTING.md`. Doc edits to specs and research files assume row 0 of the Order table has merged.
- **Commits:** Conventional Commits in the imperative. No trailers and no tool or AI attribution anywhere, in commits or PR bodies (AGENTS.md overrides any harness attribution reminder). Before each commit, show the owner a commit review report (files, diff summary, test output before and after, the message) and wait for an explicit yes. Task steps write this as `**Commit** (Global commit review): <message>`.
- **Branches and merging:** each PR on its own branch from `main`, never stacked. Before merge, rebase on the current `main` tip; merge only on green CI against that tip.

## Review Focus

The inputs and failure modes most likely to bite a person. Each is pinned by the named test in its owning task.

1. **Device storage during a save.**
   - A slow or failing read must never fall back to overwriting the stored copy: P1.1-1 "keeps the stored offline edits when the server state is saved", "keeps the late copy across later saves" and "keeps an unreadable copy and rejects the save".
   - An expired copy must not be revived (`OFFLINE_DOC_MAX_AGE_DAYS` stays below tombstone retention): P1.1-1 "replaces an expired copy instead of merging it".
   - Merging must not keep deleted content forever (why the merge uses a temporary `Y.Doc`, not `Y.mergeUpdates`): P1.1-1 "does not keep deleted text in the saved copy".
2. **Two tabs saving one document at once.** Neither tab's unsynced edits may be lost: P1.1b-1 "keeps both tabs' edits when their saves overlap"; P1.1b-2 "two tabs editing one document offline keep each other's edits".
3. **Stored values written by an older build, or by hand** (an identity colour outside the palette, an unknown theme, a blank or over-long name) repair to a valid value and never throw or break first paint: F2.1 "repairs a stored payload per field" and "regenerates a non-object, a non-string name and an over-long name"; F3-1 boot rows `tinydocy-theme="purple"` and "nothing, run once, then seed `tinydocy-user` and run again".
4. **Storage that is blocked or half works.** The boot script still follows the OS, `setTheme` applies for the session, and one identity holds per session: F3-1 throwing-storage row and "`setTheme("system")` with throwing storage"; F2.1 "survives blocked storage and keeps one identity per session" and "keeps one identity when only setItem throws (quota)".
5. **An OS change must not override an explicit theme choice:** F3-1 "`watchSystemTheme` with `"light"`"; F3-2 "⋯ › Appearance › System returns to following the OS".
6. **Shift and Caps Lock change `event.key` case.** Too loose binds ⌘⇧T, too strict drops ⌘T under Caps Lock: P1.2-2 matcher cases `"T"`, `"R"` and `{ key: "T", metaKey, shiftKey }`.
7. **Images.**
   - EXIF orientation and GPS: visible orientation and dimensions survive: A0.2 e2e "JPEG with orientation 6 and GPS".
   - Bytes outside the parsed structure (after `IEND`, past the RIFF size): A0.1 trailing-bytes assertion.
   - Declared type that does not match the bytes: A0.1 "declared PNG, bytes are JPEG"; A0.2 e2e "JPEG bytes labelled image/png" and "JPEG bytes labelled image/gif".
   - A PNG or WebP with an Exif rotation is re-encoded, not stripped: A0.1 "orientation 6 returns null".
8. **A tab restored after its 7 days, whether or not the purge has run,** is refused and never brings back a tombstoned name: W1.1 "restore past the window is gone" and "hides tombstoned names and refuses their restore"; W1.2 "restore of a close older than CLOSED_RETENTION_DAYS is gone before the purge runs".
9. **A store landing after the DELETE.** The closing session's debounced flush must persist, or Undo loses the last words: W1.4 "text typed just before closing survives Undo".
10. **Two visitors restoring at once** never duplicate the tab entry: W1.3 "a restore racing a remote restore leaves one entry".

## Calls made while planning (owner signs off before dispatch)

- **Offline (P1.1):** a save skips the merge when the stored copy is the binding's own last write (`{updatedAt, byteLength}`) and the binding hydrated; every other save merges.
- **P1.2 shortcuts:**
  - ⌘⇧S stays Strikethrough. Duplicate gets ⌘D later, in P2.8.
  - Playground regenerate loses its shortcut.
  - Subscript moves to ⌘⇧, on the desktop target only.
- **F5 owns the dark link colour.** Dark `--link-text-color` `#1a73e8` measures 4.39:1 on `--background` and 3.98:1 on `--card`. F5 raises it to `#5b9cf2` (7.05 and 6.39). F5 branches after F1 merges and extends F1's `tests/helpers/css-tokens.ts` and `token-contrast.test.ts`.
- **F5:** document links are already underlined (`paragraph-node.scss`, the LINKS block). F5 adds the regression test and the `0.15em` underline offset.
- **F3:** `readThemePreference` reads the in-memory session value first, so a choice made in this tab wins until reload. Any `tinydocy-*` localStorage key other than the theme key marks a returning browser (Light).
- **F2:** a remote name that cleans to `""` renders an empty label (y-tiptap already substitutes `User: <clientId>` for a missing name and skips non-string names), so there is no "Anonymous" text. F2.1 adds `lib/clean-text.ts`, which W1a reuses for closed-tab titles.
- **A0:** PNG and WebP metadata stripping lands now in `lib/assets/strip-metadata.ts`, with an allowlist of known chunks, so A1 reuses it. A PNG or WebP carrying an Exif rotation is re-encoded instead.
- **W1 split:** W1a (server, backward compatible, Deploy note) ships before W1b (UI).
- **W1 Undo:** the pill shows for 5 s, not the spec's 8 s, to match the app's existing Undo pills. It stays while hovered or focused.
- **W1 Recently closed** lives in the tab bar, not the editor's ⋯ menu. It is scoped to the tab list it was closed from, server-side, and anyone using that tab list can see and restore it.
- **W1 restore** is one batch route, `POST /api/documents/restore` with `ids` (one rate-limit unit), used by Undo, close-all Undo and Recently closed.
- **W1 takedowns:** closing no longer removes content. `scripts/delete-document.ts` deletes and tombstones at once.
- **W1 route names:** the static `closed` and `restore` segments shadow `[id]` for those two names. The client only creates UUIDs (`generateId`), so a document literally named `closed` or `restore` (reachable only over a hand-made socket) cannot be soft-closed. Accepted.

## Order and dependencies

| Order | PR | Notes |
|---|---|---|
| 0 | **docs** | `docs: add the desktop local-first specs, research and Phase 1 plans`, branch `docs/phase-1-planning`. Commits the untracked `docs/superpowers/specs/2026-11-15-*.md`, `docs/superpowers/specs/2026-11-16-*.md`, `docs/research/2026-11-15-*.md`, `docs/research/2026-11-16-*.md`, `docs/design/` and `docs/superpowers/plans/2026-11-16-phase-1-*.md`. Not `.claude/` or the root `deploy-*.md`. One CHANGELOG entry. Owner commit review, merged before any dispatch. |
| 1 | **P1.1** | First: it fixes a live data-loss path. |
| 2 | **P1.1b** | Branched from `main` after P1.1 merges. |
| Any time | P1.2, F1, F3, F2, A0 | Independent of each other. F3 lands before P2.9c-1, which replaces the boot script and folds F3's listener into `PrefsRuntime`. |
| After F1 | F5 | Extends F1's token helper and contrast test. |
| After F2 | W1a | Imports `cleanText` from F2. The only PR with a server Deploy note; ship it in its own deploy window. |
| After W1a | W1b | Calls W1a's routes. |

**Shared files between independent PRs.** `components/tab-bar/tab-bar.tsx` (P1.2, W1b), `components/document-editor/document-editor-config.ts` (P1.2, F2.3), the editor-chunk budget (P1.2, F2.3, A0.2, F3), and `CHANGELOG.md` and `tests/TESTING.md` (every PR). Rebase on the current `main` tip before merge and re-run the PR's checks.

---

## Part: Offline storage: P1.1 and P1.1b (web sandbox)

**Goal.** A saved offline copy is never replaced by a state that has not read it. Both PRs share one primitive: `LocalDocStore.save` merges into the stored copy instead of overwriting it. P1.1 adds the primitive. P1.1b makes it atomic across tabs.

**The bug, from the code.**
- When the read takes longer than `HYDRATE_TIMEOUT_MS` (1 s), `attachWithLocalCopy` (`lib/collab-session.ts`) destroys the first binding and rebinds with `hydrate: false`. The copy that arrives late is dropped.
- The new binding then saves after the server's sync update. `LocalDocStore.save` → `backend.put` (`lib/offline/local-doc-store.ts`) writes the server-only state over the stored copy, so the copy's unsynced offline edits are lost.
- P1.1b is the same overwrite between two tabs. Each tab's `put` replaces the other's copy.

**Decisions (both PRs).**
1. **Where the late copy goes.** Audit §7 step 1 says "apply the late copy". The spec's P1.1 row and the staff note say merge it into **storage**, never into the live doc, because that doc has already attached and AGENTS.md forbids applying after sync. The spec wins, and the test asserts the live doc does **not** contain the late copy's text. The edits reach the server on the next open, when hydration runs before attach.
2. **"Never save before the first read resolves"** is met by construction: every save reads the stored copy first, then merges and writes, in the same serialized step (and in P1.1b, the same transaction). The timeout and rebind path in `collab-session.ts` keeps its logic; only its comments change.
3. **How to merge.** Use a temporary `Y.Doc`, not `Y.mergeUpdates`. Measured with the repo's Yjs: after 10 KB is inserted and then deleted, `mergeUpdates` keeps the stored copy at 10,085 B for good, because it never garbage-collects. Applying both updates to a temporary doc and encoding it gives 85 B. Cost on a 1.3 MB state: about 36 ms per save, against 6 ms for today's encode. It is synchronous, so it is safe inside an IndexedDB `onsuccess`, and it runs once per debounced save (750 ms after the last change).
4. **Skip the merge for a binding's own copy.** When the stored copy carries the exact `{updatedAt, byteLength}` stamp this binding last wrote, and the binding hydrated (its doc holds everything the copy held), the save writes `update` without decoding anything. A `hydrate: false` binding never skips, because its doc lacks the late copy. This keeps the common save at today's cost.
5. **Two PRs.** P1.1b reuses P1.1's save path and `mergeIntoStored`; it alone changes the `DocStoreBackend` interface and the fixtures.

**Both PR bodies state:** no deploy note (client only); the stored format is unchanged, so no `OFFLINE_CACHE_EPOCH` bump and rollback is safe. Mixed versions: a tab still running a pre-P1.1 bundle, or service-worker-cached old chunks, keeps overwriting until it reloads. No visible UI, so no design review.

---

### PR P1.1: fix the hydrate overwrite

- **Branch:** `fix/offline-hydrate-overwrite`
- **PR title:** `fix(offline): merge saves into the stored copy instead of replacing it`
- **Lens:** SE
- **CHANGELOG:**
  ```markdown
  ### Offline copies keep unsynced edits after a slow read

  When the device copy took longer than 1 s to read, the next save replaced it with the server's state and edits made offline were lost. Saves now merge into the stored copy.

  #### Fixed
  - A copy read after the 1 s timeout stays on the device and opens on the next visit.
  ```

#### Task P1.1-1: Merge-on-save in `LocalDocStore`

**Files:**
- Modify `lib/offline/local-doc-store.ts`:
  - Add `WriteStamp` and `mergeIntoStored` after `isCurrent`.
  - `LocalDocStore.save`: doc comment becomes "Merges `update` into the stored copy, unless `name` was removed since `generation`."
  - `bindLocalCopy`: track `lastWrite`; its doc comment's "saves the compacted state" becomes "merges its state into the stored copy".
- Modify comments only in `lib/collab-session.ts`: the `HYDRATE_TIMEOUT_MS` comment, and the rebind comment in `attachWithLocalCopy` ("connect without the copy; saves merge into it, so its unsynced edits stay on the device and load on the next open").
- Test `tests/unit/lib/collab-session-offline.test.ts`: a describe block after "offline copy removed while the session hydrates". Reuse `slowReadBackend`, `receive`, `storedText`, `settle`, `unique`, `FakeProvider`, `HOST` and `NOW`.
- Test `tests/unit/lib/offline/local-doc-store.test.ts`: a `describe("merge on save")` block. Reuse `makeStore`, `yState`, `textOf`, `DAY` and `tick`.

**Interfaces:**
- Produces:
  - `export type WriteStamp = { updatedAt: number; byteLength: number }` (the shape `deleteIfUnchanged` already takes; reuse `isUnchanged`).
  - `export function mergeIntoStored(stored: StoredDoc | undefined, update: Uint8Array, now: number, lastWrite?: WriteStamp): Uint8Array`:
    - returns `update` itself when `stored` is undefined, `!isCurrent(stored, now)`, or `lastWrite && isUnchanged(stored, lastWrite)`;
    - otherwise applies `stored.update` and then `update` to a `new Y.Doc()`, returns `Y.encodeStateAsUpdate` of it, and destroys the doc;
    - throws if either update does not decode.
- Changes `LocalDocStore.save(name, update, generation?, lastWrite?): Promise<WriteStamp | undefined>`. Inside `serialize`:
  1. Run the generation check (return `undefined` when dropped).
  2. `const now = this.now()`; `stored = await this.backend.get(key)`.
  3. `merged = mergeIntoStored(stored, update, now, lastWrite)`; `backend.put({ key, name, update: merged, updatedAt: now })`.
  4. Resolve `{ updatedAt: now, byteLength: merged.byteLength }`.
  - A failed read or merge rejects the save and never falls back to a plain `put`. `bindLocalCopy` already turns a rejected save into `disabled`.
- Changes `bindLocalCopy`: a `lastWrite: WriteStamp | undefined` set from each save's result, and passed to the next save only when `hydrate` was true and the load resolved without error. `migrate` passes it too.
- Consumes `backend.get` and `backend.put`; the interface is unchanged in this PR.

- [ ] **Step 1: Write the failing session tests.** Add to `collab-session-offline.test.ts`:
  ```ts
  /** A stored offline edit, a 1.5 s read, and a server update after the 1 s timeout. */
  async function saveDuringSlowRead() {
    const { backend, memory, open } = slowReadBackend();
    const name = unique();
    const seed = new Y.Doc();
    seed.getText("t").insert(0, "typed offline earlier");
    await new offline.LocalDocStore(memory, HOST, NOW).save(name, Y.encodeStateAsUpdate(seed));
    store = new offline.LocalDocStore(backend, HOST, NOW);
    vi.useFakeTimers();
    const session = acquireCollabSession(name);
    const provider = created.at(-1) as FakeProvider;
    await settle();
    vi.advanceTimersByTime(1000); // HYDRATE_TIMEOUT_MS
    expect(provider.attach).toHaveBeenCalledOnce();
    await settle(); // the rebound binding subscribes to updates
    receive(session, provider, "from server");
    vi.advanceTimersByTime(500); // the read finishes at 1.5 s
    open();
    await settle();
    vi.advanceTimersByTime(250); // the 750 ms save debounce
    await settle();
    return { memory, name, provider, session };
  }

  describe("offline copy read slower than the hydrate timeout", () => {
    it("keeps the stored offline edits when the server state is saved", async () => {
      const { memory, name, session } = await saveDuringSlowRead();
      const text = await storedText(memory, name);
      expect(text).toContain("typed offline earlier");
      expect(text).toContain("from server");
      // Merged into storage, never into the live (already attached) doc.
      expect(session.doc.getText("t").toString()).toBe("from server");
      expect(session.hasLocalCopy).toBe(false);
    });

    it("keeps the late copy across later saves", async () => {
      // The rebound binding did not hydrate, so it must never skip the merge.
      const { memory, name, provider, session } = await saveDuringSlowRead();
      receive(session, provider, " and more");
      vi.advanceTimersByTime(750);
      await settle();
      const text = await storedText(memory, name);
      expect(text).toContain("typed offline earlier");
      expect(text).toContain("and more");
    });

    it("opens the kept edits on the next visit", async () => {
      const { memory, name } = await saveDuringSlowRead();
      releaseCollabSession(name);
      vi.advanceTimersByTime(1001);
      await settle();
      expect(liveSessionNames().has(name)).toBe(false);
      store = new offline.LocalDocStore(memory, HOST, NOW); // a fast read this time
      const reopened = acquireCollabSession(name);
      await settle();
      expect((created.at(-1) as FakeProvider).attach).toHaveBeenCalledOnce();
      expect(reopened.doc.getText("t").toString()).toContain("typed offline earlier");
      expect(reopened.hasLocalCopy).toBe(true);
    });
  });
  ```
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/lib/collab-session-offline.test.ts`. Expected: the three new tests fail with `expect(received).toContain(expected)`, expected `"typed offline earlier"`. This is the spec's exit evidence that the tests fail on `main`; paste the output into the PR.
- [ ] **Step 3: Write the store tests.** Add under `describe("merge on save")` in `local-doc-store.test.ts` (import `mergeIntoStored`):
  ```ts
  it("merges a save into the stored copy", async () => {
    const { store } = makeStore();
    await store.save("a", yState("stored offline"));
    await store.save("a", yState("server state"));
    const text = textOf((await store.load("a"))?.current ?? undefined);
    expect(text).toContain("stored offline");
    expect(text).toContain("server state");
  });
  it("replaces an expired copy instead of merging it", async () => {
    let now = 0;
    const { store } = makeStore(() => now);
    await store.save("a", yState("expired"));
    now = (OFFLINE_DOC_MAX_AGE_DAYS + 1) * DAY;
    await store.save("a", yState("fresh"));
    now += 1;
    expect(textOf((await store.load("a"))?.current ?? undefined)).toBe("fresh");
  });
  it("keeps an unreadable copy and rejects the save", async () => {
    const { backend, store } = makeStore();
    const key = storeKey("ws.example", "a");
    await backend.put({ key, name: "a", update: Uint8Array.from([255, 255, 255]), updatedAt: 1_000_000 });
    await expect(store.save("a", yState("new"))).rejects.toThrow();
    expect((await backend.get(key))?.update).toEqual(Uint8Array.from([255, 255, 255]));
  });
  it("does not keep deleted text in the saved copy", async () => {
    const { backend, store } = makeStore();
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "base");
    await store.save("a", Y.encodeStateAsUpdate(doc));
    doc.getText("t").insert(4, "x".repeat(10_000));
    await store.save("a", Y.encodeStateAsUpdate(doc));
    doc.getText("t").delete(4, 10_000);
    for (let i = 0; i < 3; i++) await store.save("a", Y.encodeStateAsUpdate(doc));
    expect((await backend.get(storeKey("ws.example", "a")))?.update.byteLength).toBeLessThan(200);
  });
  it("returns the update untouched when the stamp matches", () => {
    const stored = { key: storeKey("ws.example", "a"), name: "a", update: Uint8Array.from([255, 255, 255]), updatedAt: 1_000_000 };
    const update = yState("next");
    // Undecodable bytes: only a skipped merge can succeed.
    expect(mergeIntoStored(stored, update, 1_000_001, { updatedAt: 1_000_000, byteLength: 3 })).toBe(update);
    expect(() => mergeIntoStored(stored, update, 1_000_001, { updatedAt: 999, byteLength: 3 })).toThrow();
  });
  it("skips the merge when the stored copy is the binding's own last write", async () => {
    const backend = createMemoryBackend();
    const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
    const doc = new Y.Doc();
    const binding = bindLocalCopy(doc, "a", store, { debounceMs: 5 });
    await binding.hydrated;
    doc.getText("t").insert(0, "first");
    await binding.flush();
    const key = storeKey("ws.example", "a");
    const own = (await backend.get(key))!;
    // Same stamp, undecodable bytes: a merge would throw and disable the binding.
    await backend.put({ ...own, update: new Uint8Array(own.update.byteLength).fill(255) });
    doc.getText("t").insert(0, "second ");
    await binding.flush();
    expect(textOf((await backend.get(key))?.update)).toBe("second first");
    binding.destroy();
  });
  ```
- [ ] **Step 4: Run them and watch them fail.** `bun test tests/unit/lib/offline/local-doc-store.test.ts`. Expected: "merges a save" fails (expected to contain `"stored offline"`), "keeps an unreadable copy" fails (resolved instead of rejecting), and both stamp tests fail (`mergeIntoStored` is not exported). The expired and deleted-text tests pass on `main` and guard the implementation choice; a `Y.mergeUpdates` implementation fails "does not keep deleted text" with 10,0xx B.
- [ ] **Step 5: Implement** the Interfaces above. Edit only the comments in `collab-session.ts`. Do not add an option to `bindLocalCopy`.
- [ ] **Step 6: Run the tests and watch them pass.**
  - `bun test tests/unit/lib/collab-session-offline.test.ts tests/unit/lib/offline/local-doc-store.test.ts`: all pass. The existing `gatedBackend` and `slowReadBackend` fixtures need no change, because `save` still ends in `put`.
  - Then `bun run test`, `bun run typecheck`, `bun run check` and `bun run lint`.
- [ ] **Step 7: Measure one worst-case save (not committed).** Target: ≤ 50 ms per merge on a 2 MiB state on desktop; report the 4× throttled number too. Over the target, stop and report to the owner before opening the PR.
  - Write a scratch `.tmp/merge-cost.ts` that builds a 2 MiB state (a `Y.Doc` with 2,000 `paragraph` `Y.XmlElement`s of 1 KiB text each, so it has many structs), and a second update touching 50 of them, then sets `window.__mergeCost = () => median of 5 timed mergeIntoStored(stored, update, now) calls`.
  - `bun build .tmp/merge-cost.ts --target=browser --outfile=.tmp/merge-cost.js`.
  - In a scratch Playwright script, open `about:blank`, `page.addScriptTag({ path: ".tmp/merge-cost.js" })` and read `window.__mergeCost()` at CDP `Emulation.setCPUThrottlingRate` rate 1 and rate 4 (the CDP pattern in `tests/e2e/performance.spec.ts`).
  - Put both medians in the PR body. Delete `.tmp/merge-cost.*`.
- [ ] **Step 8: Run e2e.** On this PR's dev servers, the CI e2e command: all green (the `perf` project guards typing latency). Then, on a production build, the `pwa` project once: all green.
- [ ] **Step 9: CHANGELOG.** Add the entry above.
- [ ] **Step 10: Commit** (Global commit review): `fix(offline): merge saves into the stored copy instead of replacing it`

---

### PR P1.1b: two tabs editing one document offline keep each other's edits

- **Branch:** `fix/offline-two-tab-merge` (from `main` after P1.1 merges)
- **PR title:** `fix(offline): merge each save in one IndexedDB transaction`
- **Lens:** SE
- **CHANGELOG:**
  ```markdown
  ### Two tabs editing one document offline keep each other's edits

  Each save now reads, merges and writes the device copy in one IndexedDB transaction.

  #### Fixed
  - A second tab's save no longer drops the first tab's offline edits.
  ```

#### Task P1.1b-1: Atomic read-merge-write in the backend

**Files:**
- Modify `lib/offline/local-doc-store.ts`: `DocStoreBackend`, `save` (P1.1's version), `createIndexedDbBackend` and `createMemoryBackend`.
- Fixtures to update, because saves no longer call `put`:
  - `tests/unit/lib/offline/local-doc-store.test.ts`: the failing literal backend (add a `putMerged` that throws `quota`); "keeps the legacy copy when the save fails" (throw from `putMerged` for `~s2:` keys); `gatedBackend` (gate `putMerged` instead of `put`).
  - `tests/unit/lib/collab-session-offline.test.ts`: `gatedBackend` gates `putMerged`.
  - `tests/fixtures/legacy-local-doc-store.ts` keeps `put`. Pre-N bundles never merge.
- Test: a new `describe("two tabs saving one document")` in `local-doc-store.test.ts`.

**Interfaces:**
- Consumes P1.1's `mergeIntoStored` and `WriteStamp`.
- Produces `DocStoreBackend.putMerged(doc: Omit<StoredDoc, "update">, merge: (stored: StoredDoc | undefined) => Uint8Array): Promise<void>`. It writes `{ ...doc, update: merge(stored) }` under `doc.key`, read and written with no other writer in between. `merge` is synchronous. If `merge` throws, nothing is written and the promise rejects **with that error**.
  - **IndexedDB:** through `commit`, run `s.get(doc.key)`. In `onsuccess`, inside `try`, call `s.put(...)`; in `catch`, keep the error in a local and call `s.transaction.abort()`. Chain `.catch((e) => Promise.reject(mergeError ?? e))`: on an explicit abort `tx.error` is null and `commit` would otherwise reject with a generic "transaction aborted". No `await` between the get and the put.
  - **Memory:** one synchronous `docs.get` and `docs.set` in the async function.
- Changes: `save` calls `backend.putMerged({ key, name, updatedAt: now }, (stored) => (merged = mergeIntoStored(stored, update, now, lastWrite)))` and resolves the stamp from `merged`. It no longer calls `get` or `put`. `put` stays on the interface for the legacy fixture and test seeding.

- [ ] **Step 1: Write the failing tests** (`tick` is the file's existing helper):
  ```ts
  describe("two tabs saving one document", () => {
    it("keeps both tabs' edits when their saves overlap", async () => {
      const memory = createMemoryBackend();
      // Reads yield, so two tabs' read-then-write steps interleave.
      const backend: DocStoreBackend = { ...memory, get: async (key) => { await tick(); return memory.get(key); } };
      const tabA = new LocalDocStore(backend, "ws.example", () => 1_000_000);
      const tabB = new LocalDocStore(backend, "ws.example", () => 1_000_000);
      await Promise.all([tabA.save("a", yState("from tab A")), tabB.save("a", yState("from tab B"))]);
      const text = textOf((await memory.get(storeKey("ws.example", "a")))?.update);
      expect(text).toContain("from tab A");
      expect(text).toContain("from tab B");
    });
    it("keeps both tabs' offline edits through their bindings", async () => {
      const backend = createMemoryBackend();
      const tabs = ["A", "B"].map((label) => {
        const store = new LocalDocStore(backend, "ws.example", () => 1_000_000);
        const doc = new Y.Doc();
        return { label, doc, binding: bindLocalCopy(doc, "a", store, { debounceMs: 5 }) };
      });
      for (const tab of tabs) await tab.binding.hydrated;
      // Neither tab reads the other's copy: each only saves.
      for (const tab of tabs) {
        tab.doc.getText("t").insert(0, `typed in tab ${tab.label} `);
        await tab.binding.flush();
      }
      const text = textOf((await backend.get(storeKey("ws.example", "a")))?.update);
      expect(text).toContain("typed in tab A");
      expect(text).toContain("typed in tab B");
      for (const tab of tabs) tab.binding.destroy();
    });
  });
  ```
- [ ] **Step 2: Run them and watch the first fail.** `bun test tests/unit/lib/offline/local-doc-store.test.ts`. Expected: the first test fails on P1.1's code, expected to contain `"from tab A"`: both reads finish before either write, so the later write drops the other tab's edit. The second (sequential saves) already passes after P1.1; it is the user-level regression guard.
- [ ] **Step 3: Implement** `putMerged` in both backends and switch `save` to it, as given under Interfaces. Update the fixtures listed under Files.
- [ ] **Step 4: Run the tests and watch them pass.** `bun test tests/unit/lib/offline/local-doc-store.test.ts tests/unit/lib/collab-session-offline.test.ts`: all pass; the removal-ordering tests prove the gates still hold saves. Then `bun run test`, `bun run typecheck`, `bun run check` and `bun run lint`.
- [ ] **Step 5: CHANGELOG.** Add the entry above.
- [ ] **Step 6: Commit** (Global commit review): `fix(offline): merge each save in one IndexedDB transaction`

#### Task P1.1b-2: Two-page e2e on real IndexedDB

Covers `putMerged` on real IndexedDB (no `fake-indexeddb` is installed; W2 adds it). The saves here are sequential. Atomicity is shown by the unit test with the yielding `get` and by the IndexedDB code having no await between the get and the put. Do not try to force an IndexedDB race in a browser.

**Files:**
- Modify `tests/e2e/offline-copies.spec.ts`: one test in `test.describe("offline copies")`. Reuse `CollabSocket`, `openDoc`, `waitForCopy`, `EditorPage` and `typeInNewParagraphAtEnd`.

**Interfaces:** consumes the existing helpers only.

- [ ] **Step 1: Write the test** `"two tabs editing one document offline keep each other's edits"`:
  1. One `context`, pages A and B, each with its own `CollabSocket` installed before `goto`.
  2. `docId = await openDoc(pageA, socketA)`. In B, install the socket, `new EditorPage(pageB).goto(docId)` and wait for sync, then `await waitForCopy(pageA, docId)`.
  3. `await socketA.cut()` and `await socketB.cut()`.
  4. In A, type `"tab-a-marker"` and `waitForTimeout(1500)`. In B, type `"tab-b-marker"` and `waitForTimeout(1500)`.
  5. Accept dialogs on both pages and `pageA.reload()`, as "edits made while disconnected survive a reload and sync on reconnect" does (`useSyncedTabs` only bootstraps after a server sync, so a fresh page could not open the doc).
  6. Assert `expect(pageA.locator(".tiptap")).toContainText("tab-a-marker", { timeout: 15_000 })`, and the same for `"tab-b-marker"`.
  7. Close the context.
- [ ] **Step 2: Run the full e2e suite.** The CI e2e command on this PR's dev servers: all green. Then the `pwa` project once on a production build.
- [ ] **Step 3: Commit** (Global commit review): `test(offline): cover two tabs editing one document offline`

---

## Part: Shortcut clashes (P1.2) and the theme fixes (F1, F3, F5)

- P1.2 changes keymaps (`lib/`, `components/tab-bar/`).
- F1 changes `globals.css` tokens and three class names.
- F3 changes `lib/theme.ts`, the boot script and the theme controls.
- F5 changes editor SCSS (link underline and dark link colour), after F1.

**Findings that change the spec's premise. Read these first.**
1. **⌘⇧R clash.** `handleKeyboard` in `components/tab-bar/tab-bar.tsx` regenerates the Playground on `mod && e.shiftKey && e.key === "r"` through a `window` listener, while `TextAlign` binds `Mod-Shift-r` (`lib/editor-actions/core/blocks.ts`). Where the browser reports a lowercase `"r"` with Shift held, one press on the Playground does both, and the branch's `preventDefault()` blocks the browser's hard reload on every tab. Playwright sends `"R"`, so e2e cannot reproduce the double action.
2. **⌘⇧S.** In code, only Strike binds `Mod-Shift-s`. The clash is with the HIG's Duplicate (⇧⌘S), which does not exist yet. UX §4.6 already gives Duplicate ⌘D (owner P2.8), so P1.2 pins Strike with a test instead of rebinding.
3. **Palette "Switch theme" does nothing.** `view.theme` emits `theme.toggle` (`lib/editor-actions/core/slot.ts`), and no handler exists: the UI-intent switch in `document-editor.tsx` handles only toolbar, outline and filter. F3 wires it.
4. **F5's premise is stale.** `paragraph-node.scss` already sets `.tiptap.ProseMirror a { text-decoration: underline }` (the LINKS block), and has since `init`. The hyperlink package's `text-decoration: none` targets only `.hyperlink-preview-popover a` and `.hyperlink-hovercard__title`. F5 proves this and shrinks to the offset and the dark link colour.

---

### PR P1.2: shortcut clashes

- **Branch:** `fix/shortcut-clashes`
- **PR title:** `fix(shortcuts): stop ⌘⇧R regenerating the Playground and key Subscript by build target`
- **Lens:** UX
- **Deploy:** none.
- **Design review:** the Regenerate tooltip before and after (label-only: 1440 px, light and dark).
- **CHANGELOG:**
  ```markdown
  ### Shortcut clashes

  ⌘⇧R only aligns right, also on the Playground, and outside the editor it reloads the page again.

  #### Fixed
  - Regenerate is the Playground tab's button only; its tooltip no longer shows ⌘⇧R.

  #### Changed
  - Desktop builds (`NEXT_PUBLIC_APP_TARGET=desktop`) bind Subscript to ⌘⇧, so that ⌘, can open Settings. The web keeps ⌘,; Strikethrough keeps ⌘⇧S.
  ```

**Decisions:**
- Playground regenerate gets **no key**. §4.6 lists none, the file-manager research proposes button or menu only, and the onboarding design says Reset is menu-only on desktop.
- Strike keeps `Mod-Shift-s`. Duplicate takes `Mod-d` in P2.8; this PR only asserts `Mod-d` is still unbound in the editor.
- **Subscript is keyed by target now; the web is unchanged.** One module-level literal, `process.env.NEXT_PUBLIC_APP_TARGET === "desktop"`, chooses `"Mod-Shift-,"` or `"Mod-,"`. The architecture spec already names the flag and P2.2 requires a literal comparison; web builds leave it unset; the desktop branch is testable today with `importFresh`, which closes C1's "untested ordering" risk now. Binding ⌘, to Settings stays with P2.9a/P2.9b.
- **Binding rules the test enforces.** Every advertised action shortcut is bound at least once. Every combo is bound exactly once, except those in `CHAINED = new Set(["Tab", "Shift-Tab"])` (chained by design across list, table and indent extensions); a `Mod-` combo may never join `CHAINED`, and any other addition needs a one-line reason. Actions bound outside the editor keymap are listed with their binder:
  ```ts
  const BOUND_OUTSIDE_EDITOR = {
    "palette.open": "components/smart-toolbar/palette/palette-store.ts", // window capture keydown, Alt-/
    "history.undo": "Collaboration (filtered: collaborationRenderOnce)",
    "history.redo": "Collaboration (filtered: collaborationRenderOnce)",
  } as const;
  ```

#### Task P1.2-1: app shortcut table and the duplicate-binding test

**Files:**
- Create `lib/app-shortcuts.ts`.
- Create `tests/helpers/editor-keymap.ts`.
- Create `tests/unit/editor-actions/shortcut-bindings.test.ts`.
- Modify `lib/editor-actions/core/inline.ts`: the `mark.subscript` action's `shortcut` becomes `SUBSCRIPT_SHORTCUT`.
- Modify `components/document-editor/document-editor-config.ts`: replace the `Subscript` import and list entry with `SubscriptByTarget`.

**Interfaces.** Produces:
- `SUBSCRIPT_SHORTCUT: KeyCombo`: `"Mod-Shift-,"` when `process.env.NEXT_PUBLIC_APP_TARGET === "desktop"`, else `"Mod-,"`.
- `SETTINGS_SHORTCUT: KeyCombo = "Mod-,"`. Desktop only; P2.9a/P2.9b bind it.
- `TAB_BAR_SHORTCUTS: Readonly<Record<TabBarCommand, KeyCombo>>`, `TabBarCommand = "newTab" | "closeTab" | "previousTab" | "nextTab"`, values `"Mod-t"`, `"Mod-w"`, `"Mod-Shift-["`, `"Mod-Shift-]"`.
- `matchTabBarShortcut(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): TabBarCommand | null`. Compares the key case-insensitively, and requires Shift to match the combo exactly (so ⌘⇧T is never `newTab`). `[` and `]` with Shift also match `{` and `}`, as today.
- `SubscriptByTarget = Subscript.extend({ addKeyboardShortcuts() { return { [SUBSCRIPT_SHORTCUT]: () => this.editor.commands.toggleSubscript() } } })`, in `document-editor-config.ts`. `extend` replaces the parent's `Mod-,`.
- Test helper `collectEditorKeys(extensions: Extensions): Map<string, string[]>`: normalized combo → names of the extensions binding it. It builds an `Editor` and, for each entry in `editor.extensionManager.extensions`, calls `getExtensionField(ext, "addKeyboardShortcuts", { name, options, storage: editor.extensionStorage[name], editor, type: getSchemaTypeByName(name, editor.schema) })`, the context `ExtensionManager` builds. Tiptap's core `keymap` extension is counted too; none of its combos (`Mod-Enter`, `Mod-Backspace`, `Mod-Delete`, `Mod-a`) is advertised today.
- Test helper `normalizeCombo(combo: string): string`: orders modifiers Mod, Ctrl, Alt, Shift, Meta (so Collaboration's `Shift-Mod-z` reads `Mod-Shift-z`) and lowercases a one-character key.

- [ ] **Step 1: Write the failing test** in `shortcut-bindings.test.ts`:
  - Build the extensions with `buildDocumentEditorExtensions({ documentId: "keys", ydoc: new Y.Doc(), provider: {} as HocuspocusProvider, onFoldChange(){}, onFilterChange(){}, onTocUpdate(){} })` and filter out names starting with `collaboration`, as `document-editor-markdown.test.ts` does.
  - Add `TAB_BAR_SHORTCUTS` first with today's fifth entry, `regenerate: "Mod-Shift-r"`, so the overlap test fails for the real reason.
  ```ts
  it("binds every advertised shortcut, and each one once unless chained", …)
    // for each editorActions.list() action with a shortcut, skipping BOUND_OUTSIDE_EDITOR ids:
    //   const bound = keys.get(normalizeCombo(shortcut)) ?? [];
    //   expect(bound.length).toBeGreaterThan(0);
    //   if (!CHAINED.has(normalizeCombo(shortcut))) expect(bound).toHaveLength(1);
  it("never exempts a Mod- combo", …)
    // [...CHAINED].every((c) => !c.startsWith("Mod-"))
  it("keeps the tab bar's keys out of the editor keymap", …)
    // for each TAB_BAR_SHORTCUTS value: keys.has(normalizeCombo(v)) === false
  it("keeps Strike on Mod-Shift-s and leaves Mod-d free for Duplicate (P2.8)", …)
    // keys.get("Mod-Shift-s") toEqual(["strike"]); keys.has("Mod-d") === false
  it("web: Subscript is Mod-, (unchanged)", …)
    // action("mark.subscript").shortcut === "Mod-,"; keys.get("Mod-,") toEqual(["subscript"])
  it("desktop: Subscript moves to Mod-Shift-, and Mod-, is free for Settings", async …)
    // process.env.NEXT_PUBLIC_APP_TARGET = "desktop"; importFresh both modules;
    // shortcut === "Mod-Shift-,"; keys.get("Mod-Shift-,") toEqual(["subscript"]);
    // keys.has(SETTINGS_SHORTCUT) === false
  // afterEach: delete the env var; resetModules()
  ```
  - Do not repeat the action-vs-action uniqueness check; it exists in `tests/unit/editor-actions/contract.test.ts`.
- [ ] **Step 2: Run it and watch it fail.** `bun test tests/unit/editor-actions/shortcut-bindings.test.ts`. Expected failures: the tab-bar test (`Mod-Shift-r` bound by `textAlign`) and the desktop test (`SUBSCRIPT_SHORTCUT` is still `Mod-,`). If the binding test fails on another combo, fix the cause or add it to `CHAINED` or `BOUND_OUTSIDE_EDITOR` with its reason, per Decisions.
- [ ] **Step 3: Implement.** Drop `regenerate` from `TAB_BAR_SHORTCUTS`; add the target literal to `SUBSCRIPT_SHORTCUT`; add `SubscriptByTarget` and the `inline.ts` change.
- [ ] **Step 4: Run and watch it pass.** `bun test tests/unit/editor-actions/`: all green. The #612 test in `core-actions.test.ts` still passes, because it presses the advertised combo.
- [ ] **Step 5: Commit** (Global commit review), two commits: `test(shortcuts): fail on a key bound twice across the editor and tab bar`, then `feat(shortcuts): key Subscript by build target`.

#### Task P1.2-2: tab bar uses the table, and regenerate loses its key

**Files:**
- Modify `components/tab-bar/tab-bar.tsx`: `handleKeyboard` switches on `matchTabBarShortcut(e)` and the Mod+Shift+R branch is deleted; the Regenerate button's `aria-label` and `title` become `"Regenerate content"`.
- Test: `tests/unit/editor-actions/shortcut-bindings.test.ts`, `tests/e2e/tabs.spec.ts`.
- Modify `docs/superpowers/specs/2026-11-15-desktop-ux-design.md` §4.6 and `tests/TESTING.md`.

- [ ] **Step 1: Write the tests.**
  - Unit, `matchTabBarShortcut`:
    - `{ key: "T", ctrlKey: true }` returns `"newTab"` (Caps Lock).
    - `{ key: "{", metaKey: true, shiftKey: true }` returns `"previousTab"`.
    - `{ key: "T", metaKey: true, shiftKey: true }` returns `null` (never take ⌘⇧T, the browser's reopen-tab).
    - `{ key: "R", ctrlKey: true, shiftKey: true }` and `{ key: "r", metaKey: true, shiftKey: true }` return `null`.
  - e2e, `tabs.spec.ts`, `"Mod+Shift+R on the Playground aligns right and keeps the content"`:
    - Open the Playground and put the caret in a paragraph.
    - Save `JSON.stringify(getEditorJSON())` with `textAlign` stripped.
    - Press `ControlOrMeta+Shift+KeyR`, then wait 1 s, as the regenerate test does.
    - Expect the paragraph's `textAlign` to be `"right"`, the stripped JSON unchanged, and the regenerate button's accessible name `"Regenerate content"`.
- [ ] **Step 2: Run them and watch the label fail.**
  - `bun test tests/unit/editor-actions/shortcut-bindings.test.ts`: the matcher cases pass (the matcher exists from P1.2-1); they pin the lowercase-`"r"` regenerate path that e2e cannot reach.
  - `bun playwright test --project=chromium tests/e2e/tabs.spec.ts` on this PR's dev servers. Expected: only the label assertion fails (the name still contains "(⌘⇧R)"). Playwright sends `key: "R"` with Shift, which the tab bar's `e.key === "r"` never matched, so the align and JSON assertions already pass on `main`.
- [ ] **Step 3: Implement** the `tab-bar.tsx` changes listed under Files.
- [ ] **Step 4: Run them and watch them pass.** The same two commands, then `bun playwright test --project=chromium tests/e2e/toolbar-row.spec.ts`; its align tests stay green. Then the editor-chunk check.
- [ ] **Step 5: Check in the app** on this PR's dev servers: on the Playground ⌘⇧R aligns right and the content stays; with the tab bar focused ⌘⇧R reloads the page. Take the tooltip screenshots.
- [ ] **Step 6: Docs and CHANGELOG.**
  - Add the CHANGELOG entry above and the new test file to `tests/TESTING.md`.
  - UX spec §4.6: drop both "(P1.2 pending…)" notes from the editor-keys paragraph, and change the Settings row's last cell from "P1.2 (proposed)" to "P1.2 (Subscript key); binding P2.9a".
  - Run `bun run check && bun run lint && bun run typecheck && bun run test`.
- [ ] **Step 7: Commit** (Global commit review): `fix(tabs): drop the ⌘⇧R regenerate key that also aligned right`

---

### PR F1: dark `--primary` text contrast

- **Branch:** `fix/dark-primary-ink`
- **PR title:** `fix(theme): readable primary-coloured text in dark mode`
- **Lens:** UX
- **Deploy:** none.
- **Design review:** dark mode, before and after, of the heading filter's ALL button (`heading-filter.tsx`) and the link button in `components/smart-toolbar/palette/save-format-form.tsx` (the only link-variant consumer).
- **CHANGELOG:**
  ```markdown
  ### Dark primary text contrast

  In dark mode, primary-coloured text and borders (the heading filter's ALL button and link-style buttons) use a new `--primary-ink` token.

  #### Fixed
  - Dark primary text reads at 9.2:1 on the page instead of 2.8:1. Light mode and filled primary buttons are unchanged.
  ```

#### Task F1-1: `--primary-ink` and the token contrast test

**Files:**
- Create `tests/helpers/css-tokens.ts`.
- Create `tests/unit/lib/token-contrast.test.ts`.
- Modify `app/globals.css`: `:root` adds `--primary-ink: var(--primary);`; `.dark` adds `--primary-ink: oklch(0.769 0.188 70.08);`; `@theme inline` adds `--color-primary-ink: var(--primary-ink);`.
- Modify `components/ui/button.tsx` and `components/ui/badge.tsx`: the `link` variant uses `text-primary-ink`.
- Modify `components/tiptap-ui/heading-filter/heading-filter.tsx`: the ALL button's `"text-primary border-primary"` becomes `"text-primary-ink border-primary-ink"`.

**Interfaces.** Produces test helpers (F5 extends this file):
- `readThemeTokens(theme: "light" | "dark"): Record<string, string>`: parses `app/globals.css` (`:root`, then `.dark` overriding it) and resolves `var(--x)` chains.
- `oklchToHex(value: string): string`: OKLab matrices, then sRGB gamma, clamp and round.
- The ratio comes from the existing `contrastRatio` in `lib/text-style-contrast.ts`.

- [ ] **Step 1: Write the failing test.**
  ```ts
  const SURFACES = ["background","card","popover","sidebar","muted","secondary"];
  it.each(["light","dark"])("--primary-ink ≥ 4.5:1 on every surface (%s)", …)
  it("fixes the measured dark bug", …) // dark: ink on background > 9; --primary on background < 3 (documents why fills keep --primary)
  it("leaves light unchanged", …)      // light: --primary-ink resolves to the same hex as --primary (#bb4d00)
  it("never uses --primary as text or border colour", …)
    // scan components/**/*.tsx and app/**/*.tsx for /\b(text|border)-primary(?![-\w])/ → no hits
  ```
  - Expected from the tokens: dark ink 9.27 on background and 6.98 on secondary; light primary 4.58 on secondary, the tightest surface.
  - "Both contrast sets" waits for P2.9c-1's high-contrast set; leave that loop for it to extend.
- [ ] **Step 2: Run it and watch it fail.** `bun test tests/unit/lib/token-contrast.test.ts`. Expected: "--primary-ink not defined", and the scan finds `button.tsx`, `badge.tsx` and `heading-filter.tsx`.
- [ ] **Step 3: Implement** the CSS and class changes listed under Files.
- [ ] **Step 4: Run it and watch it pass.** The same command, then `bun run check && bun run typecheck && bun run test`.
- [ ] **Step 5: Check in the app** on this PR's dev servers, in dark mode: the filter bar's ALL button (two filters, then ALL) is orange (`#fe9a00`) and readable; ⋯ › Save format shows the link button; light mode is unchanged. Take the design-review screenshots.
- [ ] **Step 6: Docs.** Add the CHANGELOG entry and the new test file to `tests/TESTING.md`.
- [ ] **Step 7: Commit** (Global commit review): `fix(theme): add --primary-ink for primary-coloured text in dark mode`

---

### PR F3: System theme on the web

- **Branch:** `feat/system-theme`
- **PR title:** `feat(theme): follow the system colour scheme on the web`
- **Lens:** UX
- **Deploy:** none; no env change. The boot script grows by about 0.4 KB per HTML response. CSP needs no change (`script-src` already has `'unsafe-inline'`). Rollback is safe: the old boot script reads a stored `"system"` as light.
- **Design review:** ⋯ › Appearance open; a new visitor with the OS set to dark, on `/about` and `/`; the row button while System is on.
- **CHANGELOG:**
  ```markdown
  ### System theme

  New browsers follow the system's light or dark setting, from the first paint and live as it changes.

  #### Added
  - ⋯ › Appearance offers System, Light and Dark. The row button still switches between light and dark.

  #### Fixed
  - The palette's Switch theme works.

  #### Changed
  - Browsers that used TinyDocy before keep Light (written once on the next load) or the Dark they chose.
  ```

**Decisions:**
- **Where System is chosen before W13:** a ⋯ "Appearance" submenu (`DropdownMenuSub` with `DropdownMenuRadioGroup`: System, Light, Dark), at every width. It replaces `ThemeMenuItem` and the `rowThemeHidden` probe (`overflow-menu.tsx`). The row button and the phone Aa sheet still flip between Light and Dark, as the spec says.
- **The listener is a leaf mounted in the root layout,** so it also runs on `/about`; P2.9c-1 merges it into `PrefsRuntime`. It is never in the editor shell.
- **Invalid stored values** are treated as missing: the boot script resolves the §5.6 fallback and writes it.
- **The boot string stays out of the editor chunk:** it moves to `lib/theme-boot.ts`, imported only by `app/layout.tsx` (`lib/theme.ts` is imported by `theme-toggle.tsx` in the editor chunk).

#### Task F3-1: theme model, shared `setTheme()` and the boot script

**Files:**
- Modify `lib/theme.ts`, the whole file.
- Create `lib/theme-boot.ts`; modify `app/layout.tsx` to import `THEME_BOOT_SCRIPT` from it.
- Create `tests/unit/lib/theme.test.ts`.

**Interfaces.** Produces, in `lib/theme.ts`:
- `type ThemePreference = "system" | "light" | "dark"`; `THEME_PREFERENCES: readonly ThemePreference[]`.
- `LEGACY_KEY_PREFIX = "tinydocy-"`: any localStorage key starting with it, other than `THEME_STORAGE_KEY`, marks a browser that used TinyDocy before.
- `fallbackThemePreference(hasLegacyKey: boolean): ThemePreference`: `"light"` when a legacy key exists, else `"system"`.
- `readThemePreference(): ThemePreference`: the in-memory session value first, then the stored valid value, then the fallback.
- `systemPrefersDark(): boolean`.
- `setTheme(preference: ThemePreference): void`: writes storage inside try/catch, keeps the session value, runs `applyTheme(resolved)` and dispatches `THEME_CHANGE_EVENT`. It is the only writer.
- `watchSystemTheme(): () => void`: on each media change it re-reads `readThemePreference()`; while that is `"system"` it applies the theme, then dispatches `THEME_CHANGE_EVENT` (ThemeToggle re-reads only on that event). Returns the unsubscribe.
- `applyTheme(dark)` is unchanged.

Produces, in `lib/theme-boot.ts`: `THEME_BOOT_SCRIPT`. It interpolates the key, the allowlist and the prefix with `JSON.stringify`. When the key is missing or invalid it writes the **preference** (never the `matchMedia` result). It adds the `.dark` class and the theme-color meta only when the resolved theme is dark, as today.

- [ ] **Step 1: Write the failing tests.** Run the boot script in happy-dom with `new Function(THEME_BOOT_SCRIPT)()`, `localStorage` cleared or seeded, and `window.matchMedia` stubbed to `{ matches }`. Clean up the `.dark` class and the meta in `afterEach`; `importFresh("@/lib/theme")` per test, because the session value is module state.

  | Seed | OS dark | Expect `.dark` | Expect stored |
  |---|---|---|---|
  | nothing | false | no | `"system"` |
  | nothing | true | yes | `"system"` |
  | `tinydocy-user` | true | no | `"light"` |
  | `tinydocy-theme="dark"` | false | yes | `"dark"` |
  | `tinydocy-theme="system"` | true | yes | `"system"` |
  | `tinydocy-theme="purple"` | false | no | `"system"` |
  | nothing, run once, then seed `tinydocy-user` and run again (new visitor reloads) | true | yes | `"system"` |
  | `localStorage.getItem` and `setItem` throw | true | yes | (nothing; no throw) |

  Also test:
  - `setTheme("dark")` adds `.dark`, sets the meta to `THEME_COLOR_DARK`, stores `"dark"` and fires `THEME_CHANGE_EVENT` once.
  - `setTheme("system")` with throwing storage still applies, and `readThemePreference()` returns `"system"`.
  - The session choice wins: after `setTheme("dark")`, `localStorage.setItem("tinydocy-theme", "light")` leaves `readThemePreference()` at `"dark"`.
  - `watchSystemTheme` with `"system"`: a change event sets `.dark` and fires `THEME_CHANGE_EVENT`. With `"light"`: it does neither. The returned function removes the listener.
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/lib/theme.test.ts`. Expected: the exports are missing, and the "nothing / OS dark" row has no `.dark`.
- [ ] **Step 3: Implement** `lib/theme.ts` and `lib/theme-boot.ts` as specified.
- [ ] **Step 4: Run them and watch them pass.** The same command.
- [ ] **Step 5: Commit** (Global commit review): `feat(theme): system preference, one setTheme writer and a boot System branch`

#### Task F3-2: listener, controls and e2e

**Files:**
- Create `components/theme/theme-runtime.tsx`: `"use client"`, `export function ThemeRuntime(): null`, `useEffect(() => watchSystemTheme(), [])`.
- Modify `app/layout.tsx`: mount `<ThemeRuntime />` beside `<ServiceWorkerRegistration />`.
- Modify `components/document-editor/theme-toggle.tsx`: `toggleDarkMode` calls `setTheme(next ? "dark" : "light")`.
- Modify `components/smart-toolbar/row/row-menu-bodies.tsx`: `AppearanceMenu` replaces `ThemeMenuItem`. The radio value comes from `readThemePreference()` when the menu opens; picking an item runs `setTheme(value)`; drop the `themeInMenu` prop.
- Modify `components/smart-toolbar/row/overflow-menu.tsx`: delete the probe.
- Modify `components/document-editor/document-editor.tsx`, the UI-intent switch: add `case "theme.toggle": setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"); return true;`.
- Create `tests/e2e/theme-system.spec.ts`.
- Modify `tests/e2e/pwa-manifest.spec.ts` (the OS-colour-scheme test).
- Modify `README.md` only if the wording "Theme in ⋯" changes; `tests/TESTING.md`; `docs/research/2026-11-16-preferences-inventory.md` (C11, H4).

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/theme-system.spec.ts`. The spec never uses `window.__tiptap_editor`, so it also runs on a production build. Use a clean context on `/about` for new visitors. `EditorPage.goto` seeds `tinydocy-tabs`, a legacy key, so for `/` use the `isolateTabs` pattern from `pwa-manifest.spec.ts` without seeding tabs, and wait for `[data-server-synced]`. Set the scheme with `page.emulateMedia({ colorScheme })` before `goto`.
  - **"new visitor, OS dark: dark from the first frame".** An `addInitScript` stores `document.documentElement.classList.contains("dark")` from the first `requestAnimationFrame` into `window.__firstFrameDark`. Expect `__firstFrameDark === true`, the first `meta[name=theme-color]` is DARK, `localStorage["tinydocy-theme"] === "system"`, and no console message matching `/hydrat|did not match/i`.
  - **"new visitor, OS light: light, stored system".**
  - **"legacy browser stays light".** `addInitScript` sets `tinydocy-user`; OS dark. Expect no `.dark`, the meta is LIGHT, `"light"` stored.
  - **"System follows OS changes live".** On `/` (isolated): `emulateMedia` light, then dark, then light. `html.dark` and the meta follow, and the row button's name flips between "Switch to dark mode" and "Switch to light mode".
  - **"⋯ › Appearance › System returns to following the OS".** Click the row button (stored becomes `"dark"`), then choose ⋯ › Appearance › System with the OS light. Expect no `.dark` and `"system"` stored.
  - **"palette Switch theme flips the theme".** Click `.tiptap`, press Alt+/, type "Switch theme", press Enter. `html.dark` toggles.
  - **Rewrite the `pwa-manifest.spec.ts` OS-colour-scheme test** as "a legacy browser ignores the OS colour scheme": seed `tinydocy-user`, OS dark, expect LIGHT.
- [ ] **Step 2: Run them and watch them fail.** `bun playwright test --project=chromium tests/e2e/theme-system.spec.ts tests/e2e/pwa-manifest.spec.ts` on this PR's dev servers. Expected: the new-visitor dark test fails (light), the Appearance item is missing, and the palette test fails (no handler).
- [ ] **Step 3: Implement** the changes listed under Files.
- [ ] **Step 4: Run them and watch them pass.** The same command, then the whole `bun playwright test --project=chromium`: every other spec seeds `tinydocy-tabs` (legacy, so light) or runs in Playwright's default light scheme. Then, on a production build, `theme-system.spec.ts` once more (the boot string under Turbopack), and the editor-chunk check.
- [ ] **Step 5: Check in the app.** Set the macOS appearance to Dark, use a fresh profile and open this PR's `/about`: no white flash, and switching the OS appearance flips the page live. Take the design-review screenshots.
- [ ] **Step 6: Docs and checks.** Add the CHANGELOG entry and the new spec to `tests/TESTING.md`; mark C11 and H4 resolved by F3 in the inventory doc. Run `bun run check && bun run lint && bun run typecheck && bun run test`.
- [ ] **Step 7: Commit** (Global commit review): `feat(theme): follow the OS live and offer System in the ⋯ menu`

---

### PR F5: underlined document links

- **Branch:** `fix/link-underlines` (from `main` after F1 merges)
- **PR title:** `fix(editor): pin document link underlines, offset them and brighten dark links`
- **Lens:** UX
- **Deploy:** none.
- **Design review:** links in a paragraph, a heading, a list and a table.
- **CHANGELOG:**
  ```markdown
  ### Link underlines and dark link colour

  Document links stay underlined everywhere (WCAG 1.4.1), set slightly below the text.

  #### Fixed
  - Dark-mode document links are brighter (≥4.5:1).

  #### Changed
  - The underline sits `0.15em` below the text, clear of descenders.
  ```

#### Task F5-1: link tests, then the offset and the dark colour

**Files:**
- Create `tests/e2e/link-underlines.spec.ts`.
- Modify `tests/helpers/css-tokens.ts` (F1) and `tests/unit/lib/token-contrast.test.ts` (F1).
- Modify `components/tiptap-node/paragraph-node/paragraph-node.scss`:
  - The LINKS block becomes `a { color: var(--link-text-color); text-decoration: underline; text-underline-offset: .15em; }`. Don't add a second `.tiptap a` rule.
  - In the first `.tiptap.ProseMirror` block's nested `.dark & {` block, `--link-text-color: #1a73e8` becomes `#5b9cf2` (7.05:1 on `--background`, 6.39:1 on `--card`).

**Interfaces.** Consumes F1's `readThemeTokens` and `oklchToHex` and the existing `contrastRatio`. Produces `readScssVar(file: string, selector: ".dark" | ":root", name: string): string` in `tests/helpers/css-tokens.ts`: the literal value of a custom property in an SCSS file. `":root"` reads the top-level `.tiptap.ProseMirror` block; `".dark"` reads its nested `.dark & {` block.

- [ ] **Step 1: Write the tests.**
  - Unit, in `token-contrast.test.ts`:
    ```ts
    it("dark document links reach 4.5:1", …)
      // readScssVar("components/tiptap-node/paragraph-node/paragraph-node.scss", ".dark", "--link-text-color")
      // ≥ 4.5:1 against oklchToHex(readThemeTokens("dark").background) and .card
    ```
  - e2e, in `link-underlines.spec.ts`: open a fresh doc with `EditorPage.goto()` and `waitForSync()`; with `window.__tiptap_editor.commands.insertContent(html)`, insert a link (`https://example.com`) in a paragraph, an H2, a bullet item and a table cell, plus one link carrying bold and a text colour (so the link wraps a `span`). For each `.tiptap a`:
    ```ts
    expect(getComputedStyle(a).textDecorationLine).toBe("underline");
    expect(parseFloat(getComputedStyle(a).textUnderlineOffset))
      .toBeCloseTo(0.15 * parseFloat(getComputedStyle(a).fontSize), 1);
    ```
- [ ] **Step 2: Run them and watch them fail.**
  - `bun test tests/unit/lib/token-contrast.test.ts`: the link test fails (4.39 on background).
  - `bun playwright test --project=chromium tests/e2e/link-underlines.spec.ts`: `textDecorationLine` **passes on `main`** (finding 4), and the offset assertion fails (`auto` gives `NaN`). If any `textDecorationLine` assertion fails, add that context's selector to the same rule; never a new global rule.
- [ ] **Step 3: Implement** the SCSS changes listed under Files.
- [ ] **Step 4: Run them and watch them pass.** The same two commands.
- [ ] **Step 5: Check in the app** in light and dark, and take the design-review screenshots.
- [ ] **Step 6: Docs.** Add the CHANGELOG entry and the spec to `tests/TESTING.md`. In preferences design §5.12 and §1 (the "Only `a span` gets an underline" line), note that the underline already existed.
- [ ] **Step 7: Commit** (Global commit review): `fix(editor): offset document link underlines, brighten dark links and pin both`

---

## Part: Identity validation (F2) and image metadata stripping (A0)

Sources: preferences design §5.12 (F2); image store design §2.2, §2.3, §8 and §9 row A0; `docs/research/2026-11-16-preferences-inventory.md`.

---

### PR F2: Identity validation

- **Branch:** `fix/identity-validation`
- **PR title:** `fix(identity): validate stored and remote collaborator identities`
- **Lens:** SE+UX
- **Deploy:** none.
- **Design review:** both dialog errors, and a remote caret with a repaired colour and name.
- **CHANGELOG** (in F2.3's commit):
  ```markdown
  ### Identity validation

  Your name and caret colour are checked before they are sent to collaborators, and collaborators' names are cleaned before their carets are drawn.

  #### Fixed
  - A stored colour outside the 8 swatches, or a name with control, direction-override or zero-width characters, is repaired.
  - Blocked browser storage no longer breaks the editor; the identity lasts for the session.
  - The identity dialog says "Enter a name." or "Use 32 characters or fewer." instead of silently keeping the old name, and counts emoji and Persian names correctly.
  ```

**What the code does today:**
- **Storage.** `lib/user-identity.ts` (`getUserIdentity`, `saveUserIdentity`) calls `localStorage` with no try/catch and accepts any string for `name` or `color` through a cast.
- **Two callers share one identity:** `use-document-editor-effects.ts` broadcasts it with `updateUser`; `user-identity-button.tsx` shows it in the status card.
- **The dialog** (`user-identity-dialog.tsx`): `maxLength={30}` counts UTF-16 units, so it silently cuts emoji and Persian names, and an empty name silently keeps the old one.
- **Remote identities.** `@tiptap/extension-collaboration-caret@3.33.1` passes every remote user through `sanitizeUserColor` (`#rrggbb`, else `transparent`) and inserts the name with `createTextNode`, so there is no CSS or HTML injection today. y-tiptap substitutes `User: <clientId>` for a missing name and skips a user whose name is not a string. The gaps: a name with bidi overrides or 10k characters is drawn as sent; an invalid colour makes the caret invisible; the protection lives only in a dependency. `editor.storage.collaborationCaret.users` keeps raw states, but nothing renders their colour or name (`user-identity-button.tsx` only counts them).

**Decisions:**
- Validate at client render in our own `render`/`selectionRender`, independently of upstream. Server-side `beforeHandleAwareness` hardening is P4.2b (Live release); P4.7 adopts the same normaliser wherever else remote names are shown.
- Text cleaning lives in `lib/clean-text.ts`, shared with W1a's closed-tab titles.

| Input | Rule | Invalid → |
|---|---|---|
| Own colour (stored or saved) | One of `CARET_COLORS`, case-insensitive, stored in the palette's uppercase form | the in-memory identity's colour (a random `CARET_COLORS` entry the first time) |
| Remote colour (render) | A palette entry (canonicalised), or any other `#rrggbb` (kept, so a real caret never disappears) | `UNKNOWN_CARET_COLOR = "#9E9E9E"`, which also replaces upstream's `transparent` |
| Name, own and remote | `cleanText`: NFC → replace each stripped character with a space → collapse whitespace runs to one space → trim. Stripped: `\p{Cc}` (C0, DEL, C1), U+200B, U+200E, U+200F, U+061C, U+2060, U+FEFF, U+202A–U+202E, U+2066–U+2069. Kept: ZWNJ U+200C and ZWJ U+200D. Then 1–32 graphemes (`Intl.Segmenter`, `granularity: "grapheme"`) | Stored: the in-memory identity's name. Dialog: inline error. Remote: first cut the raw string to 1,024 code units, then clean and keep the first 32 graphemes; `""` renders an empty label |
| Storage | Every `window.localStorage` access, including reading the property, is inside try/catch. Storage is read on every call, so another tab's saved name is seen | One module-level in-memory identity, used when storage throws, holds no identity, or the write fails, so both callers always get the same one |

#### Task F2.1: Validated identity module

**Files:**
- Create `lib/clean-text.ts`.
- Modify `lib/user-identity.ts`: everything after the palette (`CARET_COLORS` is unchanged).
- Create `tests/unit/lib/user-identity.test.ts` (no unit test exists for this module today).

**Interfaces:**
- Produces, in `lib/clean-text.ts`:
  - `export const UNSAFE_TEXT_CHARS = /[\p{Cc}\u200B\u200E\u200F\u061C\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/gu`. Write it with these `\u` escapes, never literal invisible characters. `\p{Cc}` avoids the `\x00`–`\x1F` escapes that Biome's `noControlCharactersInRegex` flags; if `bun run check` still flags it, disable that rule for this one file in `biome.json`, not with an inline comment.
  - `export function cleanText(raw: string): string`: the pipeline in the table (NFC, replace with a space, collapse, trim).
- Produces, in `lib/user-identity.ts`:
  - `export const NAME_MAX_GRAPHEMES = 32`; `export const UNKNOWN_CARET_COLOR = "#9E9E9E"`.
  - `export type NameResult = { ok: true; name: string } | { ok: false; error: "empty" | "too_long" }`.
  - `export function normalizeName(raw: unknown): NameResult`: `cleanText`, then the grapheme count.
  - `export function clampRemoteName(raw: string): string`: `cleanText(raw.slice(0, 1024))`, cut to 32 graphemes; may return `""`.
  - `export function toCaretColor(raw: unknown): (typeof CARET_COLORS)[number] | null`: the palette match, case-insensitive.
  - `export function toRemoteCaretColor(raw: unknown): string`: per the table.
  - `export function parseStoredIdentity(raw: string | null, fallback: UserIdentity): UserIdentity`: repairs each field from `fallback`; never throws.
  - `getUserIdentity(): UserIdentity`, same signature. On the server (`typeof window === "undefined"`) it generates and does not cache. In the browser: read storage (try/catch); with a stored identity, return `parseStoredIdentity(raw, memory)` and write back the repaired value when it differs; otherwise return `memory` and try to store it. `memory` is the module's in-memory identity, generated once and updated by every successful read and save.
  - `saveUserIdentity(identity: UserIdentity): NameResult`: validates first; on `ok` stores `{ name, color: toCaretColor(color) ?? memory.color }` (try/catch), updates `memory`, returns the result. Never throws.

- [ ] **Step 1: Write the failing tests.** `importFresh("@/lib/user-identity")` in each test; `resetModules()`, `localStorage.clear()` and restoring any `localStorage` descriptor in `afterEach`.
  ```ts
  const FALLBACK = { name: "Brave Otter", color: "#E57373" };
  it("keeps ZWNJ in a Persian name", () =>
    expect(normalizeName("  علی\u200Cرضا  ")).toEqual({ ok: true, name: "علی\u200Cرضا" }));
  it("strips an RTL-override attack", () =>
    expect(normalizeName("\u202Egnp.exe\u202C Bob")).toEqual({ ok: true, name: "gnp.exe Bob" }));
  it("collapses whitespace and drops controls", () =>
    expect(normalizeName("A\u0000\t\n  B\u0085")).toEqual({ ok: true, name: "A B" }));
  it("counts graphemes, not code units", () => {
    expect(normalizeName("\u{1F469}\u200D\u{1F469}\u200D\u{1F467}".repeat(32))).toEqual({ ok: true, name: "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}".repeat(32) });
    expect(normalizeName("a".repeat(33))).toEqual({ ok: false, error: "too_long" });
  });
  it("rejects empty after stripping", () => {
    expect(normalizeName(" \u202A ")).toEqual({ ok: false, error: "empty" });
    expect(normalizeName("\u200B")).toEqual({ ok: false, error: "empty" });
  });
  it("NFC-normalises", () =>
    expect(normalizeName("e\u0301")).toEqual({ ok: true, name: "\u00E9" }));
  it("canonicalises a lowercase palette colour", () =>
    expect(toCaretColor("#e57373")).toBe("#E57373"));
  it("refuses CSS in a colour", () => {
    expect(toCaretColor("red;background:url(//x)")).toBeNull();
    expect(toRemoteCaretColor("red;background:url(//x)")).toBe("#9E9E9E");
    expect(toRemoteCaretColor("transparent")).toBe("#9E9E9E");
    expect(toRemoteCaretColor("#123abc")).toBe("#123abc");
  });
  it("repairs a stored payload per field", () => {
    localStorage.setItem("tinydocy-user", JSON.stringify({ name: "Ann", color: "#e11d48" }));
    const id = getUserIdentity();
    expect(id.name).toBe("Ann");
    expect(CARET_COLORS).toContain(id.color);
    expect(JSON.parse(localStorage.getItem("tinydocy-user")!)).toEqual(id);
  });
  it("regenerates a non-object, a non-string name and an over-long name", () => {
    for (const raw of ["[]", "null", '{"name":5}', JSON.stringify({ name: "x".repeat(40), color: "#E57373" })])
      expect(parseStoredIdentity(raw, FALLBACK).name).toBe(FALLBACK.name);
  });
  it("sees a name saved by another tab", () => {
    getUserIdentity();
    localStorage.setItem("tinydocy-user", JSON.stringify({ name: "Zed", color: "#64B5F6" }));
    expect(getUserIdentity()).toEqual({ name: "Zed", color: "#64B5F6" });
  });
  it("survives blocked storage and keeps one identity per session", () => {
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
    const a = getUserIdentity();
    expect(getUserIdentity()).toEqual(a);
    expect(saveUserIdentity({ name: "Bo", color: "#64B5F6" })).toEqual({ ok: true, name: "Bo" });
    expect(getUserIdentity()).toEqual({ name: "Bo", color: "#64B5F6" });
  });
  it("keeps one identity when only setItem throws (quota)", () => {
    spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(getUserIdentity()).toEqual(getUserIdentity());
  });
  it("save refuses an invalid name and keeps the stored identity", () => {
    const before = getUserIdentity();
    expect(saveUserIdentity({ name: "  ", color: "#64B5F6" })).toEqual({ ok: false, error: "empty" });
    expect(getUserIdentity()).toEqual(before);
  });
  it("clamps a remote name", () => {
    expect(clampRemoteName("\u202E" + "w".repeat(10_000))).toBe("w".repeat(32));
    expect(clampRemoteName("\u202E\u200B")).toBe("");
  });
  ```
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/lib/user-identity.test.ts`. Expected: missing exports (`normalizeName is not a function`), and the blocked-storage test throws `SecurityError`.
- [ ] **Step 3: Implement** `lib/clean-text.ts` and `lib/user-identity.ts` per Interfaces. Build the `Intl.Segmenter` lazily, once.
- [ ] **Step 4: Run them and watch them pass.** The same command, then `bun run typecheck` and `bun run check`.
- [ ] **Step 5: Commit** (Global commit review): `fix(identity): validate stored identity and survive blocked storage`

#### Task F2.2: Dialog validation and broadcasting the normalised identity

**Files:**
- Modify `components/tiptap-ui/user-identity-dialog.tsx` (the save handler and the name input).
- Modify `components/tiptap-ui/user-identity-button.tsx` (`handleSave`).
- Create `tests/unit/components/user-identity-dialog.test.tsx`.

**Interfaces:**
- Consumes `normalizeName` and `saveUserIdentity` from F2.1.
- Produces: `UserIdentityDialogProps.onSave` becomes `(identity: UserIdentity) => NameResult`. The dialog closes only on `ok`; otherwise it shows the error and keeps focus in the field.

- [ ] **Step 1: Write the failing tests** (render the dialog open with `@testing-library/react`, as `toolbar.test.tsx` does):
  - Empty name → Save shows `"Enter a name."`. `onSave` is not called, the dialog stays open, `document.activeElement` is `#user-identity-name`, and the input has `aria-invalid="true"` and `aria-describedby` pointing at the message.
  - 33 × `"a"` → `"Use 32 characters or fewer."`.
  - 32 emoji graphemes are accepted, so the input has no `maxLength` attribute.
  - In `user-identity-button` (mock `saveUserIdentity` to return `{ ok: true, name: "Ann" }` for `"  Ann  "`), `editor.commands.updateUser` gets `{ name: "Ann", color }`, not the raw draft.
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/components/user-identity-dialog.test.tsx`. Expected: the dialog closes on an empty name, and the input has `maxlength="30"`.
- [ ] **Step 3: Implement.** Remove `maxLength={30}` and the `|| currentUser.name` fallback; add `<p id="user-identity-name-error" className="text-sm text-destructive">` below the input; clear the error on change. `handleSave` in the button calls `saveUserIdentity` and, on `ok`, `setIdentity` and `updateUser` with the normalised name.
- [ ] **Step 4: Run them and watch them pass.** The same command, then `bun run test`.
- [ ] **Step 5: Check in the app** on this PR's dev servers: "Edit identity", save an empty name, then 33 characters, then a Persian name with a ZWNJ. Take the design-review screenshots of both errors.
- [ ] **Step 6: Commit** (Global commit review): `fix(identity): show inline name errors and broadcast the normalised identity`

#### Task F2.3: Remote caret render validation

**Files:**
- Create `extensions/collaboration-caret/safe-caret-render.ts`.
- Modify `components/document-editor/document-editor-config.ts`: the `CollaborationCaret.configure` call.
- Create `tests/unit/extensions/safe-caret-render.test.ts`.

**Interfaces:**
- Consumes `clampRemoteName` and `toRemoteCaretColor` from F2.1.
- Produces:
  - `export function renderCaret(user: { name?: unknown; color?: unknown }): HTMLElement`. It keeps the upstream DOM exactly: `span.collaboration-carets__caret` with `style.borderColor`, containing `div.collaboration-carets__label` with `style.backgroundColor` and one text node (`clampRemoteName` when `name` is a string, else `""`). `selection-bubble-view.tsx` and `paragraph-node.scss` depend on these class names.
  - `export function renderCaretSelection(user): { style: string; class: "ProseMirror-yjs-selection" }`, style `background-color: ${color}70`, matching `@tiptap/y-tiptap` `defaultSelectionBuilder`.
  - The config becomes `CollaborationCaret.configure({ provider, render: renderCaret, selectionRender: renderCaretSelection })`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  const el = renderCaret({ name: "\u202Eevil" + "x".repeat(100), color: "red;background:url(//x)" });
  expect(el.className).toBe("collaboration-carets__caret");
  expect(el.style.borderColor).toBe("#9e9e9e"); // happy-dom may return rgb(158, 158, 158): assert via a helper that normalises
  const label = el.querySelector(".collaboration-carets__label")!;
  expect(label.textContent).toBe("evil" + "x".repeat(28));
  expect(label.children.length).toBe(0); // text node only, no markup
  expect(renderCaret({ name: "<img src=x onerror=alert(1)>", color: "#E57373" }).querySelector("img")).toBeNull();
  expect(renderCaret({ name: "\u200B", color: "#E57373" }).querySelector(".collaboration-carets__label")!.textContent).toBe("");
  expect(renderCaretSelection({ color: "transparent" }).style).toBe("background-color: #9E9E9E70");
  expect(renderCaretSelection({ color: "#e57373" }).style).toBe("background-color: #E5737370");
  ```
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/extensions/safe-caret-render.test.ts`. Expected: module not found.
- [ ] **Step 3: Implement** both functions and wire them in the config.
- [ ] **Step 4: Run them and watch them pass.** The same command; the editor-chunk check (the config is eager); then `bun playwright test tests/e2e/collaboration.spec.ts --project=chromium` on this PR's dev servers.
- [ ] **Step 5: Check in the app with two browser contexts on one doc.** In B, `window.__tiptap_editor.commands.updateUser({ name: "\u202Eabc", color: "url(x)" })`. In A, the caret is grey (`#9E9E9E`), visible and labelled `abc`. Take the screenshot.
- [ ] **Step 6: Docs.** Add the CHANGELOG entry and the three new test files to `tests/TESTING.md`.
- [ ] **Step 7: Commit** (Global commit review): `fix(collab): clamp remote caret names and colours at render`

**Note.** `tests/e2e/toolbar-a11y-r3.spec.ts` seeds `color: "#e11d48"`, which is not in the palette, so it is now repaired to a swatch. That test checks only clipping and still passes unchanged.

---

### PR A0: Metadata stripped from images that skip downscaling

- **Branch:** `fix/image-metadata-strip`
- **PR title:** `fix(images): strip Exif, GPS and text metadata from inserted images`
- **Lens:** SE
- **Deploy:** none (client only).
- **Design review:** none (no visible UI change).
- **CHANGELOG** (in A0.3's commit):
  ```markdown
  ### Image privacy

  Inserted and pasted images no longer carry camera metadata.

  #### Fixed
  - JPEG photos are always re-encoded, which removes Exif and GPS location and bakes in the rotation.
  - PNG and WebP keep their pixels but lose text, time, Exif, XMP and unknown chunks. A PNG or WebP carrying an Exif rotation is re-encoded instead.
  - New images get empty alt text instead of the file name.

  #### Changed
  - Small JPEGs over 1600 px on the longest side are now downscaled, and re-encoded JPEGs are converted to sRGB.
  - GIFs are unchanged, so animations keep working.
  ```

**Decisions:**
- §9's A0 row covers the JPEG re-encode and `alt=""`. This PR also lands the PNG/WebP stripper (§2.3, I3), which §9 assigns to A1, at A1's path `lib/assets/strip-metadata.ts`, so A1 imports it instead of duplicating it. Magic-byte sniffing, hashing, the worker encoder and the 2 MiB/2560 px caps stay with A1; server-side checks (§6 rule 10, the dimension parse) are not in this PR.
- **Allowlist, not denylist.** PNG keeps `IHDR PLTE IDAT IEND tRNS cHRM gAMA iCCP sBIT sRGB cICP mDCV cLLI bKGD hIST pHYs sPLT acTL fcTL fdAT` (colour profile and APNG kept); WebP keeps `VP8 ` `VP8L` `VP8X` `ALPH` `ICCP` `ANIM` `ANMF`. Every other chunk is dropped, including private ones.
- **Exif orientation ≠ 1 → re-encode.** Browsers draw a PNG's `eXIf` or a WebP's `EXIF` rotation; stripping it would turn the picture. The stripper returns `null` and the pipeline re-encodes, which bakes the rotation in.
- **GIF passes through only when its bytes start with `GIF87a` or `GIF89a`;** otherwise it is re-encoded. GIF comment and XMP application extensions pass through (documented in the module comment, §2.3).
- **The stripper is its own chunk.** `prepareImageForEmbed` (statically imported by the eager `handleImageUpload` in `components/tiptap-node/image-upload-node/upload-utils.ts`) loads it with `await import("@/lib/assets/strip-metadata")` in the strip branch.

**Pipeline after this PR** (`planImageEmbed` and `prepareImageForEmbed`, `lib/image-downscale.ts`):

| Type (lower-cased) | Today | After A0 |
|---|---|---|
| SVG, non-image | reject | reject (unchanged) |
| `image/gif` | passthrough if it fits, else reject | passthrough if it fits and the signature matches; re-encode if the signature does not match; reject if too big |
| `image/jpeg` | passthrough if it fits | **always `reencode`** (WebP, else JPEG, via `encodeUnderCap`). Canvas `drawImage` applies Exif orientation; the longest side is capped at `EMBED_IMAGE_MAX_SIDE` (1600) |
| `image/png`, `image/webp` that fit | passthrough | **`strip`**; when the stripper returns `null` (malformed, not that container, or rotated), `reencode` |
| anything else | reencode | reencode (unchanged) |

All insert routes go through `handleImageUpload` → `prepareImageForEmbed`: the upload node (`ImageUploadNode.configure({ upload: handleImageUpload })` in `document-editor-config.ts`), and paste and drop via the kit's `editorFileUpload` event (`insertPastedImages` in `use-media-file-upload.ts`). Media embedded by URL (`use-media-embed.ts`) holds no file bytes and is out of scope.

#### Task A0.1: PNG and WebP metadata stripper (pure)

**Files:**
- Create `lib/assets/strip-metadata.ts`.
- Create `tests/unit/lib/assets/strip-metadata.test.ts`.
- Create `tests/helpers/image-bytes.ts`, which builds byte fixtures in code. **No binary fixtures are committed.**

**Interfaces:**
- Produces `export function stripImageMetadata(bytes: Uint8Array, type: "image/png" | "image/webp"): Uint8Array | null`:
  - **PNG:** requires the 8-byte signature and well-formed chunks (length + type + data + CRC within bounds). Keeps allowlisted chunks byte for byte (CRCs are not recomputed). Stops after `IEND` and **drops any trailing bytes**. Returns `null` if the signature is missing, a chunk overruns, there is no `IEND`, or an `eXIf` chunk's Orientation (tag 0x0112) is not 1.
  - **WebP:** requires `RIFF`, a size and `WEBP`. Walks the chunks (fourcc, LE32 size, payload padded to an even length) and keeps allowlisted ones. Clears VP8X flag bits `0x08` (Exif) and `0x04` (XMP) in byte 0 of the VP8X payload. Rewrites the RIFF size and drops bytes beyond the declared RIFF size. Returns `null` when the header is bad, a chunk overruns, or an `EXIF` chunk's Orientation is not 1.
- Produces test helpers in `tests/helpers/image-bytes.ts`:
  - `pngChunk(type: string, data: Uint8Array): Uint8Array`, with a real CRC32.
  - `buildPng(extra: Uint8Array[]): Uint8Array`: a valid 2×1 RGBA PNG (IHDR + one zlib-stored IDAT + IEND) with `extra` inserted before IDAT.
  - `buildWebp(opts: { exif?: boolean; orientation?: number; xmp?: boolean }): Uint8Array`: VP8X + a 1×1 lossless `VP8L` + optional `EXIF` (a TIFF with a GPS IFD, and Orientation when given) and `XMP ` chunks.
  - `buildExifApp1(opts: { orientation?: number; gps?: { lat: number; lon: number } }): Uint8Array`: `Exif\0\0` + an `II*\0` TIFF with IFD0 (Orientation 0x0112, GPSInfo pointer 0x8825) and a GPS IFD (tags 0x0001–0x0004). Reused by A0.2's e2e and by the WebP `EXIF` chunk.
  - `GIF_TWO_FRAMES: Uint8Array`: a 2×2 GIF89a with a NETSCAPE2.0 loop extension and two image descriptors, as a hex literal (about 80 bytes) with a byte map in a comment.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  const exif = pngChunk("eXIf", buildExifApp1({ gps: { lat: 52.37, lon: 4.89 } }).subarray(6));
  const text = pngChunk("tEXt", ascii("Comment\0secret"));
  const out = stripImageMetadata(buildPng([exif, text, pngChunk("tIME", new Uint8Array(7))]), "image/png")!;
  expect(out).toEqual(buildPng([]));                     // IHDR/IDAT/IEND byte-identical, so the pixels are identical
  expect(chunkTypes(out)).toEqual(["IHDR", "IDAT", "IEND"]);
  const icc = pngChunk("iCCP", concat(ascii("p\0\0"), new Uint8Array(4)));
  expect(chunkTypes(stripImageMetadata(buildPng([icc, pngChunk("prVt", ascii("x"))]), "image/png")!))
    .toEqual(["IHDR", "iCCP", "IDAT", "IEND"]);          // allowlist: colour profile kept, unknown chunk dropped
  expect(stripImageMetadata(buildPng([pngChunk("eXIf", buildExifApp1({ orientation: 6 }).subarray(6))]), "image/png"))
    .toBeNull();                                         // orientation 6 returns null: re-encode bakes the rotation
  expect(stripImageMetadata(concat(buildPng([]), ascii("GPS 52.37")), "image/png")).toEqual(buildPng([]));
  expect(stripImageMetadata(buildPng([]).subarray(0, 40), "image/png")).toBeNull();         // a chunk overruns
  expect(stripImageMetadata(jpegBytesWithExif, "image/png")).toBeNull();                    // declared PNG, bytes are JPEG
  const w = stripImageMetadata(buildWebp({ exif: true, xmp: true }), "image/webp")!;
  expect(riffChunks(w)).toEqual(["VP8X", "VP8L"]);
  expect(w[20] & 0x0c).toBe(0);                          // VP8X Exif and XMP flags cleared
  expect(readLe32(w, 4)).toBe(w.length - 8);
  expect(riffChunk(w, "VP8L")).toEqual(riffChunk(buildWebp({}), "VP8L"));
  expect(stripImageMetadata(buildWebp({ exif: true, orientation: 6 }), "image/webp")).toBeNull();
  expect(stripImageMetadata(ascii("RIFF\x10\0\0\0WEBPVP8X"), "image/webp")).toBeNull();
  ```
  `jpegBytesWithExif` is `[0xFF, 0xD8, 0xFF, 0xE1, …app1]`. `chunkTypes`, `riffChunks`, `riffChunk`, `readLe32`, `ascii` and `concat` are small local helpers in the test.
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/lib/assets/strip-metadata.test.ts`. Expected: module not found.
- [ ] **Step 3: Implement** `stripImageMetadata` as specified: pure, no DOM.
- [ ] **Step 4: Run them and watch them pass.** The same command, then `bun run typecheck`.
- [ ] **Step 5: Commit** (Global commit review): `feat(images): add PNG and WebP metadata stripper`

#### Task A0.2: Planner and pipeline: JPEG always re-encoded, PNG/WebP stripped, GIF checked

**Files:**
- Modify `lib/image-downscale.ts`: `PASSTHROUGH_TYPES` (remove), `EmbedPlan`, `planImageEmbed`, `prepareImageForEmbed`, and the module comment.
- Modify `tests/unit/lib/image-downscale.test.ts` (the planner cases and "embeds a small image unchanged").
- Create `tests/e2e/image-metadata.spec.ts`.
- Modify `playwright.config.ts`: add `"**/image-metadata.spec.ts"` to the `webkit` project's `testMatch`.

**Interfaces:**
- Produces: `EmbedPlan` gains `{ kind: "strip"; type: "image/png" | "image/webp" }`; `passthrough` is returned only for GIF.
- In `prepareImageForEmbed`:
  - `passthrough`: read the first 6 bytes; with a GIF signature return `readAsDataUrl(file)`, else fall through to re-encode.
  - `strip`: `const { stripImageMetadata } = await import("@/lib/assets/strip-metadata")`, then `stripImageMetadata(new Uint8Array(await file.arrayBuffer()), plan.type)`. Not null → `readAsDataUrl(new Blob([out], { type }))`; null → the existing re-encode branch.
- Consumes `stripImageMetadata` from A0.1.

- [ ] **Step 1: Write and update the failing unit tests:**
  ```ts
  expect(planImageEmbed({ type: "image/jpeg", size: 1 * KB }, cap)).toEqual({ kind: "reencode" });   // was passthrough
  expect(planImageEmbed({ type: "IMAGE/JPEG", size: 1 * KB }, cap)).toEqual({ kind: "reencode" });
  expect(planImageEmbed({ type: "image/png", size: 100 * KB }, cap)).toEqual({ kind: "strip", type: "image/png" });
  expect(planImageEmbed({ type: "image/webp", size: 1 * KB }, cap)).toEqual({ kind: "strip", type: "image/webp" });
  expect(planImageEmbed({ type: "image/png", size: 4 * KB * KB }, cap)).toEqual({ kind: "reencode" });
  expect(planImageEmbed({ type: "image/gif", size: 10 * KB }, cap)).toEqual({ kind: "passthrough" });
  // prepareImageForEmbed (replaces "embeds a small image unchanged", which used 32 zero bytes)
  const src = await prepareImageForEmbed(new File([buildPng([exif, text])], "a.png", { type: "image/png" }));
  expect(base64Bytes(src)).toEqual(buildPng([]));
  const gif = await prepareImageForEmbed(new File([GIF_TWO_FRAMES], "a.gif", { type: "image/gif" }));
  expect(base64Bytes(gif)).toEqual(GIF_TWO_FRAMES);   // byte-identical: both frames and the loop extension survive
  ```
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/lib/image-downscale.test.ts`. Expected: the JPEG plan is `passthrough`, and the PNG output still contains `eXIf`.
- [ ] **Step 3: Implement** the plan and pipeline changes. The module comment states the I3 policy, including the GIF pass-through.
- [ ] **Step 4: Run them and watch them pass.** The same command, then `bun run test`: the existing `encodeUnderCap` size tests are unchanged (§9 "no size regression"). Then the editor-chunk check, and confirm the stripper is not in the editor group: `grep -l fdAT .next/static/chunks/*.js` names a file the script did not list.
- [ ] **Step 5: Write the e2e golden test** in `tests/e2e/image-metadata.spec.ts`, using `EditorPage`. happy-dom cannot decode or encode, so this is where JPEG and pixels are checked. A local `metadataSegments(bytes)` helper returns the JPEG APP1 (`FF E1`) segments before SOS, or the WebP `EXIF`/`XMP ` chunk names.
  - **Fixture, built in the page:** a 40×20 canvas, red on the left half and blue on the right, as `toBlob("image/jpeg", 0.95)`, with `buildExifApp1({ orientation: 6, gps: { lat: 52.37, lon: 4.89 } })` spliced as an `FF E1` segment right after SOI (bytes from the helper, passed through `page.evaluate`).
  - **Insert:** dispatch `new CustomEvent("editorFileUpload", { detail: { files: [file], editor: window.__tiptap_editor } })` on `document`.
  - **"JPEG with orientation 6 and GPS":**
    - the `src` type is `image/webp`, or `image/jpeg` where WebP cannot be encoded (WebKit);
    - `metadataSegments` of the `src` bytes is `[]` (no APP1, no `EXIF` or `XMP ` chunk);
    - `naturalWidth × naturalHeight` is `20 × 40` (orientation applied);
    - a canvas sample at (10, 5) is red-dominant and at (10, 35) blue-dominant, each channel within ±40;
    - the node's `alt` is `""` (A0.3).
  - **"PNG with eXIf and tEXt":** `buildPng([eXIf, tEXt])`; the `src` bytes equal `buildPng([])` and the image decodes to 2×1.
  - **"JPEG bytes labelled image/png":** the output type is not `image/png` and `metadataSegments` is `[]`.
  - **"JPEG bytes labelled image/gif":** the output type is not `image/gif` and `metadataSegments` is `[]`.
- [ ] **Step 6: Run the e2e test and watch it pass.** `bun playwright test tests/e2e/image-metadata.spec.ts --project=chromium`, then `--project=webkit`: 4 passed in each. Before Step 3, the JPEG case fails on APP1.
- [ ] **Step 7: Commit** (Global commit review): `fix(images): always re-encode JPEG and strip PNG and WebP metadata on insert`

#### Task A0.3: New images get `alt=""` instead of the file name

**Files:**
- Modify `components/document-editor/use-media-file-upload.ts` (`insertPastedImages`).
- Modify `components/tiptap-node/image-upload-node/image-upload-node.tsx` (the inserted image attrs).
- Test: the alt assertion in A0.2's e2e, plus one upload-node case there using `setInputFiles` on the upload node's file input.

**Interfaces:** produces image attrs `{ src, alt: "" }`. `title` is no longer set from the file name, which leaks it the same way (`IMG_2026…_home.jpg`).

- [ ] **Step 1: Write the failing assertion.** In every e2e case, `img` has `alt=""` and no `title`. `bun playwright test tests/e2e/image-metadata.spec.ts --project=chromium`. Expected failure: `alt` equals the file name.
- [ ] **Step 2: Implement.** Set `alt: ""` and drop the `title` key in both places.
- [ ] **Step 3: Run the test and watch it pass.** The same command.
- [ ] **Step 4: Check in the app.** Paste a phone JPEG on this PR's dev servers: in DevTools the `src` starts with `data:image/webp`, `alt=""`, and the photo shows upright. Put a before/after APP1 presence check of the decoded `src` (printed with `bun -e`) in the commit review.
- [ ] **Step 5: Docs.** Add the CHANGELOG entry and the new test files to `tests/TESTING.md`.
- [ ] **Step 6: Commit** (Global commit review): `fix(images): insert new images with empty alt text`

---

## Part: W1: web sandbox, closing a tab becomes a soft delete with Undo

**Source:** details spec §9 (D8). Two PRs: **W1a** (server: store, routes, CLI, runbook, Deploy note; backward compatible with every bundle in the field) and **W1b** (UI: Undo and Recently closed; design review). W1a merges first.

#### Decisions (W1a and W1b)

1. **Server state is a sidecar table**, `document_closures(name TEXT PRIMARY KEY, tabs_doc TEXT NOT NULL, closed_at INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '')`, with an index on `(tabs_doc, closed_at)`.
   - Not a column on `documents`: `DOCUMENTS_SCHEMA` (`lib/hocus-persistence.ts`) must stay identical to extension-sqlite, a closed document may have no `documents` row yet, and the table follows the `document_activity` / `document_tombstones` pattern.
   - Created in `bootstrapDocumentActivityTable` with `CREATE TABLE IF NOT EXISTS`. Next.js, Hocus and the purge script all call it, so **no migration step is needed**.
2. **`DELETE /api/documents/[id]` keeps its verb and becomes soft.** It writes a closure row and never touches `documents`. Bundles in the field keep working: they only check `res.ok || 404`, and their bodiless closes become restorable too.
3. **Closures are scoped to the tab list they were closed from.** The client sends `getGlobalTabsDoc()` as `tabsDoc`; the server keeps it only when `isTabsDocumentId(tabsDoc)` passes, else `TABS_DOC`. In production (isolated tab lists are refused) every closure is `global-tabs`, so a client cannot hide its closures from the shared list; in dev and e2e each worker's `global-tabs-*` list sees only its own closures. `isTabsDocumentId` reads `HOCUS_ALLOW_ISOLATED_TABS_DOCS`, which the Makefile sets only for `dev-hocus`: W1a adds it to `dev-next` too (the Global dev-server commands already set it).
4. **The server cleans the title.** The DELETE body is read with a byte counter: past 1,024 bytes, a content type other than `application/json`, a parse error or a non-string `title` all give `""` (a `content-length` check alone misses chunked bodies). Then `cleanText` (F2) and a cap of 200 code points (`MAX_TAB_TITLE_LENGTH`). Rendered as React text only.
5. **Hocus does not change.** A closed document stays loadable and storable until the purge tombstones it, so the closing session's debounced store lands after the DELETE and Undo keeps the last keystrokes. A browser reconnecting with an offline copy merges harmlessly into a still-restorable document. Tombstones remain the only refusal (`scripts/hocus-server.ts`).
6. **The 7-day window is enforced when the server answers; the cron only finishes the job.** List and restore treat `closed_at < now − CLOSED_RETENTION_DAYS` as gone. The daily `scripts/purge-retention.ts` then deletes the stored state and writes the tombstone, looping batches until none remain. `closeDocumentSoftly` also sets `document_activity.last_persisted_at = MAX(last_persisted_at, now)`, so idle retention cannot tombstone a closed document inside its 7 days.
7. **Transactions.** `closeDocumentSoftly`, `restoreClosedDocument` and each purge batch run in `BEGIN IMMEDIATE`, inside the shared busy-retry.
8. **Recently closed** lists only closures whose name still has a `documents` row (`EXISTS`), newest first, at most 20, in the caller's tab list. There are no accounts, so anyone using that tab list can see and restore them; titles and ids already sit in the server-stored tab list, so this adds no new exposure. Operators can turn the list off with `CLOSED_DOCUMENTS_LIST=0` (the route then returns no documents and `disabled: true`; restore keeps working).
9. **One batch restore route**, `POST /api/documents/restore` with `{ ids: string[] }` (1 to `MAX_TABS_PER_CLIENT` ids, one rate-limit unit). Undo, close-all Undo and Recently closed all use it. Listing is `GET /api/documents/closed?tabs=<tabsDoc>`.
10. **Rate limits:** DELETE is unchanged. Restore and list each get their own `createSlidingWindowLimiter` at `HTTP_MUTATION_RATE_LIMIT_PER_MINUTE` (30/min/IP), each route file owning its limiter as DELETE does. Under `TRUSTED_PROXY=0` all three share the `unknown` key (existing runbook note). An `Origin` check on the POST route is not required: it accepts only `application/json` (a cross-site form cannot send it without a preflight) and restoring grants nothing anyone using the list could not do.
11. **Takedowns no longer happen by closing.** Anyone can restore a closed tab, so the runbook says never to close abusive content from the tab bar. The operator CLI `scripts/delete-document.ts <id>` deletes and tombstones at once.
12. **The Undo pill stays 5 s**, reusing `ACTION_PILL_MS` (`components/smart-toolbar/status-pill.tsx`) through `announceLater(msg, { action })`. 8 s would need a per-notice duration or a change to every Undo pill; tag-delete Undo in the same spec is 5 s. The pill holds while hovered or focused (WCAG 1.4.13), and Recently closed covers the next 7 days. `use-synced-tabs` is eager and imports only `lib/announce-later`, never `lib/announce`.
13. **Recently closed lives in the tab bar**, not the editor's ⋯ menu (the owner confirms at design review). ⋯ is "More formatting"; `OverflowMenuItems` sits in the lazy menu chunk with no access to the tab list, and wiring the tab hook into it would add a shared module that splits the editor group. The tab bar shows at every width and already holds "Close all tabs". The control is a History-icon button after Close all; its menu is one lazy chunk.
14. **Offline copies keep today's timing.** `closeTab` still calls `forgetLocalCopy(id)` straight after a successful DELETE; a session with unsynced edits stays alive and still sends them. Close is disabled offline, so Undo is always online and reloads from the server. Other browsers' copies are swept on their next tab-list sync.

---

### PR W1a: closed documents are kept for 7 days (server)

- **Branch:** `feat/soft-close-documents`
- **PR title:** `feat(api): keep closed documents for 7 days with restore and list routes`
- **Lens:** SE
- **Design review:** none (no UI).
- **Precondition before merge:** the owner confirms the daily retention purge runs on production. Nothing in the repo schedules `scripts/purge-retention.ts`: `ecosystem.config.cjs` has no job, and the runbook's Scheduled Jobs section only says to run it daily. `CLOSED_RETENTION_DAYS` is set in `ecosystem.config.cjs` (every deploy restarts from it) and in the cron's env.
- **CHANGELOG** (in W1.5's commit):
  ```markdown
  ### Closed documents are kept for 7 days

  Closing a tab no longer deletes the document on the server. It is kept for `CLOSED_RETENTION_DAYS` (7) and can be restored; then the daily retention purge deletes and tombstones it.

  #### Added
  - `POST /api/documents/restore` and `GET /api/documents/closed` (turn the list off with `CLOSED_DOCUMENTS_LIST=0`).
  - `scripts/delete-document.ts` deletes and tombstones one document at once, for takedowns.

  #### Changed
  - `DELETE /api/documents/[id]` closes softly. Closed documents count toward `MAX_TOTAL_DOCUMENTS` until they are purged.

  #### Deploy
  - Confirm the daily `bun run scripts/purge-retention.ts` cron runs on the host, with `CLOSED_RETENTION_DAYS` in its env. Without it, closed documents are hidden after 7 days but never deleted.
  - No migration: `document_closures` is created on first use; `documents` is unchanged.
  - `ecosystem.config.cjs` now sets `CLOSED_RETENTION_DAYS` for `editor-next`. Deploy with `gh workflow run deploy.yml`.
  - Closing no longer frees `MAX_TOTAL_DOCUMENTS` capacity for 7 days. To free it, or to take content down, run on the host: `cd /opt/projects/editor.docs.plus && DB_PATH=/opt/projects/editor.docs.plus/db.sqlite bun run scripts/delete-document.ts <id>`.
  - Rollback: older code ignores `document_closures`; documents closed meanwhile stay stored, unlisted, until idle retention removes them (30 days). Browsers already holding W1b bundles show Undo, which then fails with "Check your connection." This is acceptable for a rollback window.
  ```

#### Task W1.1: Closed-documents store, purge and operator delete

**Files:**
- Modify `lib/security/activity-store.ts`: `bootstrapDocumentActivityTable` adds the table and `CREATE INDEX IF NOT EXISTS document_closures_tabs_closed_at ON document_closures (tabs_doc, closed_at)`; `deleteDocumentPermanently` and the loop in `purgeStaleDocuments` also `DELETE FROM document_closures WHERE name = ?`.
- Create `lib/security/closed-documents.ts`.
- Modify `lib/security/guardrail-config.ts` (after `TOMBSTONE_RETENTION_DAYS`): `CLOSED_RETENTION_DAYS = parseEnvInt(process.env.CLOSED_RETENTION_DAYS, 7, 1)` and `CLOSED_DOCUMENTS_LIST = process.env.CLOSED_DOCUMENTS_LIST?.trim() !== "0"`.
- Modify `scripts/purge-retention.ts` (`runRetentionPurge`).
- Create `scripts/delete-document.ts`.
- Modify `ecosystem.config.cjs`: `CLOSED_RETENTION_DAYS: "7"` in `editor-next`'s `env`.
- Tests: create `tests/unit/lib/security/closed-documents.test.ts` and `tests/unit/scripts/delete-document.test.ts`; modify `tests/unit/lib/security/activity-store.test.ts`, `tests/unit/scripts/purge-retention.test.ts` and `tests/unit/lib/security/guardrail-config.test.ts` (add both keys to `ENV_KEYS`).

**Interfaces:**
- Consumes `isTombstoned` and `bootstrapDocumentActivityTable`; `MAX_TAB_TITLE_LENGTH` from `lib/tab-api.ts`; `cleanText` from `lib/clean-text.ts` (F2).
- Produces (`lib/security/closed-documents.ts`):
  ```ts
  export type ClosedDocument = { id: string; title: string; closedAt: number }; // tab-api re-exports it type-only (W1.3)
  export const CLOSED_LIST_LIMIT = 20;
  export function cleanClosedTitle(raw: unknown): string; // "" unless a string; cleanText, then at most MAX_TAB_TITLE_LENGTH code points
  export function closedCutoffMs(nowMs: number, days?: number): number; // nowMs - days*86_400_000, days defaults to CLOSED_RETENTION_DAYS
  export function closeDocumentSoftly(db: Database, name: string, title: string, tabsDoc: string, nowMs?: number): "closed" | "gone";
    // BEGIN IMMEDIATE; "gone" if tombstoned (writes nothing); else upsert the closure and
    // UPDATE document_activity SET last_persisted_at = MAX(last_persisted_at, nowMs) WHERE name = ?
  export function restoreClosedDocument(db: Database, name: string, cutoffMs: number, nowMs?: number): "restored" | "not_closed" | "gone";
    // BEGIN IMMEDIATE; "gone" when tombstoned or closed_at < cutoffMs (the row stays for the purge);
    // else delete the closure and set document_activity.last_persisted_at = nowMs
  export function listClosedDocuments(db: Database, tabsDoc: string, cutoffMs: number, limit?: number): ClosedDocument[];
    // tabs_doc = ?, closed_at >= cutoff, not tombstoned, EXISTS a documents row; newest first
  export function purgeClosedDocuments(db: Database, cutoffMs: number, batchSize?: number, nowMs?: number): { deletedCount: number; deletedNames: string[] };
    // loops batches of batchSize until none remain; each batch one BEGIN IMMEDIATE deleting the
    // documents, document_activity and document_closures rows and upserting a tombstone at nowMs
  ```
- `runRetentionPurge(db, { …, closedRetentionDays?: number })` returns `{ deletedCount, deletedNames, closedNames: string[] }` and runs the closed purge first.
- `scripts/delete-document.ts` exports `runDeleteDocument(db, id): "deleted" | "missing" | "invalid"`: "invalid" when `!isValidUserDocumentId(id) || isSystemDocumentId(id)`; otherwise `deleteDocumentPermanently`. The CLI exits 2 on "invalid" and logs `document_deleted_by_operator { id, existed }`.

- [ ] **Step 1: Write the failing tests.** All use an in-memory DB with `CREATE TABLE documents (name TEXT PRIMARY KEY, data BLOB)` plus `bootstrapDocumentActivityTable`; seed a `documents` row for each closed name unless a test says otherwise.
  - `closes a document without touching its stored state`: `closeDocumentSoftly(db, "a", "Notes", "global-tabs", 1000)` returns `"closed"`; the `documents` row is still there; `listClosedDocuments(db, "global-tabs", 0)` equals `[{ id: "a", title: "Notes", closedAt: 1000 }]`.
  - `closing refreshes activity`: activity `last_persisted_at` 0 becomes 1000; a later activity value of 5000 stays 5000.
  - `cleans titles`: `cleanClosedTitle("x".repeat(300))` has 200 code points; `cleanClosedTitle("\u202EPlan\u0000")` is `"Plan"`; `cleanClosedTitle(5)` is `""`.
  - `lists newest first, at most 20, inside the window`: after 25 closures at 1…25, `list("global-tabs", 0)` has length 20 and `[0].closedAt === 25`; `list("global-tabs", 10)` has no entry below 10.
  - `lists only the caller's tab list`: a closure under `global-tabs-w1` is absent from `list("global-tabs", 0)` and present in `list("global-tabs-w1", 0)`.
  - `hides closures without a stored document`: a closure whose name has no `documents` row is not listed.
  - `hides tombstoned names and refuses their restore`: the list excludes the name; restore returns `"gone"`.
  - `closing a tombstoned name writes nothing`: returns `"gone"`, and there is no closure row.
  - `restore deletes the closure and refreshes activity`: with activity 0, `restoreClosedDocument(db, "a", 0, 5000)` returns `"restored"` and sets 5000; a second call returns `"not_closed"`.
  - `restore past the window is gone`: closed at 1000, cutoff 2000 → `"gone"`, and the closure row is still present.
  - `purge tombstones closures older than the cutoff, in batches`: closures `a`@1000, `b`@1100, `c`@9000; `purgeClosedDocuments(db, 5000, 1, 10000)` returns `deletedNames` `["a", "b"]`; neither has a `documents`, activity or closure row; both tombstones have `deleted_at` 10000; `c` is untouched.
  - activity-store: `deleteDocumentPermanently removes the closure row`; `purgeStaleDocuments removes the closure row of a purged document`.
  - purge-retention, `closed documents are tombstoned after CLOSED_RETENTION_DAYS`: close at 0; `runRetentionPurge(db, { nowMs: 6 * DAY })` writes no tombstone; `{ nowMs: 7 * DAY + 1 }` gives `closedNames` `[id]` and a tombstone row.
  - guardrail-config: `CLOSED_RETENTION_DAYS` defaults to `7`, `"3"` gives `3`, `"-1"` gives `7`; `CLOSED_DOCUMENTS_LIST` defaults to `true`, `"0"` gives `false`.
  - delete-document: `runDeleteDocument(db, uuid)` returns `"deleted"`, writes a tombstone and removes the closure row; `"../x"` and `"playground"` return `"invalid"`.
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/lib/security tests/unit/scripts`. Expected: module not found for `closed-documents` and `delete-document`, and assertion failures in the three modified files.
- [ ] **Step 3: Implement** the Interfaces above.
- [ ] **Step 4: Run them and watch them pass.** The same command, then `bun run typecheck`.
- [ ] **Step 5: Commit** (Global commit review): `feat(server): store closed documents and purge them after 7 days`

#### Task W1.2: Close, restore and list routes

**Files:**
- Create `lib/security/http-route-guards.ts`: the 429 response, the busy-retry loop and the bounded JSON body reader that `app/api/documents/[id]/route.ts` needs, shared by the three routes.
- Modify `app/api/documents/[id]/route.ts`: `deleteWithRetry` becomes `withBusyRetry(() => closeDocumentSoftly(…))`; log `document_closed`.
- Create `app/api/documents/restore/route.ts` and `app/api/documents/closed/route.ts`.
- Modify `Makefile`: `dev-next` runs `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 bun next dev` (Decision 3).
- Test: create `tests/unit/api/documents-close-restore.test.ts`. It sets `process.env.DB_PATH` to a temp file and loads the routes with `importFresh`. `documents-delete-rate-limit.test.ts` stays green unchanged (it uses invalid ids). The only other test that assumes a hard delete is the `offline-copies` one below.
- e2e: create `tests/e2e/helpers/closed-documents.ts`; modify `tests/e2e/offline-copies.spec.ts` ("a document deleted while away disappears and its copy is removed" assumed DELETE tombstones).

**Interfaces:**
- Produces:
  ```ts
  export function rateLimitedResponse(decision: RateLimitDecision, fields: { ip: string; route: string; event: string }): NextResponse; // 429 + Retry-After, logs `event`
  export function withBusyRetry<T>(run: () => T, attempts?: number /* 3 */): T;
  export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown | undefined>;
    // undefined unless content-type is application/json, the streamed body stays within maxBytes
    // (counted while reading; cancels the stream past it) and it parses
  // DELETE /api/documents/[id]: body {"title": string, "tabsDoc": string}, read with readJsonBody(request, 1024)
  //   200 { closed: boolean } (false = already tombstoned) · 400 system/invalid id · 429 · 500
  // POST /api/documents/restore: body {"ids": string[]} (1..MAX_TABS_PER_CLIENT, each a valid user id), readJsonBody(request, 4096)
  //   200 { results: Record<string, "restored" | "not_closed" | "gone"> } · 400 bad body or any invalid/system id · 429 · 500
  //   one limiter unit per request; logs `document_restored` per restored id
  // GET /api/documents/closed?tabs=<tabsDoc>: 200 { documents: ClosedDocument[]; retentionDays: number; disabled: boolean },
  //   header Cache-Control: no-store; `export const dynamic = "force-dynamic"` · 429
  ```
- e2e helper (`tests/e2e/helpers/closed-documents.ts`), using `openSqlite()` on the Playwright process's `DB_PATH`:
  ```ts
  export function backdateClosure(id: string, closedAt: number): void; // UPDATE one row only: never a global future-nowMs purge (other workers' closures)
  export function runRetentionPurgeScript(): void; // Bun.spawnSync(["bun", "run", "scripts/purge-retention.ts"], { cwd: repo root, env: process.env }), expect exitCode 0
  export function isTombstoned(id: string): boolean;
  ```

- [ ] **Step 1: Write the failing tests.** The id is `11111111-1111-4111-8111-111111111111`, with a seeded `documents` row.
  - `DELETE closes softly and keeps the stored document`: body `{"title":"Plan","tabsDoc":"global-tabs"}` returns 200 `{ closed: true }`; the `documents` row exists, no tombstone, closure title `"Plan"`.
  - `DELETE without a body records an empty title in global-tabs`.
  - `DELETE ignores an oversized, chunked, non-JSON or malformed body`: a 2 KiB body sent as a `ReadableStream` with no `content-length`, a `text/plain` body, `{"title":` and `{"title":5}` each give 200 and title `""`.
  - `DELETE keeps an isolated tabsDoc only when isolation is allowed`: with `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1`, `global-tabs-w1` is stored; without it, `global-tabs`.
  - `restore returns restored, then not_closed`: two POSTs with `{ ids: [id] }` give `{ results: { [id]: "restored" } }`, then `"not_closed"`.
  - `restore of a tombstoned id is gone`.
  - `restore of a close older than CLOSED_RETENTION_DAYS is gone before the purge runs`: seed `closed_at = now − 8 days`, no tombstone; the result is `"gone"`, and GET closed does not list it.
  - `restore restores a batch in one request`: three closed ids in one POST all come back `"restored"`, and the limiter counted one request.
  - `restore refuses a bad body`: `{ ids: ["playground"] }`, `{ ids: [] }`, `MAX_TABS_PER_CLIENT + 1` ids and `text/plain` each return 400.
  - `GET closed lists recent closes without caching`: the body equals `{ documents: [{ id, title: "Plan", closedAt: expect.any(Number) }], retentionDays: 7, disabled: false }`; `Cache-Control` is `"no-store"`.
  - `GET closed is empty when CLOSED_DOCUMENTS_LIST=0`: `{ documents: [], retentionDays: 7, disabled: true }`; restore still works.
  - `restore and list return 429 past HTTP_MUTATION_RATE_LIMIT`: with the env `"1"`, the second call of each returns 429 with `Retry-After`.
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/api`. Expected: the new file fails (missing routes, and DELETE still tombstones); the rate-limit file passes.
- [ ] **Step 3: Implement** the routes and the Makefile change.
- [ ] **Step 4: Run them and watch them pass.** `bun test tests/unit/api && bun run typecheck && bun run check`.
- [ ] **Step 5: Update the "deleted while away" e2e.** After `page.request.delete`, also `backdateClosure(id, Date.now() - 8 * 86_400_000)` and `runRetentionPurgeScript()`; the rest is unchanged (the tab is dropped on reconnect and the copy is removed). Run `bun playwright test tests/e2e/offline-copies.spec.ts --project=chromium`, then the CI e2e command: all green.
- [ ] **Step 6: Commit** (Global commit review): `feat(api): soft-close documents and add restore and recently closed routes`

#### Task W1.5: Runbook, README, CHANGELOG

**Files:**
- Modify `docs/operations/abuse-guardrails-runbook.md`:
  - env list: `CLOSED_RETENTION_DAYS=7`, `CLOSED_DOCUMENTS_LIST`;
  - "Taking Content Down": closing is restorable by anyone for 7 days, so never close abusive content from the tab bar; use the `delete-document.ts` command from the Deploy note;
  - Scheduled Jobs: the purge also tombstones closed documents, and the cron needs `CLOSED_RETENTION_DAYS`;
  - closed documents count toward `MAX_TOTAL_DOCUMENTS` during the window;
  - the restore and list limiters, and the `CLOSED_DOCUMENTS_LIST=0` kill switch.
- Modify `README.md`: the `CLOSED_RETENTION_DAYS` and `CLOSED_DOCUMENTS_LIST` rows in the config table.
- Modify `CHANGELOG.md` and `tests/TESTING.md`.

- [ ] **Step 1: Write the docs and the CHANGELOG entry above.**
- [ ] **Step 2: Run the full gate.** `bun run check && bun run lint && bun run typecheck && bun run test && bun next build`, then the CI e2e command on this PR's dev servers.
- [ ] **Step 3: Commit** (Global commit review): `docs: document soft-closed documents and operator deletes`

---

### PR W1b: Undo and Recently closed (UI)

- **Branch:** `feat/tab-close-undo` (from `main` after W1a merges)
- **PR title:** `feat(tabs): offer Undo after closing a tab and add Recently closed`
- **Lens:** SE+UX
- **Design review:** the pill and the Recently closed menu (flag Decision 13 for the owner).
- **CHANGELOG** (in W1.4's commit):
  ```markdown
  ### Closing a tab can be undone

  Closing a tab or closing all tabs shows an Undo pill for 5 s, and Recently closed in the tab bar restores any tab closed in the last 7 days.

  #### Added
  - Undo after closing one tab or all tabs.
  - Recently closed in the tab bar. Anyone using the sandbox can see and restore these tabs.
  ```

#### Task W1.3: Tab API and `useSyncedTabs`: Undo and restore

**Files:**
- Modify `lib/tab-api.ts`: `deleteDocument` becomes `closeDocument`; add the `ClosedDocument` type re-export, `restoreDocuments`, `fetchClosedDocuments` and `formatClosedAgo`.
- Modify `hooks/use-synced-tabs.ts`: `closeTab`, `closeAllTabs`, a new `restoreTabs`, and the `UseSyncedTabsReturn` fields.
- Modify `lib/analytics.ts`: add `tab_restore: { restored_count: number }`.
- Tests:
  - Modify `tests/unit/hooks/use-synced-tabs.test.ts`: add a `mock.module("@/lib/announce-later", …)` spy that spreads the real module before the `await import()`, and stub `globalThis.fetch`.
  - Modify `tests/unit/lib/tab-api.test.ts`.
  - Modify `tests/unit/helpers/tab-api.test.ts`: it imports `deleteDocument`; rename to `closeDocument` and assert the JSON body.

**Interfaces:**
- Consumes W1a's routes (W1.2 Interfaces) and `ClosedDocument` (W1.1).
- Produces:
  ```ts
  export type { ClosedDocument } from "@/lib/security/closed-documents"; // type-only: no server code in the client bundle
  export async function closeDocument(id: string, title: string, signal?: AbortSignal): Promise<boolean>;
    // DELETE with JSON { title, tabsDoc: getGlobalTabsDoc() }; ok || 404
  export async function restoreDocuments(ids: string[], signal?: AbortSignal): Promise<Record<string, "restored" | "not_closed" | "gone"> | null>;
    // one POST /api/documents/restore; null on a network error or a non-200
  export async function fetchClosedDocuments(signal?: AbortSignal): Promise<{ documents: ClosedDocument[]; retentionDays: number; disabled: boolean } | null>;
    // GET /api/documents/closed?tabs=<getGlobalTabsDoc()>
  export function formatClosedAgo(closedAt: number, nowMs: number): string;
  // UseSyncedTabsReturn gains:
  restoreTabs: (tabs: readonly { id: string; title: string; index?: number }[]) => Promise<void>;
    // index: Undo's old raw index; absent: append (Recently closed)
  ```
- Pinned copy:
  - Close pill: `Closed “${title || "Untitled"}”`, action `{ label: "Undo" }`.
  - Close-all pill: `Closed ${n} tabs`, action `{ label: "Undo" }`.
  - Restore failures: at the cap, `Maximum tabs reached (${MAX_TABS_PER_CLIENT}). Close a tab to restore “${title}”.` with no request sent; gone, `“${title}” can no longer be restored.` (or `${n} tabs can no longer be restored.`); null result, `Couldn't restore “${title}”. Check your connection.`
- Behaviour:
  - `closeTab` and `closeAllTabs` delete **every** raw entry with a closed id in one `ydoc.transact` (no ghost tab after concurrent restores).
  - A tab is inserted only for a `"restored"` result, and only when `findRawTabIndex(arr.toArray(), id) < 0`, all in one `ydoc.transact`. Undo puts it back at its old raw index, clamped to `[1, arr.length]` so Playground stays at 0; Recently closed appends at the end.
  - `"not_closed"` (another visitor restored it first) inserts nothing; the tab arrives through the shared list.
  - The restored tab (or, for close-all, the first one) becomes active.

- [ ] **Step 1: Write the failing tests.**
  - tab-api, `formatClosedAgo`: `(0, 30_000)` → `"just now"`; `(0, 5 * 60_000)` → `"5 min ago"`; `(0, 3 * 3_600_000)` → `"3 h ago"`; `(0, 2 * 86_400_000)` → `"2 d ago"`.
  - tab-api, `restoreDocuments returns the results, and null on a network error or a 500`.
  - tab-api, `closeDocument sends the title and the tabs document`.
  - hook, `closeTab soft-deletes with the title, removes the tab and offers Undo`: with tabs `[playground, A("A"), B]`, fetch gets `("/api/documents/A", objectContaining({ method: "DELETE", body: '{"title":"A","tabsDoc":"global-tabs"}' }))`; ids become `[PLAYGROUND_ID, "B"]`; `announceLater` gets `("Closed “A”", { action: { label: "Undo", run: expect.any(Function) } })`.
  - hook, `closeTab removes duplicate entries of the closed id`: with A present twice, both go in one transaction.
  - hook, `Undo restores the tab at its old index and makes it active`: `action.run()` POSTs `{ ids: ["A"] }` to `/api/documents/restore`; ids become `[PLAYGROUND_ID, "A", "B"]` and `activeTabId` is `"A"`.
  - hook, `a restore racing a remote restore leaves one entry`: a remote doc inserts A and is synced in before the POST resolves with `"not_closed"`; afterwards `tabs.filter(t => t.id === "A").length` is 1.
  - hook, `restore at the tab cap sends no request`: with `MAX_TABS_PER_CLIENT` tabs open, no fetch to `/restore`, and the cap message is announced.
  - hook, `a gone restore announces it and leaves the list unchanged`.
  - hook, `closeAllTabs offers one Undo that restores every closed tab in one request`: one POST with all ids; a partial result (one `"gone"`) restores the rest and announces the gone one.
- [ ] **Step 2: Run them and watch them fail.** `bun test tests/unit/hooks/use-synced-tabs.test.ts tests/unit/lib/tab-api.test.ts tests/unit/helpers/tab-api.test.ts`. Expected: the new tests fail (`restoreTabs`, `formatClosedAgo` and `closeDocument` are undefined).
- [ ] **Step 3: Implement.** `closeTab` keeps `forgetLocalCopy(id)` after success (Decision 14) and calls `announceLater` only after the tab is removed.
- [ ] **Step 4: Run them and watch them pass.** The same command, then `bun run test && bun run typecheck`.
- [ ] **Step 5: Commit** (Global commit review): `feat(tabs): offer Undo after closing a tab and restore closed tabs`

#### Task W1.4: Recently closed menu and e2e

**Files:**
- Modify `components/tab-bar/tab-bar.tsx`: an `onRestore` prop, and the button after Close all.
- Create `components/tab-bar/recently-closed-menu.tsx`: the lazy shadcn `DropdownMenu` body, loaded with `next/dynamic({ ssr: false })` and prefetched on the trigger's `pointerenter` / `focus`.
- Modify `components/tab-bar/tab-bar.scss`.
- Modify `components/editor-app/editor-app.tsx`: pass `restoreTabs` down.
- Modify `lib/icons.tsx`: export `History as HistoryIcon`.
- Create `tests/e2e/tab-close-undo.spec.ts` (uses W1a's `tests/e2e/helpers/closed-documents.ts`).
- Modify `CHANGELOG.md` and `tests/TESTING.md`.

**Interfaces:**
- Consumes W1a's `backdateClosure`, `runRetentionPurgeScript` and `isTombstoned` (W1.2), and W1.3's `fetchClosedDocuments`, `formatClosedAgo` and `restoreTabs`.
- Trigger: `aria-label="Recently closed"`, same `title`; disabled offline with `OFFLINE_TAB_ACTION_HINT`.
- Menu states: loading `Loading…`; failure `Couldn't load. Check your connection.`; empty `Nothing closed recently` (a disabled item); `disabled: true` from the server, `Recently closed is turned off on this server.` (a disabled item).
- Each item shows `title || "Untitled"` with the muted `formatClosedAgo`.
- Footer, muted: `Closed tabs are kept for ${retentionDays} days. Anyone using this sandbox can see and restore them.`
- First-load JS for `/` in the `bun next build` output grows by no more than 0.3 KB; the menu body stays lazy.

- [ ] **Step 1: Write the failing e2e tests.** Each uses a unique title, `Undo me ${nonce}`, typed into the title heading after `EditorPage.goto()` and `waitForSync()`.
  - `closing a tab shows Undo, and Undo brings it back with its text`: after Close (`/^Close /`) the tab count for that id is 0; `[data-status-pill]` contains `Closed “Undo me`; clicking the button named `/^Undo: Closed/` puts the tab back in the same `data-tab-id` order, and `.tiptap` contains the marker.
  - `text typed just before closing survives Undo`: type `late-marker`, click Close at once (no wait for sync); after Undo and `waitForSync()`, `.tiptap` contains `late-marker`.
  - `Recently closed restores a tab after the pill is gone`: close, reload, open Recently closed and click the item with the title; the tab returns with its content.
  - `a closed tab is deleted for good after the closed window`: close, `backdateClosure(id, Date.now() - 8 * 86_400_000)`, `runRetentionPurgeScript()`; `isTombstoned(id)` is true; `page.request.post("/api/documents/restore", { data: { ids: [id] } })` returns `{ results: { [id]: "gone" } }`; Recently closed no longer lists the title.
- [ ] **Step 2: Run them and watch them fail.** `bun playwright test tests/e2e/tab-close-undo.spec.ts --project=chromium` on this PR's dev servers. Expected: Recently closed is not found (the pill exists once W1.3 is in the branch).
- [ ] **Step 3: Implement** the button and the lazy menu.
- [ ] **Step 4: Run them and watch them pass.** The same command, then `bun playwright test --project=chromium tests/e2e/tabs.spec.ts`, then the CI e2e command.
- [ ] **Step 5: Check in the app** on this PR's dev servers: close a user tab; the pill appears under the toolbar and holds while hovered; Recently closed shows the item, the "x min ago" text and the footer. Take the design-review screenshots (the 375 px ones with the `resize_window` mobile preset).
- [ ] **Step 6: Docs and gate.** Add the CHANGELOG entry and the new spec to `tests/TESTING.md`. Run `bun run check && bun run lint && bun run typecheck && bun run test && bun next build` (record the First-load JS for `/`).
- [ ] **Step 7: Commit** (Global commit review): `feat(tab-bar): add Recently closed`
