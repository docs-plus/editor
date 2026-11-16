# Codebase audit: what assumes a server, and what local-first desktop needs

Repo: `/Users/macbook/workspace/editor` at `e26065c` (main). Read-only audit; no repo files edited.
Evidence: code reading plus one experiment (a static-export build of a scratch clone, served with no
Hocuspocus and opened in a browser). Line numbers refer to `e26065c`.

Goal under review: an installable desktop build (macOS, Windows, Linux) that works fully offline with
locally stored documents, has a file manager, and offers opt-in sync of a document to Hocuspocus. No
auth. The same codebase keeps serving tiny.docs.plus.

---

## 0. Headline findings

1. **With no server, the app never gets past the intro.** `useSyncedTabs` becomes `ready` only through
   `onSynced` (hooks/use-synced-tabs.ts:70). That fires only when `isSessionReady`
   (lib/collab-session.ts:281-283) is true: the provider synced, or a device copy of `global-tabs`
   exists. On a fresh install neither is true. **Verified:** the static export served on
   127.0.0.1:4599 with no Hocus showed the SEO intro plus "You're offline. TinyDocy opens your
   documents when you reconnect." indefinitely. No `.app-shell` or `.document-editor` ever mounted.
2. **A document never renders without a server or a device copy.** `DocumentEditor` shows a skeleton
   while `!synced || !ydoc || !provider` (components/document-editor/document-editor.tsx:418).
   A brand-new local document has no copy, so it never
   renders. That is why the tab bar disables New tab offline (components/tab-bar/tab-bar.tsx:42-43,
   191, 197, 306).
3. **Seeding waits for the server** (components/document-editor/use-document-editor-effects.ts:88-107;
   `serverSynced` gate at :91). A local-only document would stay empty and title-less.
4. **Local-only editing hits the 512 KiB "offline budget" and goes read-only.** `offlineBytes` grows on
   every local update while `!provider.isSynced` (lib/collab-session.ts:164-173), and only `synced`
   resets it (:153-160). Without a server that never happens. Pasted images are embedded as data URLs
   (components/tiptap-node/image-upload-node/upload-utils.ts:34). The cap applies to the length of
   the data URL itself: `dataUrlLength` (lib/image-downscale.ts:36-38, 63-65, 129, 168) checks it
   against `NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES`, default 256 KiB. So about two full-size images, or
   roughly 20k keystrokes, freeze a local document.
5. **`dirty` never clears without a server.** It clears only on `unsyncedChanges === 0`
   (lib/collab-session.ts:176-178), and it is set by any local edit (:164-167). This is the designed
   offline behaviour today, so that unsynced edits are never dropped. With no server it becomes
   permanent for every **edited** document:
   - `releaseCollabSession` re-arms a 5 s recheck forever (:227-230), so the document's Y.Doc and
     provider leak for the life of the window.
   - `useUnsyncedChangesGuard` keeps a permanent `beforeunload` prompt
     (components/editor-app/editor-app.tsx:54-71).
6. **Local storage is a cache, not primary storage.** Things that would delete or orphan primary data:
   - The 14-day expiry (lib/offline/local-doc-store.ts:15, 76-81, 122-130).
   - The 30-document cap with least-recent eviction (:17, 230-239).
   - Copies of documents not in the tab list are swept (lib/offline/offline-cache.ts:56-63, called from
     hooks/use-synced-tabs.ts:87-92).
   - Keys are scoped to the collab server host (offline-cache.ts:19-25, 41;
     local-doc-store.ts:50-57), so changing the sync server orphans every document.
   - Bumping `OFFLINE_CACHE_EPOCH` (local-doc-store.ts:7) wipes everything.
   - `NEXT_PUBLIC_OFFLINE_CACHE=0` deletes the whole database (offline-cache.ts:31-38).
7. **A server-side deletion deletes the local document.** On `document_deleted`, the client detaches,
   destroys the binding and calls `removeLocalCopy(name)` (lib/collab-session.ts:190-195). Two paths
   reach it:
   - The retention purge tombstones any document idle 30 days (`RETENTION_DAYS`,
     scripts/purge-retention.ts:15-29).
   - Any anonymous visitor can delete any user document by id through
     `DELETE /api/documents/[id]` (app/api/documents/[id]/route.ts:39-95; there is no auth by
     design).

   For desktop, either path would silently erase a user's local file.
8. **A hydrate timeout can overwrite the stored copy and lose offline edits.** From code reading; not
   reproduced. If IndexedDB (or a future file backend) takes over 1 s (`HYDRATE_TIMEOUT_MS`,
   lib/collab-session.ts:48), the first binding is destroyed and rebuilt with `hydrate: false`
   (:259-268). The late copy is then never applied: the first binding is `destroyed`, and the
   `.then` returns because `attached` (:269-271). The rebuilt binding's `onUpdate` filters only
   `LOCAL_ORIGIN` (local-doc-store.ts:293-297), so the server's sync update (origin `provider`)
   schedules a save. About 750 ms later, `put` writes the server-only state over the stored copy
   (:284-292). Any edits the copy held from an earlier offline session, not yet on the server, are
   gone. Today this is a latent web bug. With no server, the session never becomes ready, so nothing
   can be overwritten. Once desktop readiness becomes "hydrated", though, a slow read followed by any
   write is a direct loss path. Primary storage must never write before the first read resolves.
9. **"Can't sync" and "can't edit" are one field.** `rejectedReason` covers size, deleted, offline
   budget, outdated client and schema refused. `editor.setEditable(reason === null)`
   (document-editor.tsx:181, 233) makes every sync refusal a read-only
   document. Local-first needs separate sync state and editability.
10. **Mounting the app opens a socket.** Two places do it:
   - `getSharedHocuspocusSocket()` connects on first call (lib/hocuspocus.ts:58-63).
   - `useConnectionState` calls it on subscribe (hooks/use-connection-state.ts:35-36), and it is
     mounted by `EditorApp` (editor-app.tsx:98) and `UserIdentityButton`
     (components/tiptap-ui/user-identity-button.tsx:133).

   A desktop with sync off would dial `ws://127.0.0.1:1234` and retry with backoff forever.
11. **Static export works after small edits and one removal.** All edits below were made only in the
   scratch clone. Details are in §1.3.
   - Metadata routes need `export const dynamic = "force-static"`. Four failed in the build
     (`robots.txt`, `manifest.webmanifest`, `opengraph-image`, `icon`). I added it to three more
     alongside them without seeing them fail first (`sitemap.xml`, `apple-icon`, `pwa-icons/[id]`).
   - `app/api/documents/[id]` must be removed from the desktop build.
   - `headers()` is not applied: the build warns twice and the headers are absent. CSP and the other
     security headers move to the shell.

---

## 1. Server dependencies

### 1.1 Routes, SSR and metadata

| File | Server assumption | Desktop change needed |
|---|---|---|
| `app/api/documents/[id]/route.ts:39-95` | Only mutating HTTP route. `DELETE` opens SQLite (`openSqlite`, :75), writes a tombstone (`deleteDocumentPermanently`), per-IP rate limit (:21-24, :45). Requires the same `DB_PATH` as Hocus. | **Hard export blocker** (see 1.3). Desktop needs a local delete. For a synced doc, decide explicitly whether "delete" also deletes on the server (today it is an anonymous, unauthenticated tombstone). Option: move this endpoint into the Hocus process (`scripts/hocus-server.ts` already runs `Bun.serve`, :218+). That makes the Next app static for both targets and removes the shared-`DB_PATH` coupling. Web would then reach it through the proxy, or with CORS plus an origin check. |
| `lib/tab-api.ts:151-164` | `deleteDocument` does `fetch('/api/documents/…', {method: 'DELETE'})`, a same-origin relative URL. | Goes behind a `DocumentIndex`/`DocumentStore` interface: local delete on desktop. Server delete only when the doc is synced, and only to the configured sync server URL, not a relative path (relative resolves to `app://` in a shell). |
| `hooks/use-synced-tabs.ts:156-189, 191-278` | `closeTab` and `closeAllTabs` refuse to remove a tab unless the DELETE succeeds (`alert("Could not close tab")`, :172-175). | Local close and delete must never depend on the network. |
| `app/page.tsx:1-11` | Server component: `SiteJsonLd` plus `EditorApp intro={<SiteIntro />}` (SEO copy). | Prerenders fine in export. Desktop should not show marketing intro or JSON-LD: pass a neutral splash or the file manager under a build target flag. |
| `app/layout.tsx` | `metadataBase: new URL(SITE_URL)` (:27), canonical/OG/Twitter (:26-50), `next/font/google` Inter (:24, self-hosted at build, fine offline). Inline `THEME_BOOT_SCRIPT + INSTALL_PROMPT_CAPTURE_SCRIPT` (:67-72). `<GoogleAnalytics />` (:74) and `<ServiceWorkerRegistration />` (:75). | Works in export. On desktop:<br>- Drop the install-prompt script and the install button (`components/pwa/install-app-button.tsx`).<br>- Drop the SW registration.<br>- Do not set `NEXT_PUBLIC_GA_MEASUREMENT_ID`.<br>The inline script needs `'unsafe-inline'` or a hash in the shell CSP. |
| `components/app-skeleton/app-skeleton.tsx` | Server-rendered shell. Fine in export (prerendered at build). | No change. It is pure markup. |
| `app/manifest.ts`, `app/robots.ts`, `app/sitemap.ts` | Dynamic metadata routes by default. | Need `export const dynamic = "force-static"` (export build error otherwise). Web-only artefacts: irrelevant on desktop, harmless to keep. |
| `app/icon.tsx`, `app/apple-icon.tsx`, `app/opengraph-image.tsx` | `ImageResponse` metadata images, dynamic by default. | Need `force-static`. They emit **extension-less** files (`out/icon`, `out/apple-icon`, `out/opengraph-image`), so a custom protocol handler must set `image/png` explicitly. Desktop app icons come from the packager anyway. |
| `app/pwa-icons/[id]/route.tsx` | `generateStaticParams` plus `dynamicParams = false`. | Emitted as `pwa-icons/any-192` and similar (SSG). I added `force-static` in the clone before checking whether it was strictly needed. Web-only. |
| `app/llms.txt/route.ts` | Already `force-static`. | Fine. |
| `app/offline/page.tsx` | Copy says "needs a connection to open shared documents". Precached by the SW. | Not used on desktop (no SW). |
| `app/about`, `app/privacy` | Static pages; privacy copy describes the web deployment. | Fine in export. Desktop needs its own privacy text if it ships one. |
| `app/error.tsx:20`, `components/pwa/retry-button.tsx:6`, `document-notice.tsx:71` | `location.reload()` as the recovery or update path. | Reload works in a shell. "Reload to get the newer version" does not update a desktop app (see §4). |

### 1.2 next.config.ts, headers and CSP

| File:line | Assumption | Change |
|---|---|---|
| `next.config.ts:34-62` | All security headers come from `headers()`: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, CSP. | With `output: 'export'`, Next warns twice ("Specified "headers" will not automatically work…", then "rewrites, redirects, and headers are not applied when exporting") and drops them. The shell must inject the same headers in its protocol handler (Electron `protocol.handle` / `session.webRequest.onHeadersReceived`; Tauri custom protocol response headers or `app.security.csp`). `frame-ancestors` and `X-Frame-Options` cannot be set from `<meta>`. Reuse `buildContentSecurityPolicy` from the shell build so one source stays canonical. |
| `lib/security/content-security-policy.ts:51-56` | `connect-src` holds exactly one collab origin (`NEXT_PUBLIC_HOCUS_URL`) fixed at build time. | Desktop lets the user pick a sync server at runtime, so the CSP must be built at runtime by the shell from the configured server list (or `connect-src ws: wss:` with an in-app allowlist; weaker). |
| `next.config.ts:9-29` | `NEXT_PUBLIC_BUILD_ID` from `git rev-parse`. | Fine; desktop should set it explicitly to the app version (it is logged server-side as `build=`). |
| `lib/security/content-security-policy.ts:42-47` | `'unsafe-inline'` scripts kept because the SW stores HTML (comment :44-45). | Desktop has no SW, so it could move to hashes for the one inline boot script. Optional hardening. |

### 1.3 `output: 'export'`: what breaks (verified)

A throwaway clone of `main` (not kept),
Next 16.4.6 Turbopack, `output: "export"` added to `next.config.ts`. Errors found by iterating:

| Round | Error | Fix applied in the clone |
|---|---|---|
| 0 | `Module not found: cmdk` | Not export-related: the main checkout's `node_modules` is stale (no `cmdk` 1.1.1). `bun install --frozen-lockfile` in the clone fixed it. Note for the owner: a plain `bun run build` in this checkout would fail the same way. |
| 1 | `export const dynamic = "force-static"/export const revalidate not configured on route "/robots.txt"` (and `/manifest.webmanifest`) | Added `force-static` to `robots.ts`, `sitemap.ts`, `manifest.ts`. |
| 2 | `Page "/api/documents/[id]" is missing "generateStaticParams()" so it cannot be used with "output: export"` | Removed `app/api/` from the clone. **No in-place workaround:** a DELETE handler can never be static. |
| 3 | Same `force-static` error for `/opengraph-image` and `/icon` | Added `force-static` to `opengraph-image.tsx` and `icon.tsx`, and preemptively to `apple-icon.tsx` and `pwa-icons/[id]/route.tsx` (not seen failing; `sitemap.ts` in round 1 was also preemptive). |
| 4 | **Build succeeded.** 17 static routes, `out/` = 4.9 MB. Warning only for `headers`. | — |

Observations on `out/`:

- **Asset URLs are absolute** (`/_next/static/chunks/….js`, `href="/about"`). `file://` loading breaks, so the shell must serve `out/` from a custom scheme or a loopback server, at the root of a **stable origin**. IndexedDB, localStorage (`tinydocy-user`, `tinydocy-continue`, `tinydocy-folds-*`, `tinydocy-ui`, `tinydocy-choices`, `tinydocy-formats`, `tinydocy-theme`) and any `navigator.storage.persist()` grant are origin-scoped. A port or scheme change between app versions makes every local document vanish.
- Routes are emitted as `about.html` plus RSC payloads `about.txt`, `__next._tree.txt` and others. The protocol handler must map `/about` to `about.html` and serve `.txt` payloads for client navigation.
- The Turbopack service worker **is emitted** (`out/_next/static/service-worker/sw.js`). Desktop should build with `NEXT_PUBLIC_SERVICE_WORKER=0` (components/pwa/service-worker-registration.tsx:14). That actively unregisters, which is harmless. Service workers do not run on most custom schemes anyway.
- The page then behaves as in finding 0.1: stuck on the intro, "You're offline…", one IndexedDB `tinydocy-offline` created and empty.

The export needs no changes to `next/dynamic` (`ssr: false`), `usePathname`, the font, Mermaid, lowlight, or the image downscaler (all client-side).

### 1.4 `NEXT_PUBLIC_*` and other env-driven behaviour (all build-time inlined)

| Variable (read at) | Web meaning | Desktop implication |
|---|---|---|
| `NEXT_PUBLIC_HOCUS_URL` (lib/hocuspocus.ts:21-41; CSP next.config.ts:53-55) | Single collab server, fixed at build. The fallback derives `ws(s)://<page host>/collab` from `window.location` for non-localhost hosts (:32-39). | Must become a **runtime setting** (per document or per app). Under a custom scheme the `location`-derived fallback produces nonsense (e.g. `ws://tauri.localhost/collab` on Windows). |
| `NEXT_PUBLIC_OFFLINE_CACHE` (lib/offline/offline-cache.ts:9-10, 31-38) | `0` disables **and deletes** device copies. | Must never apply to the desktop primary store. Today it would delete the user's documents. |
| `NEXT_PUBLIC_SERVICE_WORKER` (service-worker-registration.tsx:14) | Kill switch. | Set `0` for desktop. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` (lib/analytics-config.ts:32) | Opt-in GA4. `lib/analytics.ts:78-129` uses `window.location` for page location and cookie domain. | Leave unset on desktop. `trackEvent` calls then no-op (they are sprinkled through `use-synced-tabs.ts`, `editor-app.tsx`, `schema-guard.ts`, `user-identity-button.tsx`). |
| `NEXT_PUBLIC_SITE_URL`, `SEO_NOINDEX` (lib/site-config.ts:11) | Canonical origin, robots and sitemap. | Irrelevant. Metadata still names tiny.docs.plus; harmless. |
| `NEXT_PUBLIC_BUILD_ID` (lib/schema-version.ts:15-16) | Sent as `build=` on the socket URL. | Set to the desktop version so the server's `client_schema` log can distinguish desktop builds. |
| `NEXT_PUBLIC_MAX_TABS_PER_CLIENT` (lib/security/guardrail-config.ts:214-218, lib/constants.ts:7) | UI tab cap of 50. | A file manager is not tabs; the cap should not limit how many local documents exist. |
| `NEXT_PUBLIC_MAX_EMBED_IMAGE_BYTES` (lib/image-downscale.ts:38) | 256 KiB per image. | Interacts with the offline budget (finding 0.4) and the server doc cap (`MAX_DOC_SIZE_BYTES` 1 MiB default, 2 MiB prod). |
| `NEXT_PUBLIC_REMEMBER_CHOICES`, `NEXT_PUBLIC_ACTION_PREVIEW`, `NEXT_PUBLIC_DISCORD_INVITE_URL`, `NEXT_PUBLIC_GITHUB_REPO_URL` | UI only. | No server dependency. |
| (new) `NEXT_PUBLIC_APP_TARGET=web\|desktop` | — | Recommended single build-time switch so desktop-only code is dead-code-eliminated from the web bundle, and web-only code (intro, install prompt, SW, GA) from the desktop bundle. |

### 1.5 Analytics, embeds, other network use

- GA4 only after consent (`components/analytics/google-analytics.tsx`). It needs network; leave it off on desktop.
- The X oEmbed lookup (`X_OEMBED_HOST`, CSP :18-23) and iframes for YouTube, Vimeo and others need network. Offline they degrade, but do not block editing.
- Images are embedded as data URLs (upload-utils.ts:34), so there is no upload server. That is good for desktop, but it inflates Yjs state (see the budget and caps).

---

## 2. Document lifecycle today, and what runs with no provider

| Step | Where | How it works today | Works with provider never connected? |
|---|---|---|---|
| **List** | `hooks/use-synced-tabs.ts:60-132`; `lib/hocuspocus.ts:14-19` | The tab list is the shared public Y.Doc `global-tabs`, array `tabs`, map `meta`. Every visitor sees and edits the same list (lib/tab-api.ts:65-76: "nothing in it is trusted"). | **Only if a device copy of `global-tabs` exists** (then `hasLocalCopy` makes it ready). Fresh install: never ready. |
| **Bootstrap** | use-synced-tabs.ts:73-83 | First server sync of an empty list inserts Playground plus one Untitled, or migrates legacy `tinydocy-tabs` from localStorage. | No: gated on `serverSynced` (:75-76). |
| **Create** | use-synced-tabs.ts:140-154; `generateId()` = `crypto.randomUUID()` (tab-api.ts:24-26) | Pushes a `{id,title,createdAt}` into the shared array. The server creates the document on first connect (`onLoadDocument`, scripts/hocus-server.ts:186-207, rate-limited by `canCreateDocument`). | The id is client-generated (fine offline), but the editor for it never renders (no copy, no sync). The tab bar disables New tab offline (tab-bar.tsx:191, 197, 306). |
| **Name** | document-editor.tsx `onUpdate` → `updateTabTitle` (use-synced-tabs.ts:307-336) | The title is the first heading's text, written into the shared array (debounced 300 ms) only on local edits (`isChangeOrigin`). | Works locally, but titles live **only** in `global-tabs`. No per-document metadata exists, which a file manager needs. |
| **Open** | `hooks/use-yjs-document.ts:26-50` → `acquireCollabSession` (lib/collab-session.ts:125-212) | New Y.Doc plus `HocuspocusProvider` on the shared socket; `attachWithLocalCopy` (:243-278) hydrates from IndexedDB (≤ 1 s), then `provider.attach()`. | Hydration works. Render needs `isSessionReady` (:281), so it works only with an existing copy. |
| **Seed** | use-document-editor-effects.ts:88-107 | When the `default` fragment is empty after a **server** sync: Playground content or `DEFAULT_EDITOR_CONTENT`, with `addToHistory: false`. | No: gated on `serverSynced`. |
| **Edit / save locally** | `bindLocalCopy` (local-doc-store.ts:259-352) | Debounced 750 ms full-state `put`; flushed on `pagehide` and `visibilitychange` (collab-session.ts:321-326). | Yes, but limited by the offline budget (finding 0.4), and the dirty flag never clears (finding 0.5). |
| **Close / delete** | use-synced-tabs.ts:156-189 → `deleteDocument` → `DELETE /api/documents/:id` → tombstone → `forgetLocalCopy` | Server first. The local copy is forgotten only after the server says ok. | No: fails, and the tab bar disables it offline. |
| **Deleted elsewhere** | collab-session.ts:179-196 | `authenticationFailed` with `document_deleted` → detach, destroy the binding, `removeLocalCopy`, read-only notice. | n/a. On desktop this path must **unlink sync**, never delete the local document. |
| **Sweep** | use-synced-tabs.ts:87-92 → `sweepLocalCopies` → `LocalDocStore.prune` (local-doc-store.ts:192-241) | After each server sync of the tab list: drop copies not in the list, expired (14 d), or beyond 30 documents. | Skipped without sync (gated), but it would delete desktop data if it ever ran against a primary store. |
| **Expiry on read** | local-doc-store.ts:122-130 | `read()` deletes a copy older than 14 days **when loading it**. | Runs offline too: a desktop document not opened for 14 days is deleted on next open. **Data loss.** |

**Limits that bite local-first use:**

| Limit | Where | Effect without a server |
|---|---|---|
| `OFFLINE_EDIT_BUDGET_BYTES` 512 KiB | offline-cache.ts:12-13; collab-session.ts:168-172 | Document goes read-only (`offline_budget`) after cumulative local edits. Clears only on server sync. |
| `OFFLINE_DOC_MAX_AGE_DAYS` 14 | local-doc-store.ts:15 | Untouched documents are deleted on load and on prune. Invariant "keep below `TOMBSTONE_RETENTION_DAYS` (90)" (comment :14, scripts/purge-retention.ts:24-26) exists so copies cannot resurrect deleted server documents. Desktop copies live forever, so this invariant no longer holds for synced desktop documents (see §3.3). |
| `OFFLINE_MAX_DOCS` 30 | local-doc-store.ts:17 | The 31st least-recently-saved document is evicted on prune. |
| Server-host key scope | offline-cache.ts:19-25; `storeKey` local-doc-store.ts:50-52 | Documents are bound to one server URL. Switching or removing the server orphans them. |
| `OFFLINE_CACHE_EPOCH` | local-doc-store.ts:7 | A bump discards every copy. Acceptable for a cache; never acceptable for primary data. |
| `HYDRATE_TIMEOUT_MS` 1 s | collab-session.ts:48, 259-268 | A slow store means an empty render, and the next edit overwrites the stored copy (finding 0.8). |
| `RELEASE_DELAY_MS` / `DIRTY_RECHECK_MS` | collab-session.ts:18-21, 219-237 | With `dirty` stuck true, sessions are never destroyed. |
| `OFFLINE_GRACE_MS` 4 s | use-connection-state.ts:11 | With no server, UI says "offline" after 4 s and disables tab actions (tab-bar.tsx). |
| `UNREACHABLE_AFTER_MS` 10 s | editor-app.tsx:22, 115-122 | "Can't reach the collaboration server" notice. |

---

## 3. Seams

### 3.1 Storage backend

`DocStoreBackend` (lib/offline/local-doc-store.ts:33-48) is already the right shape for a byte store:
`get`, `put`, `delete`, `deleteIfUnchanged`, `all`, `clear`. It has two implementations,
`createIndexedDbBackend` (:362-433) and `createMemoryBackend` (:436-454). The problems are not the
interface but what sits on top of it:

| Concern | Where | Change |
|---|---|---|
| Cache policy is baked into `LocalDocStore` | `isCurrent` (:76-81), `prune` defaults (:192-241), epoch, legacy-key merge (:54-57, 132-143) | Split into a **policy** object: `CachePolicy` (web: host-scoped keys, epoch, 14 d, 30 docs, sweep by tab list) and `PrimaryPolicy` (desktop: scope `local`, no expiry, no cap, no sweep, epoch never wipes, migrations instead). |
| Keys tied to the server | `storeKey(serverHost, name)` (:50-52); `serverHost()` in offline-cache.ts:19-25 imports `getHocuspocusWsUrl` | Primary documents keyed by local document id only. The sync server becomes per-document metadata. |
| No metadata listing | `all()` returns full `update` bytes (:46, 427) | A file manager needs `list(): {id, title, updatedAt, byteLength, sync: {enabled, serverUrl, serverName, lastSyncedAt}}` without loading every Yjs state. Add `listMeta()` to the backend, or keep a separate metadata store (index). |
| Singleton chosen at module scope | `getLocalDocStore()` (offline-cache.ts:28-43) | Inject a backend chosen by target: IndexedDB on web; a filesystem backend over IPC (Electron `ipcRenderer.invoke` / Tauri `invoke`) on desktop. IndexedDB inside a desktop webview is acceptable as a first step only if the shell origin is stable and `navigator.storage.persist()` is granted; files are safer and enable backup and export. |
| Full-state rewrite on every save | `bindLocalCopy.write` (:284-292) | Fine for IndexedDB. For files, write to a temp file and rename atomically. Optionally append incremental updates and compact on close. |
| Hydrate timeout fallback | collab-session.ts:259-268 | In primary mode: never fall back to `hydrate:false`. Wait for the store, or show an error. Never write before the first successful read. |

### 3.2 Document index (file manager)

`useSyncedTabs` (hooks/use-synced-tabs.ts) mixes four concerns:

- the list source (the `global-tabs` Y.Doc),
- bootstrap,
- delete via HTTP,
- the active tab (localStorage `tinydocy-tabs`).

Put a `DocumentIndex` interface behind it: `list/subscribe`, `create`, `rename`, `remove`, `reorder`,
`setActive`.

- **Web:** today's `global-tabs` implementation, unchanged.
- **Desktop:** a local index (a local Y.Doc or a plain metadata table in the primary store). It is
  never synced, because `global-tabs` is a **public shared list**, and syncing it would publish the
  user's file list.

`EditorApp` (components/editor-app/editor-app.tsx:78-174) consumes only the hook's return shape, so it
can switch with no UI rewrite. A desktop index must not inherit two web behaviours: `sanitizeTabs` forces the public Playground tab first (lib/tab-api.ts:28-31, 91), and `closeTab` refuses to close it (use-synced-tabs.ts:159). The file manager is a new surface that reads `DocumentIndex`.

### 3.3 Per-document sync switch

The provider is assumed non-null all the way down. That chain is where the switch goes:

| Link | File:line | Today | Change |
|---|---|---|---|
| Session type | lib/collab-session.ts:50-66 | `provider: HocuspocusProvider` always constructed (:133-140) and always attached (:243-278). | `acquireCollabSession(name, { sync })`, with sync state as a sub-object: `sync: null \| { provider, status, blockedReason }`. Readiness = local hydrate done (primary mode) OR server synced. |
| Shared socket | lib/hocuspocus.ts:50-63 | Created eagerly on first `acquire` or `useConnectionState`. | Create lazily on the first sync-enabled session. Desktop with sync off never dials. Support more than one server URL (a socket per server). |
| Connection state | hooks/use-connection-state.ts:35-36, 97-99 | Global, derived from the one socket. Drives "offline" UI and tab-action gating. | Per-document sync status. App-level "offline" should not gate local actions. |
| Hook | hooks/use-yjs-document.ts:14-58 | Returns `provider` and listens to `provider.on('synced')` (:36). | Return `sync` status. `serverSynced` false for local docs is fine if seeding no longer depends on it. |
| Render gate | document-editor.tsx:418 (`!synced \|\| !ydoc \|\| !provider`) | Skeleton until the provider exists and the session is ready. | Drop `!provider`. Ready = hydrated. |
| Editor extensions | components/document-editor/document-editor-config.ts:221-223 (`CollaborationCaret.configure({ provider })`); `useMemo` deps `[documentId, ydoc, provider, …]` at document-editor.tsx:191-205 | Caret extension requires a provider with `awareness`. `editor.commands.updateUser` (use-document-editor-effects.ts:53-56) needs the extension. `useOnlineUsers` reads `editor.storage.collaborationCaret.users` (user-identity-button.tsx:82-97). | Always pass a stable awareness holder (e.g. `{ awareness: new Awareness(ydoc) }` from y-protocols, swapped for the provider's when sync attaches), **with a stable identity**. Changing `provider` in the `useMemo` deps rebuilds the extensions array, and Tiptap then calls `setOptions` with a full Yjs re-sync. AGENTS.md "Typing performance" forbids this. Toggling sync must not remount or rebuild the editor. |
| Seeding | use-document-editor-effects.ts:88-107 | After the first server sync. | Seed **at creation time** in the local store (the index creates the doc with `DEFAULT_EDITOR_CONTENT`), and keep server-gated seeding only for docs first opened from a share link with sync on. |
| Dirty / unsynced guard | collab-session.ts:92-113, 164-178; editor-app.tsx:54-71 | Means "server hasn't acked". | For local docs: "local store hasn't flushed". For synced docs, keep the current meaning but scope it per document. Release must not depend on server ack for local-only docs. |
| Refusals | collab-session.ts:23-42, 179-207; document-notice.tsx:23-35 | Each refusal makes the doc read-only. | Split: `syncBlockedReason` (too large, schema rejected, outdated client, deleted on server, rate-limited) shows a sync banner and keeps local editing; `readOnlyReason` (schema guard `outdated` / `unrepairable`) keeps freezing. `document_deleted` turns sync off and keeps the file. |
| Sync identity | ids = `crypto.randomUUID()` | Local id == server document name. | Store `serverName` per doc. Re-enabling sync after a server deletion or tombstone should mint a new server name, not fight the tombstone. It also avoids pushing taken-down content back after tombstones expire (90 d, purge-retention.ts:24-26). |
| Server guardrails | lib/security/ws-guardrails.ts:77-83 (`WS_CONNECTION_LIMIT` 10 per IP = per document connection), `DOC_CREATION_RATE_LIMIT` 10/h, `MAX_TOTAL_DOCUMENTS` 2000, `MAX_DOC_SIZE_BYTES` 1–2 MiB, `RETENTION_DAYS` 30 | Sized for browser tabs on a public sandbox. | Background sync of many desktop docs must be capped (≤ 10 concurrent per IP) and serialized. Enabling sync on a doc above the cap fails at once with `document_too_large`, so check size before offering sync. A creation-rate refusal arrives as `authenticationFailed` with another reason, which today only clears `dirty` (collab-session.ts:188-190) and leaves the provider attached. Retries can earn a Throttle ban (AGENTS.md). Desktop needs a proper backoff or stop. 30-day idle retention means a public server is not durable storage; the local file stays primary. |

---

## 4. Schema and version guards, and slow-updating desktops

| Guard | Where | Implication for desktop |
|---|---|---|
| Version gate `client_outdated` | client: `CLIENT_SCHEMA = 2`, `withClientVersion` (lib/schema-version.ts:13-25). Server: `SCHEMA_FLOOR = 2`, `effectiveMinClientSchema` (lib/security/client-schema-gate.ts:16-24), `onConnect` (scripts/hocus-server.ts:163-171). Client reaction: detach, read-only, "Reload" notice (collab-session.ts:180-187; document-notice.tsx:17-37, 66-84) | When the server floor rises, every older desktop is refused on every synced doc. "Reload" cannot update an app; the notice needs "Update app". The doc should stay **locally editable** with sync paused (today it goes read-only). Raising `SCHEMA_FLOOR` or `HOCUS_MIN_CLIENT_SCHEMA` now requires the oldest supported desktop to meet it, so **auto-update becomes a requirement**, not a nicety. Adoption reading should split on `build=` (desktop builds distinguishable). |
| Ingress allowlist `schema_rejected` | lib/schema-names.ts (`SCHEMA_NODE_NAMES` …), enforced in lib/security/hocus-document-guard.ts:41-43, 268-273, 395-406 | A desktop **newer** than the server it syncs to (including self-hosted or older Hocus) gets `4422 schema_rejected` for new marks. Today that freezes the doc. The runbook's allowlist rule (server ships names before any client writes them) must extend to desktop release trains: a desktop release that writes a new mark must wait for every supported server, or negotiate. Suggest the server advertise its allowlist or schema version (e.g. in the auth reply), so the client can decide before enabling sync. |
| Schema guard (client freeze/repair) | lib/schema-guard.ts:53-182; `findUnknownSchemaNames` | A web client writing a new mark into a synced doc puts the unknown name into the desktop's local file, so an older desktop then freezes that document **offline too**, until it updates. Correct (it prevents deletion), but it makes version skew visible on local data. |
| Offline namespace and epoch | local-doc-store.ts:7-13 (`OFFLINE_CACHE_EPOCH`, `OFFLINE_NAMESPACE = "s2"`) | Designed to *discard or hide* copies across schema changes. Primary data needs explicit, versioned migrations instead: store a format or schema version per document and migrate forward. |
| Server-only migrations | `migrateLegacyMarks` in `afterLoadDocument` (scripts/hocus-server.ts:210-219; lib/yjs-mark-migration.ts); root sweep (lib/security/editor-root-sweep.ts); tab-list repair (lib/security/tabs-doc-repair.ts) | Local-only documents never see server-side migrations. Any future migration that must reach every document has to run client-side too (on load from the primary store). Today's legacy `link`/`code` rename does not matter for docs created by current bundles. |
| Rollout runbook | docs/operations/schema-rollout-runbook.md ("Release order", "Allowlist rule", "Never lower the floor") | Assumes the client is served by the same deploy minutes after Hocus. Desktop breaks that: add a "supported desktop versions" column to every floor or allowlist decision, and a mixed-version soak with N-k desktop clients. |

---

## 5. Tests and CI that need a desktop counterpart

| Existing | What it assumes | Desktop counterpart |
|---|---|---|
| Playwright `chromium` / `perf` projects (playwright.config.ts:15-43) against `make dev` (next dev + Hocus) | Helpers use `window.__tiptap_editor` (set only when `NODE_ENV !== "production"`, use-document-editor-effects.ts:44-51). `EditorPage.waitForSync()` waits for `data-server-synced="true"` plus contenteditable (tests/e2e/helpers/editor-page.ts:99-109), which a local-only doc never sets. | 1) Most local-first behaviour can be tested **in a browser** with `NEXT_PUBLIC_APP_TARGET=desktop` under `next dev` and **no Hocus**: a new `local` project. Add a `waitForReady()` keyed on a new `data-ready` / `data-sync-state` attribute. 2) A shell smoke project against the packaged export: Playwright can drive **Electron** (`_electron.launch`) but has no Tauri launcher (Tauri e2e goes through WebDriver via `tauri-driver`; verify its current platform support, historically no macOS). An exported build is production, so it needs an explicit test-hook flag (not `NODE_ENV`) to expose the editor. |
| `pwa` project (production build, SW) | Web-only. | None; keep web-only. |
| `security-headers.spec.ts`, `seo.spec.ts`, `pwa-manifest.spec.ts`, `pwa-connection.spec.ts`, `offline-copies.spec.ts`, `tabs.spec.ts`, `global-tabs-poison.spec.ts` | Headers from Next, server-backed tabs, offline copies as a cache. | Desktop: CSP and headers set by the shell; file manager CRUD offline; sync toggle on/off and server deletion keeps the file; > 14 days and > 30 docs keep data (clock injection); 512 KiB-plus local edits stay editable; hydrate slower than 1 s never overwrites. |
| Unit: `tests/unit/lib/collab-session*.test.ts` (3 files), `tests/unit/lib/offline/local-doc-store.test.ts`, `tests/unit/hooks/use-synced-tabs.test.ts`, `use-connection-state.test.ts`, `tests/unit/lib/tab-api.test.ts` | Provider always present; cache policy. | Parameterize by policy and target. Add a contract test suite every `DocStoreBackend` (IndexedDB, memory, file over IPC mock) must pass. |
| `tests/load/mixed-version-soak.ts`, `color-mark-soak.ts`, `yjs-load-harness.ts` (nightly.yml jobs `load`, `color-soak`, `mixed-version`) | Web clients only, same-deploy skew. | Add desktop skew scenarios: an N-k client reconnecting after weeks offline with a large local diff; many docs syncing from one IP (connection cap). |
| `tests/unit/ci/workflow-permissions.test.ts:60-95` | Every workflow:<br>- has a read-only top-level token (:64-66),<br>- jobs matching `RUNS_DEPENDENCIES` = `bun (install\|update\|run (test\|build\|lint))` (:31) set explicit permissions, with no `contents`/`pull-requests` write (:68-78),<br>- `persist-credentials: false` on checkout (:80-88),<br>- SHA-pinned `uses:` (:90-94). | A desktop release workflow must split into (a) a read-only matrix build (macOS, Windows, Linux) that uploads artifacts and (b) a separate publish job with `contents: write` that only downloads artifacts and runs `gh release upload` (like `release.yml:17-23`). Off-the-shelf `tauri-action` / `electron-builder` publish to a release only with a write token; run them in build-only mode (verify the current flags) and upload from the separate publish job. Also: the regex misses `bun tauri build`, `bunx electron-builder`, `cargo build`. **Extend `RUNS_DEPENDENCIES`** in the same PR, or the test silently passes a write-token build job. Code signing secrets (Apple notarization, Windows signing) belong only in the build job, never alongside a write token. |
| CI "Block Node.js" stub (.github/workflows/ci.yml:47-56, 120-129) | Nothing calls `node` after install. | Electron packaging tools (electron-builder, electron-forge) often shell out to Node; Tauri needs Rust. Either keep the desktop packaging job out of the stubbed jobs or verify Bun compatibility. |
| `scripts/check-editor-chunk-size.ts` (CI step ci.yml:84-87) | Measures the web `.next` build's editor chunk group by marker string. | Must still pass for the web target. Run it for the desktop target too (`--dir`) so desktop-only code cannot sneak into the editor group. |

---

## 6. Bundle and performance constraints the desktop work must not regress

| Constraint | Source | Headroom / rule | Risk from desktop work |
|---|---|---|---|
| Editor chunk group ≤ baseline 377,888 B + **23.5 KB gz** | scripts/check-editor-chunk-size.ts:21-31; CI step | **4,781 B left** (CHANGELOG `[Unreleased]`, "Menu focus after a quick second open": +19,283 B). | Anything imported by `document-editor.tsx` or its eager graph counts:<br>- a sync-status UI,<br>- an awareness shim,<br>- y-protocols' `Awareness` import, if not already in the group,<br>- store or IPC code imported from `lib/collab-session.ts`.<br>Keep the file manager, settings and IPC bridge in the app shell (`editor-app`) or lazy chunks, behind `NEXT_PUBLIC_APP_TARGET` so web DCE drops them. |
| "/" slash trigger eager < 1,000 B (with `SlashMenuHost`); slash chunk ≤ 6 KB | AGENTS.md; tests/e2e/slash-menu.spec.ts:20-21 | — | Do not touch. |
| Palette first Alt+/ ≤ 20 KB gz | CHANGELOG (20,475 / 20,480 B) | 5 B | Do not add palette entries for sync in the palette's eager chunk. Any "Sync this document" action needs to go in a lazy body. |
| Continue chip lazy chunk imports nothing from the editor chunk | AGENTS.md; continue-chip-loader.tsx | — | Same pattern for any desktop-only surface: pass helpers as props, never share modules with the editor chunk. |
| Never `registerPlugin` from a lazy chunk | AGENTS.md | — | A sync-status plugin, if any, must be eager and tiny, or not a plugin at all. |
| Stable `extensions` array / no `setOptions` | AGENTS.md "Typing performance"; document-editor.tsx `useMemo` | — | Sync toggle must not change `provider` identity in the deps (see §3.3). |
| Toolbar store settle (150 ms, 1 s cap), outline store at most every 250 ms, incremental lowlight, y-tiptap skips updates without doc change | AGENTS.md | — | Sync-state UI must subscribe to session events, not editor state. |
| Typing p95 budget | tests/e2e/performance.spec.ts, toolbar-perf.spec.ts (`perf` project) | — | A file-backed store must debounce like `bindLocalCopy` (750 ms) and never write synchronously on keystrokes. IPC round trips must not block. |
| Render-once, content-visibility, CaretBlockVisible | AGENTS.md | — | Unaffected, provided the document is not remounted on sync toggle. |

---

## 7. Suggested refactor order (web keeps shipping at every step)

Each step is a separate PR. Web behaviour stays the same, and each step is guarded by unit tests plus
the existing e2e suite.

1. **Fix the latent hydrate overwrite** (collab-session.ts:259-268, local-doc-store.ts:284-297). After a
   hydrate timeout, apply the late copy instead of dropping it, and never save before the first read
   resolves. On the web today, a slow IndexedDB lets the server state overwrite unsynced offline edits
   (finding 0.8, from code reading). On desktop it becomes a direct loss path. Small and web-safe.
   Add a unit test with a delayed memory backend first.
2. **Split refusal state.** Replace `rejectedReason` with `syncBlockedReason` and `readOnlyReason` in
   `CollabSession`, `useYjsDocument` and `DocumentNotice`. Web mapping stays identical
   (every sync block is still read-only on web), so there is no UX change yet.
3. **Make the provider optional and the socket lazy.**
   - `acquireCollabSession(name, { sync })` with `sync: null | {…}`.
   - `getSharedHocuspocusSocket` is called only by sync-enabled sessions.
   - `useConnectionState` stops creating the socket.
   - `CollaborationCaret` gets a stable awareness holder.

   Web always passes `sync: on`. Measure the editor chunk (4.8 KB headroom).
4. **Readiness and seeding from local state.**
   - Ready = hydrated (primary mode) or server synced (cache mode).
   - Seed at creation for locally created docs.
   - `dirty` is per document and per mode.

   Web still runs cache mode, so nothing changes.
5. **Storage policy split.**
   - `LocalDocStore` gets `CachePolicy` (current behaviour) and `PrimaryPolicy` (no expiry, cap,
     sweep or epoch wipe; local scope).
   - Add `listMeta()`.
   - Add a backend contract test suite.
6. **`DocumentIndex` interface** behind `useSyncedTabs`. The web implementation is the current
   `global-tabs` code. Add a local implementation, tested in the browser.
7. **Build target flag and static export.**
   - Add `NEXT_PUBLIC_APP_TARGET`.
   - Add `force-static` on the 7 metadata routes (no-op for web).
   - Move `DELETE /api/documents/:id` into the Hocus `Bun.serve` handler, or exclude it from desktop
     builds (e.g. a target-specific `pageExtensions`).
   - Run `output: 'export'` only for desktop.
   - Add a `local` Playwright project (desktop target, no Hocus).
8. **Desktop shell.**
   - Electron or Tauri, chosen partly on testability: Playwright drives Electron directly; Tauri needs WebDriver (verify current platform support).
   - Stable custom-scheme origin, with headers and CSP injected from `buildContentSecurityPolicy`.
   - MIME map for extension-less icons.
   - SW off, GA off.
   - Filesystem `DocStoreBackend` over IPC.
   - Auto-update.
9. **Per-document sync UX.**
   - Runtime server URL.
   - Size check before enabling sync.
   - Capped background sync.
   - Server deletion unlinks; re-enable mints a new `serverName`.
   - Schema negotiation or allowlist check before enabling sync.
   - "Update app" notice.
10. **CI and release.**
   - Desktop workflow split into read-only build and write-only publish.
   - Extend `RUNS_DEPENDENCIES`.
   - Run the chunk-size check for both targets.
   - Add desktop-skew scenarios to the mixed-version soak.
   - Update the schema rollout runbook to cover desktop release trains.

Steps 1–6 are pure refactors of the shared code and can land while the shell technology is still
undecided. Steps 7–10 are additive behind the target flag.
