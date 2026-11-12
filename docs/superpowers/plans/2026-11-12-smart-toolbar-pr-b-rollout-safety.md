# Smart toolbar PR B (release N, rollout safety): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release N. After it, a stale or hostile client can no longer delete or freeze shared content when PR C adds the `textColor` and `fontSize` marks. Release N adds no mark-creating UI.

**Architecture:** There are three client guards and two server guards.

Client guards:
- A `schema`/`build` URL parameter on the shared WebSocket.
- A new offline namespace (`~s2`) whose legacy copies merge transactionally.
- A y-tiptap `onInvalidContent` handler (B1). It freezes the editor on unknown names and repairs known-name misfits in Yjs.

Server guards:
- A version gate in `onConnect`. It is log-only here (`HOCUS_MIN_CLIENT_SCHEMA` defaults to 0) and drops frames from outdated sockets.
- An ingress allowlist of element and mark names (B2) in the document guard. The allowlist already includes the PR C names.

Highlights render from tokens, but the stored attribute keeps its key `color`.

**Tech Stack:** Bun ≥ 1.4.4, `bun test` (happy-dom preload), Playwright, Next.js 16, Tiptap 3.33 + `@tiptap/y-tiptap` 3.3.0, Yjs 13.6, Hocuspocus 4.8 (`Bun.serve` + `handleConnection`), `bun:sqlite`, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`. It is the source for §3, §3.1 (release N and the HoE blocking fixes B1 and B2), §8 item 2 and the "Per-PR go criteria (HoE) → B" list. Evidence is in `docs/superpowers/specs/2026-11-12-smart-toolbar-experiments.md`.

## Global Constraints

- Use Bun only: `bun`, `bun <bin>`, `bunx --bun`. Never use npm, npx, yarn or pnpm. Use SQLite through `openSqlite()` / `bun:sqlite`.
- Unit tests:
  - Use `bun test` from `bun:test`.
  - For module mocks, spread the real module into `mock.module`, then `await import()`.
  - Load modules that read env at import time through `importFresh()`, and call `resetModules()` in `afterEach`.
- Run Playwright with `CI= bun playwright test --project=chromium` against `make dev`.
- `CLIENT_SCHEMA = 2`. Release N **sends 2**. Pre-N bundles send nothing, which counts as 0.
- `HOCUS_MIN_CLIENT_SCHEMA` defaults to **0, which means log only**. **There is no `SCHEMA_FLOOR` in this PR.** That belongs to PR C.
- Gate predicate:
  - At min 0, never refuse anything.
  - At min ≥ 1, refuse unless `schema` matches `/^\d+$/` and its value is ≥ min. A missing value counts as `0`.
- Order in `onConnect`: tombstone check, then gate, then `canConnect`.
  - `global-tabs` and every `global-tabs-*` name are exempt.
  - `playground` is gated.
- The gate never uses `reject()` and never uses `logAbuseEvent`. It logs a per-minute aggregate in fixed buckets (`missing`, `invalid`, `low`, `ok`, plus `refused`). It never logs raw `schema` values.
- Close reasons and copy:
  - The refusal reason is `client_outdated`.
  - The B2 close is `{ code: 4422, reason: "schema_rejected" }`, logged as the abuse event `ws_unknown_schema_name`.
  - Neither reason makes the client reconnect.
- The offline key is `` `1:${host}~s2:${name}` ``. `OFFLINE_CACHE_EPOCH` stays `1`.
  - Delete a legacy key only after a successful save, and only inside one IndexedDB transaction that checks it is unchanged.
  - Every removal path deletes both keys.
- `@tiptap/y-tiptap` stays ≥ 3.3.0, with one copy in the tree.
- Never use a ProseMirror attribute `validate`. Never add an attribute to an existing mark or node. Highlight keeps the attribute key `color`.
- The B2 allowlist (`lib/schema-names.ts`) is current schema + legacy `link`/`code` + pending `textColor`/`fontSize`. Nothing else.
- Banner copy, verbatim:
  - Outdated: "A newer TinyDocy is available. Reload to keep editing; your changes on this device are kept."
  - Failed repair: "This document can't be edited in this version."
- Code style:
  - Named exports only, kebab-case files.
  - shadcn `Button` from `components/ui/`, icons from `lib/icons.tsx`.
  - Biome via `bun run check`.
- Commits:
  - Use Conventional Commits in the imperative mood.
  - **No AI/tool trailers.** AGENTS.md overrides any attribution reminder.
  - Before every commit, show a commit review report (files, diff summary, message) and **wait for explicit approval**.
- Branch: `feat/schema-rollout-safety`.
  - Cut it from `main` once the spec PR (`feat/smart-toolbar`) has merged.
  - If it is stacked on `feat/smart-toolbar` instead, retarget it to `main` before the parent merges.

## Review Focus

Each of these failure modes is pinned by a test in the task that owns the code.

1. **Odd `schema` values:** `""`, `" 2"`, `"2.0"`, `"0x2"`, `"1e1"`, `"-2"`, and a repeated `schema=1&schema=2`. Expected: refused at min ≥ 1 and accepted at min 0. They fall in the `invalid` bucket and are never echoed into a log. Test: Task 5, `isClientOutdated` table.
2. **Refused with no device copy:** a client with no device copy must see the update banner, not an endless skeleton. Test: Task 8, e2e "no device copy".
3. **Two clients repairing the same misfit at once:** after the merge the document stays valid and both editors unfreeze, at worst with two leading headings. It never freezes. Test: Task 1, "concurrent repairs converge".
4. **A pre-N tab rewrites the legacy key between merge and retirement:** its newer legacy copy survives, and the next load merges it. Test: Task 6, "keeps a legacy copy rewritten after the merge".
5. **An N client detached for `client_outdated` while the socket reconnects** never re-attaches that document. That would mean one `onConnect` per reconnect, which leads to a Throttle ban. Test: Task 7, "a refused session never re-attaches".

---

### Task 1: B1 experiment: does a targeted Yjs repair unfreeze y-tiptap?

This task carries the riskiest unknown, so it runs first. HoE B1 accepts the freeze only if `projectionError` resets on the next projection (`ProsemirrorBinding.ts:174`), so that a repair unfreezes the editor.

**Decision gate:** check the "unfreezes" tests in this order:
1. The repaired fragment passes `schema.topNodeType.validContent`.
2. `binding.invalidContentError` is `null`.

If (1) passes and (2) fails, **stop**. Report to the owner with the failing output: B1 is disproved, and PR B must be redesigned.

**Files:**
- Create: `lib/schema-names.ts`. In this task it holds only `HASHED_MARK_SUFFIX` and `markNameFromKey`, moved from `lib/yjs-mark-migration.ts`.
- Modify: `lib/yjs-mark-migration.ts`. Use `markNameFromKey` and delete the local regex.
- Create: `lib/schema-repair.ts`.
- Create: `tests/helpers/collab-editor.ts`.
- Test: `tests/unit/extensions/schema-repair.test.ts`.

**Interfaces:**
- Produces:
  - `markNameFromKey(key: string): string`. It strips y-prosemirror's `--<8 chars>` suffix.
  - `SCHEMA_REPAIR_ORIGIN: symbol`.
  - `findUnknownSchemaNames(fragment: Y.XmlFragment, schema: Schema, limit = 20): string[]`. Returns unique names, in walk order.
  - `type RepairResult = "inserted-title" | "seeded" | "none"`.
  - `repairKnownMisfit(fragment: Y.XmlFragment): RepairResult`.
  - The test helper `createCollabEditor(options?: { server?: Y.Doc }): CollabEditorFixture`, which returns:
    - `{ schema, server, client, fragment, editor, errors: Error[], outgoing: Uint8Array[]`
    - `binding(): ProsemirrorBinding | undefined`
    - `remote(fn: (frag: Y.XmlFragment) => void): void`
    - `pause(): void`
    - `resume(): void`
    - `destroy(): void }`
  - The helper's extensions are `StarterKit.configure({ document: false, undoRedo: false, link: false, code: false, trailingNode: { node: "paragraph" } })`, `TitleDocument`, and `CollaborationRenderOnce.configure({ document: client, ySyncOptions: { onInvalidContent: e => errors.push(e) } })`.
  - The helper builds `server` with `prosemirrorJSONToYDoc(schema, { type: "doc", content: [heading(1, "Title"), paragraph("hello world")] }, "default")`.
  - The helper wires both ways:
    - It applies client updates to the server with the client doc as the origin.
    - It applies server updates to each client unless the origin is that same client.
    - Several fixtures can share one `server`, and each sees the others' writes.
  - Every client update that is not from the server goes into `outgoing`.
  - `pause()` queues updates in both directions, and `resume()` flushes the queue.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "bun:test";
import { yXmlFragmentToProseMirrorFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { findUnknownSchemaNames, repairKnownMisfit } from "@/lib/schema-repair";
import { markNameFromKey } from "@/lib/schema-names";
import { createCollabEditor } from "@/tests/helpers/collab-editor";

const tick = () => new Promise((r) => setTimeout(r, 0));
const fits = (f: ReturnType<typeof createCollabEditor>) =>
  f.schema.topNodeType.validContent(yXmlFragmentToProseMirrorFragment(f.fragment, f.schema));

describe("B1: freeze on unknown names, repair known misfits", () => {
  it("freezes on an unknown mark, keeps the block and sends nothing", async () => {
    const f = createCollabEditor();
    // fragment index 1 is the "hello world" paragraph
    f.remote((frag) =>
      ((frag.get(1) as Y.XmlElement).get(0) as Y.XmlText).format(0, 5, { zzz: { v: 1 } }));
    await tick();
    expect(f.errors).toHaveLength(1);
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expect(f.editor.view.editable).toBe(false);
    expect(findUnknownSchemaNames(f.fragment, f.schema)).toEqual(["zzz"]);
    const sent = f.outgoing.length;
    f.editor.view.dispatch(f.editor.state.tr.insertText("X", 1));
    expect(f.outgoing.length).toBe(sent);
    expect(f.server.getXmlFragment("default").toString()).toContain("hello world");
    f.destroy();
  });

  it("reads hashed mark keys by name", () => {
    expect(markNameFromKey("zzz--abcd1234")).toBe("zzz");
    expect(markNameFromKey("bold--AbC+/=12")).toBe("bold");
    expect(markNameFromKey("bold")).toBe("bold");
  });

  it("unfreezes after inserting a title before a leading paragraph", async () => {
    const f = createCollabEditor();
    f.remote((frag) => frag.insert(0, [new Y.XmlElement("paragraph")]));
    await tick();
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expect(findUnknownSchemaNames(f.fragment, f.schema)).toEqual([]);
    expect(repairKnownMisfit(f.fragment)).toBe("inserted-title");
    expect(fits(f)).toBe(true);                                // gate (1)
    expect(f.binding()?.invalidContentError).toBeNull();       // gate (2): the hypothesis
    expect(f.editor.view.editable).toBe(true);
    const sent = f.outgoing.length;
    f.editor.commands.insertContentAt(1, "X");
    expect(f.outgoing.length).toBeGreaterThan(sent);
    expect(f.server.getXmlFragment("default").toString()).toContain("X");
    f.destroy();
  });

  it("unfreezes after delete-all is reseeded", async () => {
    const f = createCollabEditor();
    f.remote((frag) => frag.delete(0, frag.length));
    await tick();
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expect(repairKnownMisfit(f.fragment)).toBe("seeded");
    expect(fits(f)).toBe(true);
    expect(f.binding()?.invalidContentError).toBeNull();
    f.destroy();
  });

  it("reports a known misfit it cannot fix", async () => {
    const f = createCollabEditor();
    f.remote((frag) => frag.insert(1, [new Y.XmlElement("listItem")]));
    await tick();
    expect(findUnknownSchemaNames(f.fragment, f.schema)).toEqual([]);
    expect(repairKnownMisfit(f.fragment)).toBe("none");
    expect(f.binding()?.invalidContentError).not.toBeNull();
    f.destroy();
  });

  it("concurrent repairs converge", async () => {
    const a = createCollabEditor();
    const b = createCollabEditor({ server: a.server });
    a.remote((frag) => frag.insert(0, [new Y.XmlElement("paragraph")]));
    await tick();
    expect(b.binding()?.invalidContentError).not.toBeNull();
    a.pause();
    b.pause();
    repairKnownMisfit(a.fragment);
    repairKnownMisfit(b.fragment);
    a.resume();
    b.resume();
    await tick();
    expect(a.fragment.toString()).toBe(b.fragment.toString());
    for (const f of [a, b]) {
      expect(fits(f)).toBe(true);
      expect(f.binding()?.invalidContentError).toBeNull();
    }
    a.destroy();
    b.destroy();
  });

  it("runs on one copy of y-tiptap ≥ 3.3.0", async () => {
    // the package's `exports` map blocks a `package.json` subpath import
    const { version } = await Bun.file("node_modules/@tiptap/y-tiptap/package.json").json();
    expect(Bun.semver.satisfies(version, ">=3.3.0")).toBe(true);
    const pkg = await Bun.file("package.json").json();
    expect(Bun.semver.satisfies("3.2.9", pkg.dependencies["@tiptap/y-tiptap"])).toBe(false);
    const viaCollab = Bun.resolveSync("@tiptap/y-tiptap",
      Bun.resolveSync("@tiptap/extension-collaboration", import.meta.dir));
    expect(viaCollab).toBe(Bun.resolveSync("@tiptap/y-tiptap", import.meta.dir));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/extensions/schema-repair.test.ts`
Expected: FAIL with `Cannot find module "@/lib/schema-repair"`.

- [ ] **Step 3: Implement `lib/schema-names.ts` (suffix only), `lib/schema-repair.ts`, and refactor `lib/yjs-mark-migration.ts`**

`findUnknownSchemaNames`:
- Walk elements recursively.
  - An `XmlElement` whose `nodeName` is not in `schema.nodes` counts as unknown.
  - For an `XmlText`, take each `toDelta()` attribute key, apply `markNameFromKey`, and count it as unknown when it is not in `schema.marks`.
- Stop at `limit`.

`repairKnownMisfit`:
- Write in one `fragment.doc.transact(…, SCHEMA_REPAIR_ORIGIN)`:
  - An empty fragment gets `heading(level 1)` + `paragraph` inserted, and returns `"seeded"`.
  - When the first child is not an `XmlElement` named `heading`, insert `heading(level 1)` at 0 and return `"inserted-title"`.
  - Otherwise write nothing and return `"none"`.
- Set the level with `setAttribute("level", 1)`, as y-prosemirror stores attrs.
- Never call editor APIs: `filterTransaction` drops ProseMirror writes while frozen.
- Callers must run this after `onInvalidContent` returns. Called inside the binding's `mux`, `_typeChanged` is swallowed.

- [ ] **Step 4: Run the tests and apply the decision gate**

Run: `bun test tests/unit/extensions/schema-repair.test.ts tests/unit/lib/yjs-mark-migration.test.ts`
Expected: PASS.
- If an "unfreezes" test fails at gate (2) while gate (1) passes, **stop here and report**. Do not start Task 2.
- If gate (1) fails, the repair itself is wrong. Fix it and re-run.

- [ ] **Step 5: Commit** (review report, then wait for approval)

```bash
git add lib/schema-names.ts lib/schema-repair.ts lib/yjs-mark-migration.ts tests/helpers/collab-editor.ts tests/unit/extensions/schema-repair.test.ts
git commit -m "feat: add schema repair primitives proven to unfreeze y-tiptap"
```

---

### Task 2: Schema-name allowlist and schema snapshot

**Files:**
- Modify: `lib/schema-names.ts`. Keep it dependency-free, because Hocus imports it.
- Create: `tests/helpers/editor-schema.ts`.
- Create: `tests/helpers/describe-schema.ts`.
- Create: `tests/fixtures/schema-snapshot.json`.
- Test: `tests/unit/schema/schema-names.test.ts`.
- Test: `tests/unit/schema/schema-snapshot.test.ts`.

**Interfaces:**
- Consumes: `markNameFromKey` (Task 1).
- Produces:
  - `LEGACY_MARK_NAMES = ["link", "code"] as const`.
  - `PENDING_MARK_NAMES = ["textColor", "fontSize"] as const`.
  - `SCHEMA_NODE_NAMES: ReadonlySet<string>`.
  - `SCHEMA_MARK_NAMES: ReadonlySet<string>`, which includes the legacy and pending names.
  - `isAllowedNodeName(name: string): boolean`.
  - `isAllowedMarkKey(key: string): boolean`, which uses `markNameFromKey`.
  - `getEditorSchema(): Schema`. It calls `getSchema(buildDocumentEditorExtensions({ documentId: "schema-test", ydoc: new Y.Doc(), provider: {} as HocuspocusProvider, onFoldChange() {}, onFilterChange() {}, onTocUpdate() {} }))`.
  - `describeSchema(schema: Schema): SchemaDescription`. For each node, by sorted name: `{ content, group, marks, inline, atom, attrs: sortedKeys }`. For each mark: `{ attrs: sortedKeys, inclusive, excludes }`.

- [ ] **Step 1: Write the failing tests**

```ts
// schema-names.test.ts
const schema = getEditorSchema();
it("allowlists every node and mark the editor can write", () => {
  expect(Object.keys(schema.nodes).filter((n) => !SCHEMA_NODE_NAMES.has(n))).toEqual([]);
  expect(Object.keys(schema.marks).filter((m) => !SCHEMA_MARK_NAMES.has(m))).toEqual([]);
});
it("allows nothing beyond the schema except legacy and pending marks", () => {
  expect([...SCHEMA_NODE_NAMES].filter((n) => !(n in schema.nodes))).toEqual([]);
  expect([...SCHEMA_MARK_NAMES].filter((m) => !(m in schema.marks)).sort())
    .toEqual(["code", "fontSize", "link", "textColor"]);
});
it("accepts hashed keys of allowed marks only", () => {
  expect(isAllowedMarkKey("hyperlink--abcd1234")).toBe(true);
  expect(isAllowedMarkKey("zzz--abcd1234")).toBe(false);
});

// schema-snapshot.test.ts
it("matches the committed schema snapshot (§3 schema evolution rule)", async () => {
  const current = describeSchema(getEditorSchema());
  if (process.env.UPDATE_SCHEMA_SNAPSHOT === "1") {
    await Bun.write("tests/fixtures/schema-snapshot.json", `${JSON.stringify(current, null, 2)}\n`);
    throw new Error("Snapshot rewritten: check the diff against spec §3 (add only; no new attrs on existing types; never loosen content or marks)");
  }
  expect(current).toEqual(snapshot);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/schema/schema-names.test.ts tests/unit/schema/schema-snapshot.test.ts`
Expected: FAIL. `SCHEMA_NODE_NAMES` is not exported, and the fixture is missing.

If `getEditorSchema()` throws while importing `document-editor-config.ts` (a stylesheet or a browser-only module), stub that module in `tests/helpers/editor-schema.ts`. Spread it into `mock.module` and `await import()` the config afterwards. Record the stub in the helper's doc comment.

- [ ] **Step 3: Fill the name sets**

Copy the sets from the real schema as listed by the first test's failure output. Add the legacy and pending names. Then generate the snapshot:

Run: `UPDATE_SCHEMA_SNAPSHOT=1 bun test tests/unit/schema/schema-snapshot.test.ts`
Expected: FAIL with "Snapshot rewritten". Review the JSON and keep it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/schema`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat: add schema-name allowlist and schema snapshot test`

---

### Task 3: B2: refuse unknown names at ingress

**Files:**
- Modify: `lib/security/hocus-document-guard.ts`.
- Test: `tests/unit/lib/security/hocus-document-guard.test.ts`.

**Interfaces:**
- Consumes: `isAllowedNodeName`, `isAllowedMarkKey` (Task 2) and `getEditorSchema` (Task 2).
- Produces:
  - `SCHEMA_REJECTED = { code: 4422, reason: "schema_rejected" } as const`.
    - 4422 is free: `@hocuspocus/common` uses 4401, 4403 and 4408, and this repo uses 4205, 4408 and 4413.
  - `findDisallowedSchemaNames(update: Uint8Array, limit = 3): string[] | null`. It returns `null` when the update cannot be decoded. Names are truncated to 40 chars.

- [ ] **Step 1: Write the failing tests**

```ts
const schema = getEditorSchema();
const toUpdate = (json: JSONContent) =>
  Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, json, "default"));

it("passes every fixture and the playground (allowlist drift guard)", () => {
  for (const json of [...FIXTURES, generatePlaygroundContent()]) {
    expect(findDisallowedSchemaNames(toUpdate(json))).toEqual([]);
  }
});
it("allows legacy, pending and hashed mark keys", () => { /* XmlText.format with link, code, textColor, fontSize, hyperlink--abcd1234 → [] */ });
it("names unknown elements and marks", () => { /* XmlElement("zzz") → ["zzz"]; format zzz--abcd1234 → ["zzz"] */ });
it("fails closed on bytes it cannot decode", () => {
  expect(findDisallowedSchemaNames(Uint8Array.from([255, 255, 255]))).toBeNull();
});
it("closes with schema_rejected before any size check and logs ws_unknown_schema_name", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const guard = new DocumentGuard({ maxDocumentBytes: () => 1e9, maxAwarenessStateBytes: 4096 });
  await expect(guard.beforeHandleMessage(payloadFor("doc", unknownUpdate))).rejects.toEqual(SCHEMA_REJECTED);
  expect(warn.mock.calls.map(String).join()).toContain("ws_unknown_schema_name");
  expect(warn.mock.calls.map(String).join()).not.toContain("ws_guardrail_rejected");
});
```

`FIXTURES` covers every `tests/fixtures/*.json` document. `payloadFor` builds a sync-update frame with `lib0/encoding`:
1. `writeVarString(name)`
2. `writeVarUint(0)`
3. `writeVarUint(2)`
4. `writeVarUint8Array(update)`

The payload also needs `requestHeaders: new Headers()` and `document: new Y.Doc()`. The guard has no recorded size, which proves the name check runs first.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/lib/security/hocus-document-guard.test.ts`
Expected: FAIL with `findDisallowedSchemaNames is not exported`.

- [ ] **Step 3: Implement**

`findDisallowedSchemaNames`:
- Decode with `Y.decodeUpdate(update).structs`. For each `Y.Item`:
  - a `Y.ContentType` whose `type` is a `Y.XmlElement` is checked with `isAllowedNodeName(type.nodeName)`;
  - a `Y.ContentFormat` is checked with `isAllowedMarkKey(content.key)`.
- Use try/catch: a decode error returns `null`.

In `beforeHandleMessage`:
- Read `readSyncUpdate(update)` once, but only for `isDocumentUpdateFrame` frames.
- Run the name check **before** the `!size` early return.
- When the result is `null` or a non-empty list, call `logAbuseEvent("ws_unknown_schema_name", { ip, documentName, names })` and throw `SCHEMA_REJECTED`.

Leave a known gap documented in a comment: element attribute keys and marks on inline atom nodes are not checked. y-prosemirror stores no marks on elements, and Tiptap drops unknown attributes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/lib/security`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(security): refuse updates with unknown schema names at ingress`

---

### Task 4: Client version parameters

**Files:**
- Create: `lib/schema-version.ts`.
- Modify: `lib/hocuspocus.ts:56-60`. Wrap the URL in `withClientVersion`.
- Modify: `next.config.ts`. Set `env.NEXT_PUBLIC_BUILD_ID`.
- Modify: `tests/load/yjs-load-harness.ts:73`. Send the version.
- Test: `tests/unit/lib/schema-version.test.ts`.

**Interfaces:**
- Produces:
  - `CLIENT_SCHEMA = 2`.
  - `CLIENT_BUILD: string`, set to `process.env.NEXT_PUBLIC_BUILD_ID?.trim() || "dev"`.
  - `withClientVersion(wsUrl: string): string`. It sets the `schema` and `build` search params.
  - `window.__HOCUS_SCHEMA?: string`, an e2e hook that overrides the `schema` value.
  - The module must stay importable by the server, so it has no browser imports at module level.
- Build id: in `next.config.ts`, use `process.env.NEXT_PUBLIC_BUILD_ID`. Fall back to `git rev-parse --short=12 HEAD` (via `execSync` in a try/catch), then to `package.json` `version`.

- [ ] **Step 1: Write the failing tests**

```ts
it("adds schema=2 and build without touching host or path", () => {
  const url = new URL(withClientVersion("wss://ws.example/collab?x=1"));
  expect(url.searchParams.get("schema")).toBe("2");
  expect(url.searchParams.get("build")).toBe(CLIENT_BUILD);
  expect(url.searchParams.get("x")).toBe("1");
  expect(url.host).toBe("ws.example");
  expect(url.pathname).toBe("/collab");
});
it("lets e2e override the schema value", () => {
  window.__HOCUS_SCHEMA = "1";
  expect(new URL(withClientVersion("ws://127.0.0.1:1234")).searchParams.get("schema")).toBe("1");
  delete window.__HOCUS_SCHEMA;
});
it("leaves the URL that offline keys are scoped by unchanged", () => {
  expect(getHocuspocusWsUrl()).not.toContain("schema=");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/lib/schema-version.test.ts`
Expected: FAIL with `Cannot find module "@/lib/schema-version"`.

- [ ] **Step 3: Implement**

Implement the module, the `getSharedHocuspocusSocket` wrap, the `next.config.ts` env entry and the load-harness URL.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/lib/schema-version.test.ts tests/unit/lib/collab-session.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat: send client schema and build on the collab socket`

---

### Task 5: Server version gate (log-only) with frame drop and bucketed counts

**Files:**
- Create: `lib/security/hocus-frame.ts`. Move `readVarUint` here from `hocus-document-guard.ts`, and add the frame header reader.
- Create: `lib/security/client-schema-gate.ts`.
- Modify: `lib/security/guardrail-config.ts`. Add `HOCUS_MIN_CLIENT_SCHEMA`, using `parseEnvInt(…, 0, 0)`.
- Modify: `scripts/hocus-server.ts`, in four places:
  - `SocketData.outdated`;
  - the `fetch` upgrade;
  - `message()`;
  - `onConnect`, plus the startup log line and `counter.stop()` in `shutdown`.
- Create: `tests/helpers/spawn-hocus.ts`.
- Test: `tests/unit/lib/security/client-schema-gate.test.ts`.
- Test: `tests/unit/lib/security/guardrail-config.test.ts`. Add the key to `ENV_KEYS` and add a default/override case.
- Test: `tests/unit/scripts/hocus-client-gate.test.ts`.

**Interfaces:**
- Consumes: `CLIENT_SCHEMA` (Task 4).
- Produces:
  - `readFrameHeader(frame: Uint8Array): { documentName: string; messageType: number } | null`.
  - `HOCUS_MESSAGE_AUTH = 2`.
  - `CLIENT_OUTDATED_REASON = "client_outdated"`.
  - `isClientOutdated(raw: string | null, minSchema: number): boolean`.
  - `classifyClientSchema(raw: string | null): "missing" | "invalid" | "low" | "ok"`. Buckets are relative to `CLIENT_SCHEMA`, so the 95% metric can be read while min is 0.
  - `isGateExempt(documentName: string): boolean`.
  - `clientOutdatedError(): Error & { reason: string }`. It has an empty stack and does not log.
  - `shouldDropOutdatedFrame(frame: Uint8Array): boolean`. It returns false for Auth frames and exempt documents, and true otherwise, including malformed frames.
  - `createClientSchemaCounter({ intervalMs = 60_000, maxBuilds = 20, log = console.log }): { record(params: URLSearchParams, refused: boolean): void; flush(): void; stop(): void }`.
  - `spawnHocus(env?: Record<string, string>): Promise<{ url: string; dbPath: string; logs(): string; stop(): Promise<void> }>`, a test helper. It runs `bun scripts/hocus-server.ts` and passes:
    - a random port in 20000–40000 (`HOCUS_PORT=0` falls back to 1234);
    - a temp `DB_PATH`;
    - `HOCUS_THROTTLE=0`, `HOCUS_LOGGER=0` and `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1`;
    - the raised limits from `playwright.config.ts`;
    - then the overrides in `env`.

    It waits for "Hocuspocus listening". `stop()` sends SIGTERM and awaits exit.
- Refused-set design:
  - `schema` is per socket URL, so the verdict is computed once at upgrade (`ws.data.outdated`).
  - Every non-exempt `rawKey` on an outdated socket counts as refused. `message()` drops its non-Auth frames before `handleMessage`.
  - The state is one boolean on `SocketData`, which is freed with the socket on close. This meets "refused set keyed by `rawKey`, cleared on close".
  - It also drops frames that arrive before auth. Hocuspocus would otherwise queue them toward the 1,000-frame reset.
  - Only outdated sockets parse headers, so the hot path is unchanged.
- Counter log line:
  - Format: `{"type":"hocus","event":"client_schema","window_start":iso,"missing":n,"invalid":n,"low":n,"ok":n,"refused":n,"builds":{…}}`, one per window, skipped when the window is empty.
  - Builds that fail `/^[A-Za-z0-9._-]{1,40}$/` are counted as `invalid`.
  - Past `maxBuilds` distinct builds, the rest go to `other`.
  - Only non-exempt documents are counted.
  - Its timer is `unref()`'d.
  - `stop()` flushes first, then clears the timer.
  - `shutdown()` in `hocus-server.ts` calls `counter.stop()` before `process.exit`. The log-only integration case reads that final line.

- [ ] **Step 1: Write the failing unit tests**

```ts
describe("isClientOutdated", () => {
  const odd = [null, "", " 2", "2.0", "0x2", "1e1", "-2", "abc", "1"];
  it("never refuses at min 0 (log only)", () => {
    for (const raw of [...odd, "2", "3"]) expect(isClientOutdated(raw, 0)).toBe(false);
  });
  it("refuses everything but an integer ≥ min at min 2", () => {
    for (const raw of odd) expect(isClientOutdated(raw, 2)).toBe(true);
    for (const raw of ["2", "3", "02"]) expect(isClientOutdated(raw, 2)).toBe(false);
    expect(isClientOutdated(new URLSearchParams("schema=1&schema=2").get("schema"), 2)).toBe(true);
  });
});
it("buckets relative to CLIENT_SCHEMA", () => {
  expect([null, "abc", "1", "2", "3"].map(classifyClientSchema))
    .toEqual(["missing", "invalid", "low", "ok", "ok"]);
});
it("exempts only the tab lists", () => {
  expect(["global-tabs", "global-tabs-x1"].every(isGateExempt)).toBe(true);
  expect(["playground", crypto.randomUUID(), "global-tabsx"].some(isGateExempt)).toBe(false);
});
it("refuses without an abuse log", () => {
  const warn = spyOn(console, "warn");
  const err = clientOutdatedError();
  expect([err.reason, err.stack]).toEqual(["client_outdated", ""]);
  expect(warn).not.toHaveBeenCalled();
});
it("drops non-Auth frames for gated documents only", () => { /* auth(doc)→false, sync(doc)→true, sync(global-tabs)→false, [255]→true */ });
it("logs one aggregate line without raw values", () => {
  const lines: string[] = [];
  const counter = createClientSchemaCounter({ log: (l) => lines.push(l), maxBuilds: 1 });
  counter.record(new URLSearchParams("schema=abc&build=a b"), false);
  counter.record(new URLSearchParams("schema=1&build=v1"), true);
  counter.record(new URLSearchParams("schema=2&build=v2"), false);
  counter.flush();
  counter.flush();
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toMatchObject({ event: "client_schema", invalid: 1, low: 1, ok: 1, refused: 1,
    builds: { invalid: 1, v1: 1, other: 1 } });
  expect(lines[0]).not.toContain("abc");
  counter.stop();
});
```

- [ ] **Step 2: Write the failing integration tests** (`tests/unit/scripts/hocus-client-gate.test.ts`, 30 s timeout per test)

Each case uses `spawnHocus`, plus real `HocuspocusProviderWebsocket` + `HocuspocusProvider` clients with an explicit `?schema=` URL.

| Case | Server env | Expect |
|---|---|---|
| gated document refused, tab list exempt | `HOCUS_MIN_CLIENT_SCHEMA=2` | `?schema=1`: the doc's `authenticationFailed.reason === "client_outdated"`, and `global-tabs` on the same socket `synced` |
| playground gated | min 2 | `playground` with `?schema=1` → `client_outdated` |
| tombstone first | min 2, with `deleteDocumentPermanently(db, name)` on the temp DB before spawn | `?schema=1` → `document_deleted` |
| current client accepted | min 2 | `?schema=2` → `synced` |
| log-only accepts everything | min unset | missing / `abc` / `1` all `synced`; after `stop()`, `logs()` has a `"client_schema"` line with `missing`, `invalid` and `low` |
| refused client cannot get the socket reset | min 2, `HOCUS_THROTTLE=1` | a provider kept attached types 3,000 chars into `doc.getText("t")` (`Bun.sleep(5)` every 100); no `close` with code 4205 on the socket; `logs()` has no `ws_throttle_ban` and no `ws_guardrail_rejected`; after `stop()` the temp DB has no `documents` row for the name |

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test tests/unit/lib/security/client-schema-gate.test.ts tests/unit/scripts/hocus-client-gate.test.ts`
Expected: FAIL. The module is missing, and the integration cases see `synced` instead of a refusal.

- [ ] **Step 4: Implement the module, the config key and the wiring in `scripts/hocus-server.ts`**

`onConnect({ requestHeaders, requestParameters, documentName })` runs in this order:
1. The tombstone check, unchanged.
2. If the name is not exempt:
   - `const outdated = isClientOutdated(requestParameters.get("schema"), HOCUS_MIN_CLIENT_SCHEMA)`
   - `counter.record(requestParameters, outdated)`
   - if `outdated`, throw `clientOutdatedError()`
3. `canConnect`.

At startup, log `[hocus] client schema gate: min=<n>`, and append ` (log only)` when the minimum is 0.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/unit/lib/security tests/unit/scripts`
Expected: PASS.

- [ ] **Step 6: Commit** (review report, then wait for approval)

`feat(hocus): add log-only client schema gate with frame drop`

---

### Task 6: Offline namespace `~s2` with transactional legacy merge

**Files:**
- Modify: `lib/offline/local-doc-store.ts`.
- Modify: `lib/offline/index.ts`, for the exports.
- Create: `tests/fixtures/legacy-local-doc-store.ts`. This is a verbatim copy of today's `LocalDocStore.prune` and `load` key logic from `main`, the pre-N bundle's behaviour.
- Test: `tests/unit/lib/offline/local-doc-store.test.ts`.

**Interfaces:**
- Produces:
  - `OFFLINE_NAMESPACE = "s2"`. Hardcode it; never derive it from `CLIENT_SCHEMA`.
  - `storeKey(host, name)`, which returns `` `${OFFLINE_CACHE_EPOCH}:${host}~s2:${name}` ``.
  - `legacyStoreKey(host, name)`, which returns `` `${OFFLINE_CACHE_EPOCH}:${host}:${name}` ``.
  - `DocStoreBackend.deleteIfUnchanged(key: string, expected: { updatedAt: number; byteLength: number }): Promise<boolean>`.
    - IndexedDB: one `readwrite` transaction. Issue `delete` inside the `get` request's `onsuccess`, with no `await` in between.
    - Memory backend: the same check.
  - `type LoadedCopy = { current: Uint8Array | null; legacy: StoredDoc | null }`.
  - `LocalDocStore.load(name): Promise<LoadedCopy | null>`. Expired copies of either key are deleted and treated as absent.
  - `LocalDocStore.retireLegacy(name: string, legacy: StoredDoc): Promise<boolean>`.
  - `LocalDocStore.remove(name)` deletes both keys.
  - `prune` treats keys with either prefix as ours, with the same stale, unwanted, keep and `maxDocs` rules.
  - `bindLocalCopy` hydrate:
    1. Apply `current`, then `legacy`, with `LOCAL_ORIGIN`, and resolve `hydrated`.
    2. If there was a legacy copy, run an explicit save of `Y.encodeStateAsUpdate(doc)`. `onUpdate` ignores `LOCAL_ORIGIN`, so the save has to be explicit.
    3. Only if the save resolved, call `retireLegacy`.

- [ ] **Step 1: Write the failing tests**

```ts
it("saves under ~s2 and never bumps the epoch", async () => {
  const { store, backend } = makeStore();
  await store.save("a", Uint8Array.from([1]));
  expect((await backend.all())[0]?.key).toBe("1:ws.example~s2:a");
  expect(OFFLINE_CACHE_EPOCH).toBe(1);
});
it("is invisible to a pre-N bundle's load and prune", async () => { /* legacy fixture store on same backend: load("a") → null, prune keeps ~s2 key */ });
it("merges the legacy copy, saves, then retires it", async () => { /* put legacy Y state; bindLocalCopy; await hydrated; doc has legacy text; flush; backend has only the ~s2 key containing the text */ });
it("keeps the legacy copy when the save fails", async () => { /* backend.put rejects for ~s2 → legacy key still present */ });
it("keeps a legacy copy rewritten after the merge", async () => { /* after load, before retire: backend.put(legacy key, newer updatedAt) → retireLegacy returns false; key present */ });
it("removes both keys and prunes legacy keys like current ones", async () => { /* remove("a") clears both; prune with isWanted=false clears legacy */ });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/lib/offline`
Expected: FAIL. The key is still `1:ws.example:a`, and `deleteIfUnchanged` is missing.

- [ ] **Step 3: Implement the key functions, backend method, load/retire/remove/prune and the binding hydrate flow**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/lib/offline tests/unit/lib/collab-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(offline): move device copies to the ~s2 namespace with legacy merge`

---

### Task 7: Client handling: refusal, B1 schema guard, notices

**Files:**
- Modify: `lib/collab-session.ts`, in four places:
  - add `CLIENT_OUTDATED_REASON` and `SCHEMA_REJECTED_REASON`;
  - the `authenticationFailed` branch;
  - the `close` handler;
  - export `flushAllLocalCopies`.
- Create: `lib/schema-guard.ts`.
- Modify: `components/document-editor/document-editor-config.ts`.
  - Add an **optional** `onInvalidContent?: (error: Error) => void` option. It must be optional because Task 2's `getEditorSchema()` omits it.
  - Pass `ySyncOptions` to `CollaborationRenderOnce` only when the option is set.
- Create: `components/document-editor/document-notice.tsx`. It replaces the inline `REJECTION_NOTICES` block.
- Modify: `components/document-editor/document-editor.tsx`, in four places:
  - create and bind the guard;
  - add the guard to the extensions memo deps;
  - `setEditable`;
  - show the notice when `!synced && rejectedReason`.
- Modify: `components/document-editor/document-editor.scss`. Add the notice button layout.
- Modify: `lib/analytics.ts`. Add `schema_repair_failed: Record<string, never>`.
- Test: `tests/unit/lib/collab-session.test.ts`.
- Test: `tests/unit/lib/schema-guard.test.ts`.
- Test: `tests/unit/lib/collab-session-refusal.test.ts`, a real socket via `spawnHocus`.

**Interfaces:**
- Consumes:
  - `spawnHocus` (Task 5);
  - `findUnknownSchemaNames`, `repairKnownMisfit` and `createCollabEditor` (Task 1);
  - `CLIENT_OUTDATED_REASON` (server, Task 5), checked for equality in a test;
  - `SCHEMA_REJECTED.reason` (Task 3), checked for equality in a test.
- Produces:
  - `flushAllLocalCopies(): Promise<void>`, implemented with `Promise.allSettled` over the bindings.
  - `type SchemaGuardState = "ok" | "outdated" | "unrepairable"`.
  - `createSchemaGuard(fragment: Y.XmlFragment, options?: { repairDelayMs?: () => number; onRepairFailed?: () => void }): SchemaGuard`.
    - The default delay is a random 0–500 ms.
    - The default `onRepairFailed` calls `console.warn` and `trackEvent("schema_repair_failed", {})`.
  - `SchemaGuard` has these members:
    - `onInvalidContent(error: Error): void`. It only records the error and schedules an evaluation; it never touches Yjs or the editor synchronously.
    - `bind(target: { editor: Editor; canWrite: () => boolean }): () => void`
    - `getState(): SchemaGuardState`
    - `subscribe(listener: () => void): () => void`
  - `DocumentNotice({ reason }: { reason: string })` (`role="alert"`). For `client_outdated` and `outdated`, it adds a "Reload" button that awaits `flushAllLocalCopies()` and then calls `location.reload()`.
- Evaluation, run after the delay and only once bound:
  1. If `binding.invalidContentError` is null, the state is `"ok"`.
  2. Otherwise, if unknown names are present, the state is `"outdated"` and nothing is written.
  3. Otherwise, if `!canWrite()`, leave the state unchanged. The document already shows its own rejection notice.
  4. Otherwise, run `repairKnownMisfit` and re-check the binding. If it is unfrozen, the state is `"ok"`. If not, the state is `"unrepairable"` and `onRepairFailed()` runs once.
- While the state is not `ok`, an `observeDeep` listener on the fragment re-checks `invalidContentError === null` and returns the state to `"ok"`. `bind()`'s cleanup clears timers and observers.
- In the editor:
  - The guard is created with `useMemo` on `ydoc`.
  - The notice shows `rejectedReason ?? guardReason`. Map guard `outdated` to the outdated copy, and `unrepairable` to "This document can't be edited in this version."
  - `setEditable(reason === null)`.
  - Copy for `schema_rejected`: "The server didn't accept this document's latest changes. Your changes on this device are kept."

- [ ] **Step 1: Write the failing tests**

```ts
// collab-session.test.ts
it("detaches but keeps the copy when the client is outdated", () => {
  const session = acquireCollabSession(unique());
  const provider = created[0]!;
  provider.emit("authenticationFailed", { reason: CLIENT_OUTDATED_REASON });
  expect(provider.detach).toHaveBeenCalledOnce();
  expect(provider.destroy).not.toHaveBeenCalled();
  expect(session.rejectedReason).toBe(CLIENT_OUTDATED_REASON);
  session.doc.getText("t").insert(0, "x");
  expect(hasUnsyncedCollabChanges()).toBe(false);
});
it("stops syncing after a schema_rejected close", () => { /* emit close {event:{reason: SCHEMA_REJECTED_REASON}} → detach, rejectedReason */ });
it("shares reason strings with the server", () => {
  expect(CLIENT_OUTDATED_REASON).toBe(serverGate.CLIENT_OUTDATED_REASON);
  expect(SCHEMA_REJECTED_REASON).toBe(SCHEMA_REJECTED.reason);
});

// schema-guard.test.ts: each case uses createCollabEditor() and createSchemaGuard(f.fragment, { repairDelayMs: () => 0 }) bound to f.editor
it("records only: nothing is written before the delay", () => { /* guard.onInvalidContent(err) → outgoing unchanged synchronously */ });
it("goes outdated on unknown names and writes nothing", async () => { /* remote zzz element → tick → state "outdated", outgoing unchanged */ });
it("repairs a paragraph before the title and stays ok", async () => { /* state "ok", invalidContentError null, server starts with heading */ });
it("reports unrepairable once", async () => { /* top-level listItem → "unrepairable", onRepairFailed called 1× */ });
it("does not write when another client already repaired", async () => { /* repairDelayMs 50; remote repair lands first → no outgoing from guard */ });
it("returns to ok when the unknown content is removed remotely", async () => { /* … */ });
it("does not repair while the document is refused", async () => { /* canWrite false → outgoing unchanged */ });
it("cleans up on unbind", async () => { /* unbind; remote misfit → state unchanged, no timers pending */ });
```

The FakeProvider has no reconnect, so it cannot test Review Focus 5. Put that test on a real socket in `tests/unit/lib/collab-session-refusal.test.ts` (30 s timeout):

```ts
it("a refused session never re-attaches across reconnects", async () => {
  const hocus = await spawnHocus({ HOCUS_MIN_CLIENT_SCHEMA: "2" });
  window.__HOCUS_URL = hocus.url;
  window.__HOCUS_SCHEMA = "1";
  const { acquireCollabSession, CLIENT_OUTDATED_REASON } =
    await importFresh<typeof import("@/lib/collab-session")>("@/lib/collab-session");
  const { getSharedHocuspocusSocket } =
    await importFresh<typeof import("@/lib/hocuspocus")>("@/lib/hocuspocus");
  const session = acquireCollabSession(crypto.randomUUID());
  const failures: string[] = [];
  session.provider.on("authenticationFailed", ({ reason }: { reason: string }) => failures.push(reason));
  await waitFor(() => session.rejectedReason === CLIENT_OUTDATED_REASON);
  const socket = getSharedHocuspocusSocket();
  socket.disconnect();
  await socket.connect();
  await Bun.sleep(1500);
  expect(failures).toEqual([CLIENT_OUTDATED_REASON]);
  await hocus.stop();
  expect(countRefused(hocus.logs())).toBe(1); // sum of "refused" over client_schema lines
});
```

Two cleanup rules for this file:
- In `afterEach`, delete both window hooks and call `resetModules()`.
- `importFresh` must load `collab-session` and `hocuspocus` as one fresh module graph, so the session uses the same socket instance the test reconnects. If two separate `importFresh` calls create two copies, import `@/lib/hocuspocus` with a plain `await import` right after the first `importFresh`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/lib/collab-session.test.ts tests/unit/lib/collab-session-refusal.test.ts tests/unit/lib/schema-guard.test.ts`
Expected: FAIL with `CLIENT_OUTDATED_REASON is not exported` and `Cannot find module "@/lib/schema-guard"`.

- [ ] **Step 3: Implement the session changes, the guard, and the config/editor/notice wiring**

- [ ] **Step 4: Run the tests and typecheck**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(editor): freeze on unknown schema, repair misfits, handle outdated clients`

---

### Task 8: End-to-end safety: refused client, ingress refusal, repair

**Files:**
- Create: `tests/e2e/schema-safety.spec.ts`.
- Create: `tests/e2e/helpers/offline-store.ts`. Move `storedCopies` here from `offline-copies.spec.ts` and import it there.
- Modify: `tests/e2e/helpers/editor-page.ts`. Add a `goto(docId, { waitForEditor = true })` option that skips the `.tiptap` waits.

**Interfaces:**
- Consumes:
  - `spawnHocus` (Task 5), started with `HOCUS_MIN_CLIENT_SCHEMA=2` in `test.beforeAll` and stopped in `afterAll`;
  - the `window.__HOCUS_URL` and `window.__HOCUS_SCHEMA` hooks (Task 4).
- Setup:
  - `test.describe.configure({ mode: "serial" })`.
  - `test.use({ bypassCSP: true })`. CSP `connect-src` pins `ws://127.0.0.1:1234`.
  - Read the server through a raw `HocuspocusProvider` at `${url}?schema=2`.

- [ ] **Step 1: Write the tests**

| Test | Steps | Assertions |
|---|---|---|
| outdated client keeps its copy, is read-only, changes nothing | page 1 (schema 2) types "Copy on this device" and waits for the server to have it; page 2 opens the same doc in the same context with `__HOCUS_SCHEMA="1"` | the notice has the outdated copy; `.tiptap` has `contenteditable="false"`; the text is visible from the device copy; typing changes nothing; `storedCopies(page2)` includes the doc; the raw server text is unchanged; clicking Reload fires `load` |
| no device copy shows the banner | a fresh context with `__HOCUS_SCHEMA="1"`; `goto(newId, { waitForEditor: false })` | the notice is visible within 10 s |
| unknown name refused at ingress | an attacker provider (schema 2) inserts `XmlElement("zzz")` into the doc while page 1 is open | the attacker gets `close` with reason `schema_rejected`; page 1 is editable with no notice; a fresh raw read has no `<zzz` |
| delete-all repaired, not frozen | the attacker runs `frag.delete(0, frag.length)` | within 3 s page 1 has an `h1` first, is editable, shows no notice, and typed text reaches the server |
| paragraph-before-title repaired | the attacker inserts `XmlElement("paragraph")` at 0 | page 1's first block is `h1`, it is editable, and it shows no notice |
| a pre-N device copy migrates through real IndexedDB | `page.evaluate` on the app origin writes a legacy record `{ key: "1:127.0.0.1:<port>:<id>", name, update, updatedAt: Date.now() }` into `tinydocy-offline`/`docs`; `update` is a Y update with title "Legacy copy", built in the test from `getEditorSchema()`; the server does not have the doc; then `goto(id)` | "Legacy copy" renders; after `page.evaluate` of a `pagehide` flush, the store holds only `1:127.0.0.1:<port>~s2:<id>`; a raw server read contains "Legacy copy" |
| no new guardrail-rejection volume | after all tests | the spawned server's `logs()` contains no `ws_guardrail_rejected` |

- [ ] **Step 2: Run against `make dev`**

Run: `make dev` (another terminal), then `CI= bun playwright test tests/e2e/schema-safety.spec.ts tests/e2e/offline-copies.spec.ts --project=chromium`
Expected: all pass.

- [ ] **Step 3: Commit** (review report, then wait for approval)

`test(e2e): cover outdated clients, ingress refusal and schema repair`

---

### Task 9: Token-aware highlight rendering

**Files:**
- Create: `lib/highlight-tokens.ts`.
- Create: `extensions/token-highlight/token-highlight.ts`.
- Create: `extensions/token-highlight/index.ts`.
- Modify: `components/document-editor/document-editor-config.ts`. Replace `Highlight` with `TokenHighlight.configure({ multicolor: true })`.
- Modify: `styles/_variables.scss`.
  - Add **only** `--tt-color-highlight-teal` and `--tt-color-highlight-teal-contrast`, in light and `.dark`.
  - Teal is the one token N+1 can write that has no variable today. Use the Appendix A values: light `#99f6e4`, dark `#174542`.
  - Leave the other values alone. The palette retune and its contrast test belong to PR C.
- Modify: `components/document-editor/document-editor.scss`. Add `.tiptap mark[data-highlight="<token>"]` rules from an SCSS `@each`, with `color: inherit`.
- Test: `tests/unit/extensions/token-highlight.test.ts`.

**Interfaces:**
- Produces:
  - `HIGHLIGHT_TOKENS = ["gray","brown","red","orange","yellow","green","teal","blue","purple","pink"] as const`.
  - `type HighlightToken`.
  - `highlightTokenFromValue(value: unknown): HighlightToken | null`. It accepts `X` or exactly `var(--tt-color-highlight-X)`, and maps everything else, including `var(--background)`, to null.
  - `TokenHighlight`. It overrides only the `color` attribute's `renderHTML`:
    - for a token: `{ "data-color": value, "data-highlight": token }`;
    - otherwise: `{}`.
  - The stock `parseHTML` is kept, so paste between N tabs still round-trips `data-color`. The key, the defaults and the schema snapshot are unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
const html = (color: string) => createTestEditor({
  extensions: [...DEFAULT_EXTENSIONS.filter((e) => e.name !== "highlight"), TokenHighlight.configure({ multicolor: true })],
  content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [
    { type: "text", text: "t", marks: [{ type: "highlight", attrs: { color } }] }] }] },
}).getHTML();

it("renders legacy and token values as the same token, without inline style", () => {
  for (const v of ["var(--tt-color-highlight-red)", "red"]) {
    expect(html(v)).toContain('data-highlight="red"');
    expect(html(v)).not.toContain("style=");
  }
  expect(html("teal")).toContain('data-highlight="teal"');
});
// a bare <mark> still gets the browser's default background; the safety goal is no inline style
it("renders unknown and hostile values without inline style or token", () => {
  for (const v of ["red;background:url(x)", "#ff0", "var(--background)", "cyan"]) {
    expect(html(v)).not.toContain("style=");
    expect(html(v)).not.toContain("data-highlight");
  }
});
it("keeps the attribute key color", () => {
  expect(Object.keys(getEditorSchema().marks.highlight.spec.attrs ?? {})).toEqual(["color"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/extensions/token-highlight.test.ts`
Expected: FAIL with `Cannot find module "@/extensions/token-highlight"`.

- [ ] **Step 3: Implement the token module, the extension, the CSS and the teal variables**

- [ ] **Step 4: Verify**

Run: `bun test tests/unit/extensions/token-highlight.test.ts tests/unit/schema`
Expected: PASS. The schema snapshot is unchanged.

Then run `make dev`. In the playground, apply each highlight from the popover and screenshot light and dark. Every swatch must render on the page in the colour it shows.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(editor): render highlights from tokens, keeping the color attribute`

---

### Task 10: Runbook and docs

**Files:**
- Create: `docs/operations/schema-rollout-runbook.md`.
- Modify: `docs/operations/abuse-guardrails-runbook.md`. Add `HOCUS_MIN_CLIENT_SCHEMA` under Key Configuration, and add the event `ws_unknown_schema_name` with an alert threshold.
- Modify: `README.md`, in three places:
  - a runtime settings row for `HOCUS_MIN_CLIENT_SCHEMA`;
  - a build-time row for `NEXT_PUBLIC_BUILD_ID`;
  - a Documentation index row.
- Modify: `tests/TESTING.md`. Document the `window.__HOCUS_SCHEMA` hook, `spawnHocus`, and `schema-safety.spec.ts`.

The runbook needs these sections:
1. **What the guards are:** the gate, the namespace, the freeze and repair, and the ingress allowlist, each with its log line or event.
2. **Reading adoption:** the `client_schema` line, with a `jq` one-liner over the PM2 Hocus log that computes `ok / (missing + invalid + low + ok)` per 24 h. The N+1 gate is ≥ 95% held ≥ 48 h, read while the gate is log-only.
3. **Release order:** the spec's four steps verbatim, with PM2 names `editor-hocus` and `editor-next` and `bunx pm2@6.0.14 restart editor-hocus --update-env` before `editor-next`.
4. **Rollback:** reverting the client is safe. **Never lower the floor.** Never set `HOCUS_MIN_CLIENT_SCHEMA` below a value it has already had in production. PR C makes this structural with `SCHEMA_FLOOR = 2`. Never roll back below release N.
5. **Allowlist rule:** every new mark or node name ships in `lib/schema-names.ts` in an earlier Hocus restart than any client that writes it. The schema snapshot test catches drift from the daily docs.plus refresh.
6. **Banners users may report**, and what each one means.
7. **Scripts and load tests:** they must send `?schema=2` once the minimum is above 0. The load harness already does.

- [ ] **Step 1: Write the docs**

- [ ] **Step 2: Verify the links and formatting**

Run: `bun run check && grep -n "schema-rollout-runbook" README.md docs/operations/abuse-guardrails-runbook.md`
Expected: Biome passes, and both files link the runbook.

- [ ] **Step 3: Commit** (review report, then wait for approval)

`docs: add schema rollout runbook`

---

### Task 11: CHANGELOG and full verification

**Files:**
- Modify: `CHANGELOG.md`, under `## [Unreleased]`.

The entry has three parts.

**Added:**
- the client version gate, log-only (`HOCUS_MIN_CLIENT_SCHEMA`, default 0);
- the `schema`/`build` socket parameters;
- the ingress name allowlist (`ws_unknown_schema_name`, close 4422);
- the freeze-on-unknown and repair-misfit handler with its notices;
- the offline `~s2` namespace with legacy merge;
- token-aware highlight rendering, plus a teal highlight variable;
- the schema snapshot test;
- the schema rollout runbook.

**Changed:** a highlight whose value is not a known token renders without an inline style.

**Deploy:**
- Pull, `bun install --frozen-lockfile`, then `bun run build`.
- Restart Hocus first (`bunx pm2@6.0.14 restart editor-hocus --update-env`), then confirm `[hocus] client schema gate: min=0 (log only)` in its log.
- Then restart Next (`bunx pm2@6.0.14 restart editor-next --update-env`).
- Leave `HOCUS_MIN_CLIENT_SCHEMA` unset.
- From now on, never roll back below this release, and never lower the gate once raised (see the runbook).
- `NEXT_PUBLIC_BUILD_ID` is optional; the default is the git short SHA.

- [ ] **Step 1: Write the CHANGELOG entry**

- [ ] **Step 2: Run full static checks and the unit suite**

Run: `bun audit --audit-level=high && bun run check && bun run lint && bun run typecheck && bun run test && bun run build`
Expected: all exit 0.

- [ ] **Step 3: Run e2e against the dev servers**

Run: `make dev` (another terminal), then `CI= bun playwright test --project=chromium --retries=1`
Expected: all pass. This includes `schema-safety.spec.ts`, `offline-copies.spec.ts` and `global-tabs-poison.spec.ts`.

- [ ] **Step 4: Run the production-build PWA project**

The service worker caches the shell, and the offline copy now uses the new key.

Run:
1. `NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1234 bun run build && PORT=3847 bun run start` (with `make dev-hocus` running)
2. `PWA_BASE_URL=http://localhost:3847 CI= bun playwright test --project=pwa`

Expected: pass.

- [ ] **Step 5: Check the UI by running it**

With `make dev` running, take screenshots of:
- the outdated notice over a document;
- the notice over the skeleton when there is no device copy;
- highlights in light and dark.

Use a page with `window.__HOCUS_URL` pointing at a `spawnHocus({ HOCUS_MIN_CLIENT_SCHEMA: "2" })` instance and `__HOCUS_SCHEMA="1"`.

Confirm in the Hocus terminal that a `client_schema` line appears within a minute of opening tabs.

- [ ] **Step 6: Check against the HoE go criteria for B**

The B criteria are:
- the gate matrix, with tombstone first and `global-tabs(-*)` exempt: Task 5;
- legacy key deleted only after a successful save: Task 6;
- the e2e banner, read-only mode, IndexedDB copy kept and server doc unchanged: Task 8;
- no new `ws_guardrail_rejected` volume: Tasks 5 and 8;
- B1 and B2: Tasks 1, 3 and 7.

Paste the evidence (test names and pass output) into the PR description.

- [ ] **Step 7: Commit** (review report, then wait for approval)

`docs: record release N rollout safety in the changelog`

---

## Self-review

**1. Spec coverage, §3.1 and §8 item 2:**
- URL `schema` = 2 and `build`: Task 4.
- `client_outdated` refusal after the tombstone check, with `global-tabs(-*)` exempt and playground gated: Task 5.
- Integer check: Task 5.
- Bucketed per-minute counts, not via `reject()`: Task 5.
- Refused set keyed by `rawKey`, cleared on close: Task 5 (per-socket verdict).
- Messages for refused docs dropped: Task 5.
- Client refusal handling (detach, keep copy, read-only, Reload banner): Task 7, with e2e in Task 8.
- `onInvalidContent` record-only: Task 7.
- B1 walk, freeze, targeted repair and the failed-repair banner and counter: Tasks 1 and 7.
- The `projectionError` experiment as a test: Task 1.
- B2 allowlist, including `textColor`/`fontSize` and legacy `link`/`code`, with a non-reconnecting close and an abuse log: Tasks 2, 3 and 7.
- Offline namespace and transactional merge: Task 6.
- Token-aware highlight rendering with key `color`: Task 9.
- Schema snapshot: Task 2.
- y-tiptap ≥ 3.3.0: Task 1.
- Runbook with "never lower the floor": Task 10.
- Gate log-only and no `SCHEMA_FLOOR`: Global Constraints, Task 5.
- CHANGELOG with a Deploy note: Task 11.

PR C items left out on purpose: the marks, `SCHEMA_FLOOR`, the server rewrite of stored highlight values, paste rules, and render-time enforcement for the new marks.

**2. Deviation from the spec text:** the refused set is a per-socket verdict instead of an explicit set of `rawKey`s. `schema` is per socket URL, so every non-exempt `rawKey` on an outdated socket is refused. This version is simpler, frees its state with the socket, and also drops frames that arrive before auth. Reviewers should confirm they accept this.

**3. Type consistency:** these names are used identically in every task that touches them:
- `markNameFromKey`, `findUnknownSchemaNames`, `repairKnownMisfit`, `SCHEMA_REPAIR_ORIGIN` (Tasks 1, 7)
- `isAllowedNodeName`, `isAllowedMarkKey` (Tasks 2, 3)
- `SCHEMA_REJECTED` and `SCHEMA_REJECTED_REASON` (Tasks 3, 7)
- `CLIENT_SCHEMA` and `withClientVersion` (Tasks 4, 5)
- `CLIENT_OUTDATED_REASON` (Tasks 5, 7)
- `spawnHocus` (Tasks 5, 8, 11)
- `createCollabEditor` (Tasks 1, 7)
- `flushAllLocalCopies` (Task 7)
- `storeKey` and `legacyStoreKey` (Task 6)

**4. Review Focus:** each of the five lines has a named test in its owning task (Tasks 5, 8, 1, 6, 7).

**5. Proportion:** the code blocks are tests and signatures. Bodies appear only for the repair rules and the gate predicate, which the tests do not fully determine.
