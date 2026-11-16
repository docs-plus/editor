# TinyDocy: image store (assets out of the Yjs document)

> **Owner answers (2026-11-16)**, which override the defaults and open questions below:
> - **D15:** a 5 GiB global cap on shared images (`ASSET_TOTAL_BYTES` default 5 GiB).
> - **D16:** 10 MB and 100 images per shared document, at 2 MB per image.
> - **D17:** report and takedown plus a hash blocklist; pre-launch legal advice decides whether scanning is required.
> - **D18:** the public sandbox keeps inline images.
>
> **Plan v8 (D40, 2026-11-16):** the asset endpoints take the S1 derived tokens: `PUT` and `missing` take `auth_edit`, `GET` takes either `auth_edit` or `auth_view` (§4.1). `TINYDOC2` is the only format; nothing reads `TINYDOC1` (§5.4). Asset refs stay plaintext-hash in content, while a future relay may key bytes differently (S17). The redirect seam (S6) and `assetBaseUrl` were dropped: no CDN work in v1.


- **Status:** Draft for owner review (2026-11-16). Nothing is built yet.
- **Decision it implements:** D4, answered 2026-11-16: "an image store now" ([plan §13](2026-11-15-desktop-local-first-design.md#13-owner-decisions-answered-2026-11-16)).
- **Parent documents:**
  - [Plan v7](2026-11-15-desktop-local-first-design.md): §2 (256 KiB data URLs, 2 MiB cap), §6 (server), §7 (security), K5 (abuse), §12 (costs)
  - [Architecture](2026-11-15-desktop-architecture.md): storage worker, tables, IPC, ports, D-A11 origin
  - [Details spec](2026-11-15-desktop-documents-and-editor-details.md): §1 rules, §8 sharing, E6 print, E7 export
  - [Web library design](2026-11-16-web-library-design.md) (being written in parallel). **This document fixes the `BlobStore` contract** (§3.1), and the web library owns its IndexedDB adapter.
- **Scope:** raster images only. Video and audio stay URL-only, as they are today. The hook added upstream is generic, so they can follow later.

---

## 0. Summary

| # | Decision |
|---|---|
| I1 | **Content-addressed assets.** The document stores `asset:sha256-<64 lowercase hex>` in the image node's `src`, alongside the existing `width`, `height`, `alt` and `caption`. It never stores the bytes. |
| I2 | **Types:** PNG, JPEG, WebP and GIF. **No SVG**, anywhere, ever: SVG is script-capable markup. No HEIC, AVIF or BMP as stored types. They are converted on insert where the browser can decode them, and refused otherwise. |
| I3 | **Every insert strips metadata.** JPEG is always re-encoded. PNG and WebP keep their pixels and lose their metadata chunks. GIF passes through, and the server refuses JPEG files that still carry Exif. |
| I4 | **Desktop keeps assets as immutable files on disk** (`<userData>/assets/ab/<hex>`). Only metadata lives in `library.sqlite`. Files are served through the app's protocol handler. |
| I5 | **The web keeps assets in IndexedDB** behind the same `BlobStore` port and renders them through reference-counted object URLs. |
| I6 | **The server stores assets per share,** as files under the `DB_PATH` directory. They are fetched with the share token **in a header**, from the Hocus process. Bytes are deduplicated on disk, but the API never reveals that (no existence oracle). |
| I7 | **The public sandbox stays inline** (data URLs of up to 256 KiB). It has no server asset scope, because an anonymous upload endpoint would be an anonymous image host. |
| I8 | **Upstream HyperMultimedia 2.4** adds `resolveSrc`, `isHostSrc` and `refreshMediaSrc`. Until then, a local `.extend()` serves as a fallback. |
| I9 | **Migration converts inline images** in library documents, imports and documents about to be shared. It runs after the editor binds, as a forward edit outside undo. |
| I10 | **GC never deletes a referenced blob.** References are recounted from the whole document state. A 30-day grace period outlives every copy that could bring a reference back. |

---

## 1. Facts this design rests on

Each fact was checked against the code or measured on 2026-11-16.

| Fact | Where | Consequence |
|---|---|---|
| Images are inserted as data URLs: up to 256 KiB each, at most 1600 px on the longest side, re-encoded to WebP or JPEG only when they don't fit | `lib/image-downscale.ts` | The pipeline is reusable, but its fit check counts **data-URL length** (`dataUrlLength`), and `parseMaxEmbedImageBytes` clamps at 1 MiB. Asset mode needs a raw-byte cap. |
| **Privacy gap today:** `planImageEmbed` passes PNG, JPEG, WebP and GIF files through unchanged when they already fit, so their Exif, GPS and XMP metadata stay in the file | `image-downscale.ts:121-147` | A phone JPEG under 256 KiB keeps its GPS location and goes to every reader. Fixed here (I3), and **worth fixing on the web now**, independent of the asset store. |
| The image node view sets `img.src = attrs.src` directly. A change to `src` recreates the node view (`update` returns false). | hypermultimedia `dist/index.js`, function `yi` | Rendering needs a resolver. A src swap rebuilds the view, so the migration's attribute change re-renders cleanly. |
| `isSafeMediaSrc` blocks only `javascript:`, `data:` (except raster images), `vbscript:`, `file:` and `blob:` | `dist/index.js` (`xs`, `_s`, `k`) | `asset:` already passes the scheme gate. |
| The kit's `parseHTML` accepts an `img` only if `hi(src)` holds, meaning a data, blob, image-extension or http(s) URL | `dist/index.js` (`hi`, `Ge`, `jo`) | **`asset:` images are dropped on cut, copy and paste** (ProseMirror's clipboard goes through `parseDOM`) and on HTML import. Upstream must accept host srcs. |
| Pasted image files reach the host as a `document` `editorFileUpload` event. TinyDocy inserts them with `alt: file.name`. | `components/document-editor/use-media-file-upload.ts` | The insert path is ours, so no upstream change is needed for uploads. The file-name alt ("IMG_2034.jpg") is poor; see §7. |
| Replacing a 256 KiB data-URL `src` with an `asset:` ref shrinks the encoded Y.Doc from **262,210 B to 134 B** with `gc: true`. It stays at 262,305 B with `gc: false`. The delta update is 104 B. | `bun` script on yjs, 2026-11-16 | Migration really frees space. Hocuspocus defaults to `yDocOptions.gc: true` (`hocuspocus-server.esm.js:1247`), and `scripts/hocus-server.ts` doesn't override it, so the server copy shrinks too. Any future `gc: false` document (version history) keeps the old bytes, and needs its own pruning. |
| The size guard estimates `stored + pending + frame` and lets delete-only updates through at the cap | `lib/security/hocus-document-guard.ts` | A migration update (small, mostly deletions) is accepted even for a document at its cap. |
| The ingress allowlist checks node and mark **names**, never attribute values | `findDisallowedSchemaNames` | An `asset:` src passes the existing server guard. An old client sees a broken image; **it does not delete content.** |
| Clients send `schema=2` on the socket. The server refuses bundles below `max(HOCUS_MIN_CLIENT_SCHEMA, 2)`. | `lib/schema-version.ts`, `client-schema-gate.ts` | Bump `CLIENT_SCHEMA` to 3 ("knows asset refs"). Share documents require 3 from day one. |
| The web CSP has `img-src 'self' data: blob: https:`, and `connect-src` lists the **wss** Hocus URL | `lib/security/content-security-policy.ts` | Object URLs already render. Fetching assets over https from the Hocus host needs its https origin added to `connect-src`. |
| D6 is one combined release, so **no desktop build ships before the image store** | plan §13 | There are no old desktop clients to migrate. `.tinydoc` can bundle assets from its first version. |
| The Hocus process already answers HTTP inside `Bun.serve({ fetch })` | `scripts/hocus-server.ts:209` | Asset endpoints live next to share auth (P4.1/P4.2), not in Next.js. |
| There is no server backup today | `docs/operations/`, README | An asset directory is a new thing to back up (§4.6). |

---

## 2. Model

### 2.1 The reference

```text
asset:sha256-3f0c…e9a1        (64 lowercase hex characters, 77 characters in all)
```

- `lib/assets/asset-ref.ts`: `formatAssetRef(hex)`, `parseAssetRef(src) → { alg: "sha256", hex } | { alg: "unknown" } | null`.
- **An unknown algorithm** (a future `asset:blake3-…`) renders "This image needs a newer version of TinyDocy." The node is never modified.
- **The reference does not depend on origin.** The same document renders on desktop, in the web library and in a share, and each one resolves it locally (§3).
- **Hex, not base64url:** it can be a filename on every OS, has no case-folding problem on macOS or Windows, and matches `sha256sum`.
- **Width and height stay on the node.** Placeholders and missing images keep their box, so the layout never jumps.

### 2.2 What gets accepted

| | Rule |
|---|---|
| Types stored | `image/png`, `image/jpeg`, `image/webp`, `image/gif` |
| SVG | Refused on insert, paste, import and upload: "SVG images aren't supported. Export it as PNG or JPEG first." Same as today. |
| Other decodable types (HEIC on Safari, AVIF, BMP) | Decoded by the browser and re-encoded to WebP (or JPEG where WebP can't be encoded). If they can't be decoded: "This image format can't be read here. Try PNG, JPEG, WebP or GIF." |
| Input file | ≤ 20 MiB (up from 5 MiB, since the output no longer lives in the document). Decode ceiling: 40 MP (`MAX_DECODE_PIXELS`, unchanged). |
| Stored asset | ≤ **2 MiB** (`MAX_ASSET_BYTES`). Longest side ≤ **2560 px** (`ASSET_MAX_SIDE`). |
| GIF | Passed through if ≤ 2 MiB and ≤ 40 MP. Otherwise: "GIFs must be under 2 MB (animations aren't resized)." |
| Per gesture | 10 images (up from `IMAGE_UPLOAD_LIMIT` 3). |

### 2.3 The insert pipeline (`prepareImageAsset`, which extends `lib/image-downscale.ts`)

The decision logic stays pure and unit-tested, as it is today. It gains a byte-cap mode, so the data-URL path and the asset path share one module.

```text
plan(file):
  SVG or not an image          → reject
  GIF                          → passthrough if ≤ MAX_ASSET_BYTES, else reject
  JPEG                         → always re-encode   (strips Exif/GPS; canvas applies the orientation, see below)
  PNG, WebP ≤ cap and ≤ 2560px → strip metadata chunks, keep the pixels
  anything else                → re-encode (WebP, else JPEG), stepping the size and quality down as encodeAttempts does today
then: bytes → sniff the magic bytes (must match the type) → SHA-256 (crypto.subtle) → BlobStore.put
```

- **Why always re-encode JPEG.** Removing APP1 without re-encoding would also remove the orientation tag, and photos would turn sideways. Browsers apply Exif orientation when drawing to a canvas by default (`image-orientation: from-image`, [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/image-orientation)), so a re-encode bakes the rotation in and drops the metadata.
- **PNG and WebP strippers** (`lib/assets/strip-metadata.ts`, pure, about 80 lines):
  - PNG: drop the `eXIf`, `tEXt`, `iTXt`, `zTXt` and `tIME` chunks.
  - WebP: drop the `EXIF` and `XMP ` chunks and clear the matching VP8X flags.
  - The hash is taken **after** stripping.
- **GIF** has no Exif. Comment and XMP application extensions pass through, and that is documented.
- **Encoding runs off the main thread** where possible: `createImageBitmap` plus `OffscreenCanvas.convertToBlob` in a worker, falling back to today's canvas. A 12 MP photo must not freeze typing (§8, perf).
- **The web sandbox keeps today's data-URL path,** with the JPEG re-encode applied too. That privacy fix can ship on its own (A0, §9).

---

## 3. Local storage

### 3.1 The `BlobStore` port (`lib/platform/ports.ts`)

```ts
type AssetHex = string;                        // 64 lowercase hex
type BlobState = "present" | "missing";
interface BlobStore {
  put(docId, bytes: Uint8Array, mime): Promise<{ hex: AssetHex }>;   // verifies, stores, adds a provisional doc_blobs row
  url(hex): string | null;                     // synchronous URL if present and cheap (desktop); null on the web
  get(hex): Promise<Blob | null>;              // bytes, for export, object URLs and upload
  has(hexes: AssetHex[]): Promise<AssetHex[]>; // which of these are present
  recount(docId, hexes: AssetHex[]): Promise<void>; // the FULL set referenced by the document's current state (§3.4)
  gc(now): Promise<{ deleted: number; bytes: number }>;
}
```

- **Desktop:** `IpcBlobStore` → main → storage worker (§3.2).
- **Web:** `IdbBlobStore` in the web library's database, owned by the web library design. This document fixes only the contract and the object stores it needs (§3.3).
- **Tests:** `MemoryBlobStore` in `tests/helpers/platform-fakes.ts`, with `failNext` and `missing` switches.

### 3.2 Desktop: files on disk, with metadata in SQLite

**Decision: blob bytes are files, not SQLite BLOBs.**

| | Files (chosen) | BLOBs in `library.sqlite` |
|---|---|---|
| The daily `VACUUM INTO` (7 kept), pre-migration copies (2 kept), and the `quick_check` after an unclean exit | Copy only the metadata | Copy every image about **9 times**. 500 MB of images becomes about 4.5 GB. |
| Read speed for our sizes (50 KB–2 MB) | Faster above about 100 KB ([SQLite: Internal vs External BLOBs](https://www.sqlite.org/intern-v-extern-blob.html)) | Faster below about 100 KB |
| Serving to `<img>` | The protocol handler streams the file. Main reads it without the worker. | The worker reads it and transfers it to main |
| Atomicity | Needs a write order (below) | Free |
| Immutability | Content-addressed files are never rewritten | n/a |

The atomicity cost is paid once, in one module, so files win.

**Layout**

```text
<userData>/assets/3f/3f0c…e9a1      immutable, mode 0600; no extension (the type is sniffed when served)
<userData>/assets/tmp/<uuid>        in-flight writes, swept at startup
```

**Tables** (P2.6b adds them to architecture §5.3)

```text
blobs(hash TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER, height INTEGER,
      created_at INTEGER NOT NULL, origin TEXT NOT NULL)        -- origin: insert | migration | import | fetched
doc_blobs(doc_id TEXT NOT NULL, hash TEXT NOT NULL, kind TEXT NOT NULL,  -- kind: provisional | current | version
          dropped_at INTEGER, PRIMARY KEY (doc_id, hash, kind))
INDEX doc_blobs(hash)
-- Live adds: share_blobs(share_id, hash, confirmed_at), meaning "the server has it for this share"
```

**Write order** for `put`. The worker owns `assets/`, as it already owns the mirror files.

1. Main checks the sender and the registry: the document must be open in this window.
2. Main checks the size, sniffs the magic bytes against the declared type, and **recomputes the SHA-256**. The renderer's hash is never trusted.
3. The worker:
   1. If a `blobs` row exists, skip to step 6. This is dedupe.
   2. Write to `assets/tmp/<uuid>`.
   3. `fsync` the file.
   4. `rename` it to `assets/ab/<hex>`.
   5. `fsync` the directory (`F_FULLFSYNC` on macOS).
   6. In one transaction: `INSERT OR IGNORE blobs` and `UPSERT doc_blobs(kind='provisional', dropped_at=NULL)`.
4. Only after the reply does the renderer insert the node. **A document never references bytes that aren't durable.**

**Crash cases** (soak T16):

| Killed after | Result | Repair |
|---|---|---|
| Step 3.2 | A file in `tmp/` | Startup deletes `tmp/*` |
| Step 3.4, before the row | An orphan file with no row | The GC sweep deletes files with no row that are older than 1 day |
| The row, before the document append | A provisional reference that nothing uses | Dropped at the next recount, then collected after the grace period |
| A missing file with a row (external damage) | The image shows "Image not found on this computer" | Fetched again from the share, if there is one. `quick_check` gains a sample of the asset rows. |

**Rendering**
- The protocol handler serves `<app origin>/_asset/<hex>`:
  - the hex must match `^[0-9a-f]{64}$`, so the path can't escape the folder
  - `Content-Type` comes from the magic bytes
  - `X-Content-Type-Options: nosniff`
  - `Cache-Control: private, max-age=31536000, immutable`
- **The origin is `app://tinydocy` (S1, with D-A11).**
  - The asset path rides the app origin, so assets need only `img-src 'self'`. No `blob:` and no new host. S1 served a fixture PNG this way on all three OSes, and eight traversal probes (`..`, `%2e%2e`, `..%2f`) all got 404.
  - No dedicated asset scheme is needed.
- `BlobStore.url(hex)` returns that URL **synchronously** when the hash is in a small set of known hashes, which main pushes at document open. So on desktop, resolving costs nothing for present blobs.
- A missing blob goes through `ensure` (§5.3).

### 3.3 Web: IndexedDB (contract for the web library)

| Object store | Key | Value |
|---|---|---|
| `blobs` | `hash` | `{ hash, mime, size, width, height, createdAt, origin, data: Blob }` |
| `doc_blobs` | `[docId, hash, kind]` | `{ droppedAt }`, with an index on `hash` |

- **Write order:** put the blob and the provisional row in **one IndexedDB transaction**, then insert the node. IndexedDB transactions are atomic, so no orphan sweep is needed.
- **Rendering:** a reference-counted object-URL cache (`lib/assets/object-url-cache.ts`):
  - `acquire(hex) → Promise<url>` and `release(hex)`
  - a URL is revoked 30 s after its count reaches 0, so a tab switch reuses it
  - all URLs are revoked when the last editor is destroyed
  - the node view's `AbortSignal` (§6) is the release, **so nothing leaks when a view is torn down**
  - a test counts `createObjectURL` and `revokeObjectURL` calls (§8)
- **Quota:**
  - A `QuotaExceededError` on put becomes "Your browser is out of space for TinyDocy. Export or delete some documents, then try again." The image isn't inserted.
  - Eviction and `navigator.storage.persist()` are the web library's concern. Safari's 7-day cap on script-writable storage applies to images too ([WebKit](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)). The web library's warning copy should say "documents and their images".

### 3.4 References and garbage collection (desktop and web)

**Who counts references.**
- **The renderer is the only reader of the Y.Doc** (architecture §5.1: the worker never parses Yjs).
- It walks the fragment for `image` elements whose `src` parses as an asset ref, and calls `recount(docId, hexes)` at every **compaction and close**, the way `title?` rides on an append.
- `put` adds only a **provisional** row. The full set is cheap to compute: one walk at compaction, which already encodes the whole state.

**What recount does.** In one transaction:
- the given hashes become `kind='current'` with `dropped_at = NULL`
- current or provisional rows not in the set get `dropped_at = now` (if it was null)

**Versions (Live, P4.8).**
- Saving a version recounts the version's state into `kind='version'` rows.
- Pruning a version sets `dropped_at` on them, unless another version still references the hash.

**Permanently deleting a document** sets `dropped_at = now` on all its rows.

**A blob is collectable only when all of these hold:**
1. Every `doc_blobs` row for it has `dropped_at` older than the **grace period** (`ASSET_GC_GRACE_DAYS`, default 30). A blob with no rows at all is judged by its `created_at`.
2. No live document has a provisional row for it newer than the grace period.
3. *(Live)* No share upload for it is in flight.

**Why 30 days.** The grace must outlive every copy that can bring a dropped reference back:

| Copy that can restore an old reference | Lifetime |
|---|---|
| Daily library copies ("Restore from a daily snapshot") | 7 days |
| Pre-migration copies | 2 copies, usually days |
| Trash before purge | 30 days. The rows are still current while a document is in Trash, so the grace starts at purge. |
| Undo or redo of a removed image | the session |
| Versions (Live) | until pruned, through `kind='version'` rows |
| Backups `Deleted/` | 30 days, but backups carry **their own** copies (§5.4), so they don't need the library |

**GC runs** in the worker's idle job queue (`jobs.ts`), at most once a day, yielding between batches of 100 files. On the web it runs in an idle callback in the library's leader tab.

**Invariant (property test, §8):** after any sequence of insert, remove, undo, compact, close, version save and prune, trash, purge, daily-copy restore and clock advance, every hash referenced by:
- the current state
- any unpruned version
- any daily copy younger than 7 days

has bytes present.

---

## 4. Live documents and the server

### 4.1 Endpoints (in the Hocus process, next to share auth)

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/shares/:id/assets/missing` | `auth_edit` | Body `{ hashes: string[≤ 500] }` → `{ missing: string[] }`. "Missing" means **not linked to this share**, whatever is already on disk. |
| `PUT /api/shares/:id/assets/:hex` | `auth_edit` | Raw body with `Content-Type` set to one of the 4 types and `Content-Length` required. Returns 201, or 200 if already linked. |
| `GET /api/shares/:id/assets/:hex` | either token: `auth_edit` or `auth_view` | The bytes. 404 if not linked, 410 if blocked or removed. |

**Rules for every endpoint**
- **Tokens go in `Authorization: Bearer`, never in a URL.** URLs leak into logs, history and `Referer`.
- **Tokens are the S1 derived tokens** (plan §6, details §8.2; v8), never the fragment secret. The server looks the share up by `share_id`, then compares `SHA-256(token)` with the stored hash using `timingSafeEqual`. Tokens never appear in logs. Failed tokens are rate-limited **per `share_id`**, plus per /64 and /48 (plan §6).
- They obey `HOCUS_SHARES` and `HOCUS_ASSETS` (§4.5).

**CORS**
- `Access-Control-Allow-Origin` is the exact web origin from `HOCUS_ALLOWED_ORIGINS`, with `Vary: Origin`. Preflights are cached for 10 min.
- The desktop fetches through main with `net.fetch`, so it doesn't need CORS.

### 4.2 Checks on PUT (in order, cheapest first)

1. The share is `committed` or `pending` (an upload during the share flow), and not ended. Otherwise 410 with the tombstone reason.
2. `HOCUS_ASSETS=on`. Otherwise 503 `assets_disabled`.
3. `Content-Length` ≤ `MAX_ASSET_BYTES`. Otherwise 413.
4. The quotas allow `Content-Length`. Otherwise 507 `share_asset_quota`, `share_asset_count` or `asset_store_full`. The quotas are checked **again inside the commit transaction**, so two parallel uploads at the edge can't both pass.
5. `:hex` is not on `blocked_assets`. Otherwise 451 `asset_blocked`.
6. **Stream the body to `tmp/` while hashing** (`Bun.CryptoHasher("sha256")`). Abort at `MAX_ASSET_BYTES + 1` bytes, whatever the header says.
7. The digest equals `:hex`. Otherwise 422 `hash_mismatch`, and the temp file is deleted.
8. **Magic bytes** match the declared type. Otherwise 415. SVG, HTML, PDF and anything else are refused here.
9. **Header-only dimension parse** (PNG IHDR, JPEG SOF, WebP VP8, VP8L or VP8X, GIF logical screen): width × height ≤ 40 MP, and each side ≤ 16,384. Otherwise 422 `too_many_pixels`. This protects every client that decodes the image.
10. A **JPEG with an Exif APP1 segment** is refused with 422 `metadata_present`. This backstops I3. The server can't strip metadata itself, because changing the bytes would break the hash.
11. `fsync`, `rename` into `assets/ab/<hex>` (skipped if already on disk, which is silent dedupe), then commit the rows:
    - `INSERT OR IGNORE assets`
    - `INSERT share_assets(share_id, hash, size, uploaded_at)`
12. **Broadcast a server-originated stateless message** `{"t":"asset_available","h":"<hex>"}` to the share's connections. Peers waiting on a 404 retry at once. Stateless messages from clients with this type are ignored, so it can't be spoofed.

### 4.3 Dedupe and the existence oracle

Cross-user dedupe that the client can observe lets an attacker test whether a known file is stored on the server ([Harnik, Pinkas, Shulman-Peleg, IEEE S&P 2010](https://ieeexplore.ieee.org/document/5655218)). So:
- **Bytes are deduplicated on disk only.** `missing` and `GET` answer **per share**.
- A PUT always carries the full body, even when the bytes are on disk.
- The per-share quota is charged in full, even for deduplicated bytes.
- A share can read only hashes linked to it.

### 4.4 Serving GET

| Header | Value |
|---|---|
| `Content-Type` | The type sniffed at upload time, never the client's |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Disposition` | `attachment; filename="image.<ext>"` |
| `Content-Security-Policy` | `default-src 'none'; sandbox` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `Cache-Control` | `private, max-age=31536000, immutable` (private, because the response depends on the token) |
| `ETag` | `"sha256-<hex>"` |
| `Accept-Ranges` | `none` |

- **No Range support.** Images are ≤ 2 MiB, immutable, and cached locally after the first fetch.
- **No CDN in v1.** Responses need a bearer token, so a shared cache can't hold them, and every client keeps its own copy (§3).
- **Bandwidth** therefore scales with "images × devices that join", once each.

**Origin decision: serve from the Hocus host (`ws.tiny.docs.plus`). No separate user-content domain in v1.**
- Assets can't be navigated to or hot-linked: without the `Authorization` header they return 401. So a stored file can never render as a page on a docs.plus subdomain.
- Only 4 raster types are accepted, after the magic-byte check. On top of that come nosniff, attachment and a `sandbox` CSP.
- **This decision is reopened** the moment anything is ever served **without** a header token, such as published pages or public links. Such content would then go on a separate registrable domain (the `googleusercontent.com` pattern). A sibling subdomain could set cookies on `.docs.plus`, which also serves the main docs.plus product.

### 4.5 Limits and switches (env, reported in `/api/info`)

| Env | Default | Notes |
|---|---|---|
| `HOCUS_ASSETS` | `on` | `on` \| `readonly` (GET only) \| `off`. Reported in `/api/info.features`, so installed apps hide image upload on live documents. |
| `MAX_ASSET_BYTES` | 2,097,152 | One asset |
| `MAX_SHARE_ASSET_BYTES` | 26,214,400 (25 MiB) | **Owner question Q2** |
| `MAX_SHARE_ASSETS` | 300 | Per share |
| `MAX_ASSET_STORE_BYTES` | 10 GiB | Global. **Owner question Q1** (free disk). New uploads are then refused with `asset_store_full`. |
| `ASSET_UPLOAD_BYTES_PER_IP_HOUR` | 200 MiB | Per /64 |
| `ASSET_GETS_PER_IP_MINUTE` | 600 | Separate from the WS throttle. **Asset traffic never feeds Hocuspocus Throttle bans** (K4). |
| `ASSET_UNREFERENCED_GRACE_HOURS` | 24 | Sweep (§4.6) |

`/api/info` gains `maxAssetBytes`, `maxShareAssetBytes`, `maxShareAssets` and `assetTypes`, so the client can pre-check before it shares.

### 4.6 Storage, retention and backup

**Location**
- Files live in `dirname(DB_PATH)/assets/ab/<hex>`.
- Metadata lives in the same SQLite file as `shares`:
  - `assets(hash PK, mime, size, width, height, first_seen_at)`
  - `share_assets(share_id, hash, size, uploaded_at, referenced_at, PRIMARY KEY(share_id, hash))`
  - `blocked_assets(hash PK, reason, created_at)`
- **Why not SQLite BLOBs on the server:** the same 100 KB rule applies. Also, `Bun.file` responses stream straight from disk, and keeping `db.sqlite` small keeps its backups and `VACUUM` quick.

**Retention follows the share.**
- When a share ends (`sharing_stopped`, `link_reset`, `expired`), its `share_assets` rows go, and files with no rows left are deleted by the sweep.
- **Reset link copies** the `share_assets` rows to the new share id, so nothing is uploaded again.
- `removed` is handled in §4.7.

**Unreferenced uploads.** A daily sweep in Hocus:
- loads each **stored** share state
- walks it for asset refs and sets `referenced_at`
- deletes `share_assets` rows that have been unreferenced for longer than `ASSET_UNREFERENCED_GRACE_HOURS`, and files with no rows

Because the sweep reads the stored state, there is no cost on the save path. Undo restoring an image after the sweep is handled by reconciliation (§5.2): the uploader still has the bytes and uploads them again.

**Backup** (owner action, Deploy note). Today there is no backup.
- The assets folder is immutable and content-addressed, so `rsync --ignore-existing` (or object storage) gives cheap incremental copies.
- Back up `db.sqlite` with `VACUUM INTO` at the same time, so rows and files agree.

**Costs.** This replaces the plan §12 row:

| Item | Cost |
|---|---|
| Server disk for shares | documents ≤ about 4 GiB (2,000 × 2 MiB), plus **images ≤ `MAX_ASSET_STORE_BYTES` (default 10 GiB)**, plus the same again if backed up on the box |
| Server bandwidth for images | each image once per joining device. For example, 100 active shares × 5 devices × 10 MiB is about 5 GiB a month. Measured in P4.2. |

### 4.7 Abuse (K5): images are the main illegal-content vector

**How the design reduces the attraction of abuse**
- No public, hot-linkable URLs: every view needs the share link and goes through the click-to-open page.
- Per-share and global quotas, per-IP upload byte limits, and a global creation cap per hour (plan §6).
- The sandbox has no server image uploads (I7). Matrix closed its unauthenticated media endpoints for the same reason: they were being used as a content distribution network ([Matrix, 2024](https://matrix.org/blog/2024/06/26/sunsetting-unauthenticated-media/); [Matrix, 2025](https://matrix.org/blog/2025/02/building-a-safer-matrix/)).

**Reports** cover the share, which includes its images. The report form adds a reason: "An image in this document".

**`share-admin` additions** (S-A2)

| Command | What it does |
|---|---|
| `assets <id>` | Lists hash, type, size, dimensions and upload time. With `--out <dir>`, writes the files for review. Whether the operator may view reported images, and how, is a legal question (Q3). |
| `export <id>` | Now includes the assets, as legal evidence |
| `end <id> --reason removed --preserve` | Moves the share's assets to `quarantine/`, outside the serving path, with an access-controlled folder and a time limit set by legal advice. Then it ends the share. |
| `end <id> --reason removed` | Deletes the bytes |
| `block-asset <hex> --reason …` | Adds the hash to `blocked_assets`, deletes it from **every** share, and makes GET return 410. Clients then show "This image was removed by the server operator." |

**Limits of the blocklist.** An exact SHA-256 blocklist stops only byte-identical re-uploads. **Any re-encode defeats it.** Perceptual hashing (PhotoDNA, Thorn Safer) needs vetted access. Cloudflare's CSAM Scanning Tool only sees content served through Cloudflare's cache ([Cloudflare docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)), and authenticated, private responses never are. Whether scanning is required is part of the existing Gate 4 legal advice (Q3).

**Alerts** (plan §6) gain these hourly counts:
- asset bytes uploaded
- uploads refused for quota
- 451 blocked-hash hits

**Logs** carry share IDs, hash prefixes (8 hex characters) and sizes. They never carry tokens or full hashes, because the full hash of a reported image is itself sensitive evidence and belongs in `share-admin` only.

---

## 5. Client sync for live documents

### 5.1 Going live (extends architecture §8.3)

```text
Share confirmed → GET /api/info (limits)
→ pre-check, all local: document size + Σ referenced asset sizes ≤ the limits, and every referenced hash is present locally
     (missing ones → "3 images aren't on this computer. Share without them, or cancel?")
→ migrate the document's inline images (§5.5), then POST /api/shares
→ POST …/assets/missing → PUT each missing asset, 2 at a time, with progress in the chip popover
     ("Uploading images: 4 of 12")
→ attach the provider and upload the document → poll status until committed → Live
```

- **Assets are uploaded before the document is.** When the link appears, every image in it is on the server.
- Any refusal leaves the document Local and publishes nothing, as today:
  - quota
  - `asset_store_full`
  - `assets_disabled`
  - a hash mismatch, which would mean a corrupt local file: that blob is re-verified and then shown as missing

### 5.2 While live: reconciliation, not events

`syncAssets(docId)` computes **the document's referenced set minus `share_blobs` confirmed for this share**. It then calls `missing`, and PUTs whatever is present locally. It runs:
- on every (re)connect, after the first sync
- 2 s (debounced) after a local transaction adds an image node or changes a `src`
- after migration

**This one path covers:**
- an image inserted offline
- an image pasted from another document
- undo bringing back an image that the server sweep removed
- a crash in the middle of an upload
- a collaborator's reference to a blob this device happens to have, which then gets uploaded for them too

**Notes**
- **No upload queue is persisted.** The state comes from the document plus `share_blobs`, so it can't drift.
- **Ordering.** The Yjs update may reach peers before the bytes, because rule 1 forbids holding back updates in a way that could strand them. Peers show a placeholder and retry when `asset_available` arrives (§4.2, step 12).
- **View-only clients never upload** (`WriteGate`, details §1).

### 5.3 Joining and resolving

`ensure(docId, hex)`:
- **Present locally:** return the URL.
- **Otherwise, if the document is live:** `GET` with the token.
  - On desktop, **main** does the GET (`net.fetch`), using the token it already holds. The renderer needs no new `connect-src`.
  - On the web, the renderer fetches, so the Hocus https origin is added to `connect-src`.
- **Every fetched blob is verified** before it is stored: SHA-256 equals `hex`, and the magic bytes are an allowed type. A mismatch is dropped and shown as missing. It is never retried in a loop.

**After a join**
- Every missing asset is fetched **in the background**, 2 at a time, in document order, after the document renders. A desktop joiner then has every image offline.
- On the web, assets of joined documents are stored in the library's IndexedDB in the same way.

**Retries after a 404**: back off 2 s, 4 s, 8 s … up to 5 min, and retry at once on `asset_available` or on reconnect. Give up quietly after 24 h. The placeholder stays.

### 5.4 Exports, backups and print

| Path | Images |
|---|---|
| **`.tinydoc`** (Send a copy, Export, web Download P2.10) | **Format `TINYDOC2`:** magic, then a u32 length plus a JSON header (`lineage`, `yjs_encoding`, `schema`, `assets: [{hash, mime, size}]`), then a u32 length plus the Yjs state, then the asset bytes concatenated in header order. About 60 lines, with no zip dependency in the signed main bundle (K6). Import verifies each hash and drops any mismatch, which then shows as missing. **v8 (S8, D40):** the header also carries `"v": 2`, `"minReader": 2` and `"enc": null`; readers ignore unknown keys and refuse a higher `minReader` or a non-null `enc` with "made with a newer TinyDocy". `TINYDOC1` is neither written nor read, since nothing shipped with it. |
| **Markdown export** (E7) | `<name>.md` plus `<name>-images/<n>-<hex8>.<ext>`, with relative links. A pure `rewriteAssetRefs(md, map)` handles the rewrite; the match is safe because the hex has a fixed length. Inline data-URL images are written out as files too. |
| **HTML export** | One self-contained file with data URLs, the right shape for a mail attachment |
| **Copy as Markdown** and in-app copy | Keep `asset:` refs. They paste correctly inside TinyDocy on the same device, and show as missing elsewhere. The media toolbar's Copy image puts the **resolved bytes** on the clipboard (`ClipboardItem`). This limitation is documented. |
| **Readable backups** (`~/TinyDocy Backups`) | Asset files go **once** to `~/TinyDocy Backups/assets/<hex>.<ext>`: written to a temp file and renamed, and skipped if they already exist. Each backup `.tinydoc` uses `TINYDOC2` with the header flag `assets: "external"`. The `.md` links to `assets/…`, so **backups open with images in any Markdown viewer**. Backup asset GC weekly: delete `assets/` files that no current or `Deleted/` (< 30 days) backup references. "Restore from backup…" reads the sibling `assets/` folder; main gets the path from the dialog. |
| **Export all…** | Same layout as backups |
| **Daily library copies** | Hold metadata only. The bytes are kept by the GC grace period (§3.4). |
| **Print** (E6) | On `beforeprint` (and before `webContents.print`), `ensure` every referenced asset and `await img.decode()`, so images left unresolved by content-visibility or lazy resolving are filled in. The print stylesheet sets `content-visibility: visible`. Images that are still missing print as their sized placeholder box with the state text. |

### 5.5 Migration of inline images

**What converts, and when**

| Document | When | Notes |
|---|---|---|
| Desktop library documents | On open, **after the editor binds**, on idle | A document with no data URLs costs one fragment walk |
| Web library documents | The same, through the web library's session | |
| Imports (`.md` with data URLs, `.html`, `.tinydoc` v1, web Downloads) | During import, before the first save | The renderer converts the inline images in the imported document before its first save |
| A document about to be shared | In the share flow, before upload (§5.1) | If it can't convert (for example, a disk failure), sharing stops |
| A live document | Only when online, after the PUT succeeds | Offline, inline images stay inline, which still works |
| **The public sandbox** (`playground`, `global-tabs` documents) | **Never** (I7) | |

**How**
- Conversion can't run in the synchronous before-bind migration hook (architecture §5.1): hashing and `put` are async, and the bytes must be durable **before** the reference exists.
- So: collect the `(element, dataUrl)` pairs → decode → strip and re-encode per §2.3 → `put` → then **one** `doc.transact(ASSET_MIGRATION_ORIGIN)`.
- Within that transaction, each `src` is replaced **only if it still equals that exact data URL**, so a concurrent edit wins.
- The origin is not tracked by the UndoManager, so this is a forward edit outside undo (plan §5.5, "Restoring is one forward edit").
- Gated by `WriteGate.canWrite()`.

**What stays the same**
- **Mixed documents are permanent and fine.** `data:` images keep rendering everywhere, and the size guard still governs them.
- **Old web bundles** (schema 2) only ever see sandbox documents, which stay inline. Share documents require schema 3 from day one, and no desktop build predates assets (D6).
- **Data-URL pastes:** pasting a data-URL image into a library document triggers the same idle conversion. The trigger is the debounced "image node added or `src` changed" hook that §5.2 uses for live documents.

---

## 6. HyperMultimedia: the upstream change and the fallback

### 6.1 Upstream (`@docs.plus/extension-hypermultimedia` 2.4.0, docs.plus repo)

The owner maintains this package, so the change is realistic. It reaches TinyDocy through the daily refresh workflow (`.github/workflows/docs-plus-extensions.yml`).

```ts
type MediaSrcResolver = (
  src: string,
  ctx: { nodeType: "image" | "video" | "audio"; signal: AbortSignal },
) => string | Promise<string> | null;    // null = not mine, keep the default behaviour
// Reject with new MediaSrcError(message, { retryable }) to show the error shell with that message.

interface HyperMultimediaKitOptions {
  resolveSrc?: MediaSrcResolver;
  /** Host-owned srcs (e.g. `asset:`): accepted by parseHTML, Markdown parsing and paste; treated as uploaded media. */
  isHostSrc?: (src: string) => boolean;
}
export function refreshMediaSrc(editor: Editor, src: string): void;  // re-run resolveSrc for views showing src
```

**What it must change**
1. **The node view.** With a resolver, it creates the `img` without `src`, shows the loading shell, then sets the resolved URL or calls `controller.markError(message)`.
   - `ctx.signal` aborts when the view is destroyed. **This is the release signal for object URLs.**
   - The view needs no resolver state of its own.
2. **`parseHTML`** accepts `isHostSrc(src)`, alongside the `hi(src)` check (§1). This fixes cut, copy and paste, and HTML import. **The Markdown parser** keeps such a src instead of blanking it.
3. **`downloadMedia`, `copyMediaNode` and `viewOriginalMedia`** use the **resolved** URL (`img.currentSrc`), never `attrs.src`. A host src counts as `isUploadedMedia`, so View original is hidden.
4. **Markdown and HTML rendering** keep `src` as it is. Export rewrites it afterwards (§5.4).
5. **Tests in the package:**
   - a resolver that rejects shows the error shell
   - abort is called on destroy
   - an `asset:` image survives a copy-and-paste round trip

**TinyDocy wiring.** In `extensions/hyper-multimedia/hyper-multimedia-kit.ts`, the kit is configured with `isHostSrc: (s) => parseAssetRef(s) !== null` and `resolveSrc: assetResolver(blobStore, docContext)`.
- **The resolver is created once per editor and reads the document context from a ref,** so the extensions array never changes identity (AGENTS.md typing-performance rule).
- On desktop it returns the synchronous URL when it can.
- `asset_available` and a completed background fetch call `refreshMediaSrc`.

### 6.2 Fallback, if 2.4.0 isn't out when A1 starts

A local `.extend()` of the `image` child, using the same `addExtensions` mapping the file already uses for the resize controls:
- **`addNodeView`:**
  - Resolve **before** calling the parent view factory, and hand the parent a node whose `src` is already resolved.
  - A present blob on desktop resolves synchronously.
  - On the web, the cache has usually warmed it in the background while the document opened. If not, render the parent with a 1×1 transparent placeholder and swap the src when it resolves. A src change already rebuilds the view.
- **`parseHTML`:** re-declare the two rules, accepting `asset:` too (about 10 lines).
- **Toolbar Download and Copy:** override them through the existing `mediaActions` resolver.
- **Cost:** about a day. The fallback is deleted when 2.4.0 lands, following the AGENTS.md rule on removing shims.
- **Risk:** the swap depends on internal behaviour, the "src change ⇒ rebuild" rule. A test pins it.

---

## 7. States and copy

These are image-level states, drawn inside the image's sized box by the loading or error shell. Document-level states stay in plan §5.5. The UX lead may revise wording at design review.

| State | Where | Copy | Action |
|---|---|---|---|
| Preparing | Insert placeholder (`ImageUploadNode`) | Preparing image… | Cancel |
| Too large (input) | Toast | This image is larger than 20 MB. Choose a smaller file. | — |
| Can't shrink | Toast | This image can't be made smaller than 2 MB. Try a smaller or simpler image. | — |
| GIF too large | Toast | GIFs must be under 2 MB (animations aren't resized). | — |
| SVG or unreadable | Toast | SVG images aren't supported. Export it as PNG or JPEG first. / This image format can't be read here. Try PNG, JPEG, WebP or GIF. | — |
| Save failed (desktop disk full, I/O) | Toast | Couldn't save this image ([reason]). It wasn't added. | Try again |
| Browser storage full (web) | Toast | Your browser is out of space for TinyDocy. Export or delete some documents, then try again. | — |
| Live: not shared yet (inserted offline) | Small badge on the image, for its author | Not shared yet. Collaborators will see this image when you're back online. | — |
| Live: over the image limit | Badge | Only on this computer. This live document has reached its 25 MB image limit, so collaborators can't see this image. | Remove image |
| Live: server full or uploads off | Badge | Only on this computer. The server isn't taking new images right now. | — |
| Joiner: loading | Shimmer shell | (the shell's `aria-label`) Loading image | — |
| Joiner: offline, not downloaded | Box | Image not downloaded yet. It will appear when you're back online. | — |
| Joiner: not uploaded yet (404) | Box | This image hasn't been shared yet. It appears when the person who added it is back online. | — |
| Removed by the operator (410) | Box | This image was removed by the server operator. | Remove image |
| Share ended before download | Box | This image wasn't downloaded before sharing ended. | Remove image |
| Missing locally | Box | Image not found on this computer. | Remove image |
| Needs a newer app | Box | This image needs a newer version of TinyDocy. | Update |
| Share pre-check: too large | Share dialog | This document's images (32 MB) are over the 25 MB limit for live documents. Remove some images, then share again. | — |
| Share pre-check: missing images | Share dialog | 3 images aren't on this computer. Share without them? | Share anyway / Cancel |
| Sharing progress | Chip popover | Uploading images: 4 of 12 | Cancel |

**Accessibility**
- **Placeholders** are `role="img"` with an `aria-label` equal to the state copy, plus the alt text when there is one ("Diagram of the pipeline: image not downloaded yet").
- State changes are **not** announced one by one. One `announce()` fires per document: "12 images are still loading."
- **Alt text:**
  - **Inserts no longer use the file name as alt.** Today the alt is `file.name`, which screen readers read out as "IMG underscore 2034 dot jpg".
  - New images get `alt=""`, and a media-toolbar action, **Alt text…** (through `mediaActions`), edits it.
  - A selected image with no alt shows a quiet "Add alt text" chip.
  - There is **no modal prompt on insert**: it would interrupt writing, and pasting 10 images would mean 10 prompts.
  - Export keeps the alt.

---

## 8. Tests

**Unit (`bun test`, every PR)**
- `asset-ref`: format and parse round trip. An unknown algorithm, uppercase hex, 63 or 65 characters, and `asset:sha256-../x` are all refused.
- **Sniffing:** each type passes. These are refused:
  - an SVG named `.png`
  - an HTML/PNG polyglot whose declared type doesn't match its magic bytes
  - a truncated header
  - a GIF bomb (huge logical screen) → `too_many_pixels`
- **Metadata strippers:**
  - a PNG with `eXIf` and a WebP with EXIF and XMP lose those chunks, with pixels decoding identically
  - a JPEG always goes through re-encode
  - golden files include one with GPS
- **`prepareImageAsset` decisions,** pure, mirroring the existing `planImageEmbed` tests, plus a test that the sandbox path re-encodes JPEG.
- **Server PUT matrix:**
  - a wrong hash → 422
  - a body longer than `Content-Length` → aborted at the cap
  - a missing `Content-Length` → 411
  - a wrong magic → 415
  - JPEG with Exif → 422
  - quota for bytes, count and global → 507
  - a blocked hash → 451
  - a view token → 403
  - an ended share → 410
- **Quota race:** two parallel PUTs at the edge, and exactly one succeeds.
- **Existence oracle:** a hash present in share A but not B gives B `missing` → it PUTs → B's quota is charged. GET from B before the PUT → 404.
- **GC property test (§3.4 invariant):** random sequences over `MemoryBlobStore` and the engine on `bun:sqlite`, with a fake clock. These are never deleted:
  - a referenced blob
  - a version's blob
  - a blob restorable from a daily copy younger than 7 days
- **Object-URL cache:** after `acquire`/`release` churn and editor destroy, `createObjectURL` count = `revokeObjectURL` count.
- **Migration (§5.5):**
  - a document with 10 data-URL images converts in one forward edit
  - each asset's bytes hash-equal the decoded data URL, after stripping
  - an `src` changed concurrently is left alone
  - the UndoManager stack is unchanged
  - `encodeStateAsUpdate` drops from about 2.6 MB to under 10 KB
- **Export round trip:** `TINYDOC2` export → import into an empty library gives the same Yjs state and the same blobs. One corrupted asset is dropped, and only that image shows as missing.
- **Markdown export:** the image folder's files hash-match, and the links resolve.

**Durability soak** (adds to plan §9)

| Case | Covers |
|---|---|
| T16 | SIGKILL during an asset write: at each of the steps in §3.2. No reference without bytes. Orphans are swept. |
| T17 | SIGKILL during migration: the document is either unchanged or fully converted per image, and no data URL is lost |
| T18 | A year of image churn: library and asset folder size, GC within the grace period, backup `assets/` GC |
| T19 (Live) | Insert offline, quit, relaunch, reconnect: the image uploads through reconciliation and the peer sees it |

**Playwright**
- `local`:
  - paste 3 images → reload → they render
  - cut and paste an image across documents → it renders, and a `doc_blobs` row exists for the target
  - print preview has every image
- `electron`:
  - the protocol handler serves only valid hex
  - path traversal → 404
  - no network requests from a library document with images
- Staging (Live):
  - A shares a document with 12 images → B joins on the web and on desktop, and sees them all
  - B goes offline, then A inserts → B reconnects and sees it after `asset_available`
  - quota exceeded → badge
  - `share-admin block-asset` → 410 → the removed state on both
- **Mixed versions:**
  - a schema-2 bundle is refused on share documents
  - pasting an `asset:` image into a **sandbox** document converts it to an inline data URL (≤ 256 KiB), or refuses it with a toast
  - Hocus refuses an `asset:` src in a non-share document (`schema_rejected`, logged as `asset_ref_in_sandbox`)
  - `asset:blake3-…` shows "needs a newer version" and is never modified
  - a view-only joiner never migrates or uploads
- **Perf:**
  - inserting 10 photos of 12 MP while typing stays within the `perf` budget, with encoding in a worker
  - opening a document with 200 images makes at most 2–4 concurrent asset requests

---

## 9. PRs

**Effort scale:** S ≤ 1 agent-day plus 1 review round. M is 2–4 days with 2–3 rounds. L is 5 or more days, or touches server and deploy.

| # | PR | Depends on | Effort | Lens | Exit criteria |
|---|---|---|---|---|---|
| **A0** | **Web privacy fix:** JPEG always re-encoded on the sandbox path, and new images get `alt=""` instead of the file name. Visible: CHANGELOG. | — | S | SE | GPS golden test. No size regression in `image-downscale` tests. |
| **U1** | Upstream HyperMultimedia 2.4.0: `resolveSrc`, `isHostSrc`, `refreshMediaSrc`, resolved-URL toolbar actions (docs.plus repo) | — | M | SE (ProseMirror/Tiptap author lens: leaks, view churn) | Package tests in §6.1. The refresh-workflow PR lands in TinyDocy. |
| **A1** | Shared asset core in `lib/assets/`: ref, sniff, strippers, hash, `prepareImageAsset` with a worker encoder, `BlobStore` port with `MemoryBlobStore`, resolver and object-URL cache, kit wiring (or the §6.2 fallback), Alt text… action, `CLIENT_SCHEMA = 3`, sandbox paste policy | U1 (or the fallback) | M–L | SE + UX | Unit tests in §8. Editor chunk within the 600 B gz allowance; the resolver and strippers are lazy, with only `isHostSrc` eager. Web sandbox behaviour unchanged apart from A0. |
| **P2.6b** | Desktop asset storage: worker `assets/` files, `blobs` and `doc_blobs`, `asset.put/has/ensure/recount` IPC with guards, `/_asset/` protocol route, startup `tmp/` sweep, GC job, `quick_check` sample | P2.5, P2.6, A1 | L | SE + DE | T16 and the GC property test pass. The protocol route fuzz passes. |
| **P2.6c** | Desktop migration and import conversion (§5.5) | P2.6b | M | SE | T17. Size-drop test. The undo stack is untouched. |
| **P2.8+** | `TINYDOC2` with assets, Markdown image folder, HTML with data URLs, import verification | P2.6b | M | DE | Round-trip tests in §8. |
| **P2.9b+** | Backups `assets/` folder, backup asset GC, restore with images, print `beforeprint` resolve | P2.6b, P2.12 | M | DE + UX | Backup → restore round trip with images. The print preview shows every image. |
| **P2.10+** | Web Download includes assets (`TINYDOC2`) | A1, W11 | S | DE | The download imports into desktop with identical images. |
| **W11** | Web library `IdbBlobStore` (one-transaction put, quota copy, GC, migration on open) | Web library storage PR, A1 | M | SE | Same contract suite as `MemoryBlobStore`. Quota error path e2e. |
| **S-A1** | Server asset store: tables, PUT, GET and missing endpoints in Hocus, streaming verification, quotas, `HOCUS_ASSETS`, `/api/info` fields, `asset_available` broadcast, daily sweep, reset copies rows, tombstone 410s, Hocus refusal of `asset:` in non-share documents, CSP `connect-src` https origin. **Deploy note:** Traefik route for `ws.tiny.docs.plus/api/shares/*`, env, backup of `assets/`. | P4.2a–c | L | SE | Server matrix in §8. Capacity test on staging: asset GETs never cause a WS ban. |
| **S-A2** | Abuse: `share-admin assets / block-asset / end --preserve`, export with assets, report reason, alerts | S-A1, P4.2e | M | SE + O | The takedown runbook is rehearsed on staging once. |
| **P4.4+** | Desktop share flow: asset pre-check, upload before commit, reconciliation, joiner fetch in main, background prefetch, image states. **Design review.** | S-A1, P2.6b | L | UX + SE | T19. An e2e test for each image state. Quitting mid-upload publishes nothing. |
| **P4.3+** | Web `/s/` and web-library joiners: token fetch, verification, IndexedDB cache, states. **Design review.** | S-A1, A1, W11 | M | UX + DE | Staging e2e: web and desktop joiners see the same images. |

**Order:** A0 and U1 can start now. A1 → P2.6b → (P2.6c, P2.8+, P2.9b+) inside Phase 2. W11 follows the web library. S-A1 and S-A2 come after P4.2. P4.3+ and P4.4+ come last.

**Added calendar time:** about 2–3 weeks on the Local milestone (A1, P2.6b, P2.6c, the export and backup extensions) and about 2 weeks on the Live milestone (S-A1, S-A2, the share-flow extensions), mostly in review rounds and the staging rehearsal.

**Risks**

| # | Risk | Mitigation |
|---|---|---|
| R1 | U1 slips | The §6.2 fallback, pinned by a test, deleted when U1 lands |
| R2 | Object-URL or resolver leaks in long sessions | Release through `AbortSignal`, the counting test, a heap check in the `perf` project after 20 tab switches |
| R3 | Web storage eviction loses image bytes (Safari) | `persist()`, the web library's warnings, readable exports. Shared documents can fetch again. |
| R4 | Asset fetch storms get users banned | Separate HTTP limits, never fed into WS Throttle. 2–4 concurrent requests. Backoff. |
| R5 | Server disk fills | `MAX_ASSET_STORE_BYTES`, `asset_store_full` copy, an alert at 80% |
| R6 | Illegal images | §4.7, plus Q3 |
| R7 | Encoding jank on large photos | A worker encoder, with a perf exit criterion in A1 |
| R8 | GC deletes something a restore needs | The 30-day grace, the property test, T18 |

---

## 10. Owner questions (blocking)

| # | Question | Blocks | Recommendation |
|---|---|---|---|
| Q1 | **How much free disk does the production box have for images?** It sets `MAX_ASSET_STORE_BYTES` and the cost row. | S-A1 defaults, Gate 4 | 10 GiB, or 25% of free disk, whichever is smaller |
| Q2 | **The per-share image quota.** | S-A1, the share copy | 25 MiB and 300 images: about 50–100 photos at 2560 px |
| Q3 | **Scanning and legal posture for images:** is report plus takedown plus an exact-hash blocklist enough, or must uploads be scanned (PhotoDNA, Safer)? Also, how may the operator review reported images, and how long must removed images be preserved? This folds into the existing Gate 4 legal advice. | Gate 4, S-A2 | Ask the legal adviser specifically about images |
| Q4 | **Confirm the public sandbox stays inline** (no server image uploads without a share). | A1, S-A1 | Yes (I7) |

Everything else in this document is a call with a recommended default that the owner can reverse:
- no SVG
- a 2 MiB and 2560 px cap per asset
- files on disk
- the Hocus host instead of a separate user-content domain
- no CDN and no Range requests
- `alt=""` plus an Alt text action instead of a prompt
- a 30-day GC grace period

---

## Sources

- SQLite, [Internal Versus External BLOBs](https://www.sqlite.org/intern-v-extern-blob.html): below about 100 KB, BLOBs inside the database read faster; above it, separate files do.
- Matrix.org, [Sunsetting unauthenticated media](https://matrix.org/blog/2024/06/26/sunsetting-unauthenticated-media/) (2024), and [Building a safer Matrix](https://matrix.org/blog/2025/02/building-a-safer-matrix/) (2025): authenticated media stopped abuse as a content distribution network.
- D. Harnik, B. Pinkas, A. Shulman-Peleg, [Side Channels in Cloud Services: Deduplication in Cloud Storage](https://ieeexplore.ieee.org/document/5655218), IEEE Security & Privacy, 2010.
- Electron, [protocol API](https://www.electronjs.org/docs/latest/api/protocol) (`protocol.handle`, `registerSchemesAsPrivileged`).
- MDN, [`image-orientation`](https://developer.mozilla.org/en-US/docs/Web/CSS/image-orientation): Exif orientation is applied by default.
- WebKit, [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/): the 7-day cap on script-writable storage.
- Cloudflare, [CSAM Scanning Tool](https://developers.cloudflare.com/cache/reference/csam-scanning/): it scans only cached content.
- OWASP, [File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): allowlisted types, magic-byte checks, size limits, serving with safe headers.
- Precedent for keeping blobs out of the CRDT: BlockSuite and AFFiNE keep a separate blob source alongside Yjs persistence ([`IndexedDBBlobSource`](https://blocksuite.affine.pro/api/@blocksuite/sync/classes/IndexedDBBlobSource.html)). Excalidraw stores image files apart from the scene and loads them by file id.
- Measured locally, 2026-11-16: Yjs state size before and after replacing a 256 KiB data-URL attribute (§1). Hocuspocus `defaultConfiguration.yDocOptions.gc = true` (`node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js`).
