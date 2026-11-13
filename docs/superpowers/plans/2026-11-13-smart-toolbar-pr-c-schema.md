# Smart toolbar PR C (release N+1, schema): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release N+1's data layer. It adds the `textColor` and `fontSize` marks, moves highlight values to tokens, sets `SCHEMA_FLOOR = 2` in code and rewrites stored legacy highlight values on the server. It also adds the editor commands PR D will call. There is no toolbar UI.

**Architecture:** The release has two halves, which deploy in two process restarts.

The **server half** is everything `scripts/hocus-server.ts` loads from source (`lib/**` only):
- the `textColor` and `fontSize` entries in the ingress allowlist;
- `SCHEMA_FLOOR = 2`, so the effective minimum is `max(HOCUS_MIN_CLIENT_SCHEMA, 2)`;
- the `afterLoadDocument` rewrite of `var(--tt-color-highlight-X)` to `X`.

The **client half** is everything the Next build bundles:
- the two marks, each enforcing tokens at render time;
- token-normalizing highlight commands and parse rules;
- paste rules that keep only TinyDocy's own `data-*` tokens;
- a heading rule that keeps `fontSize` out of headings;
- the palette CSS.

Hocus runs TypeScript from source and Next serves the prebuilt `.next`. The Deploy note therefore restarts Hocus **before** building Next, so no N+1 bundle exists until the server half is live (spec §3.1 step 3, then step 4).

**Tech Stack:** Bun ≥ 1.4.4, `bun test` (happy-dom preload), Playwright, Next.js 16, Tiptap 3.33 (`@tiptap/extension-highlight` 3.33.1), `@tiptap/y-tiptap` ≥ 3.3.0, Yjs 13.6, Hocuspocus 4.8 (`Bun.serve` + `handleConnection`), `bun:sqlite`.

**Spec:** `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`. Read it from PR B's branch, where §3.1 says the pending names ship with PR C's server half. The plan draws on:
- §3: marks, render-time enforcement, paste rules, the schema evolution rule, `fontSize` out of headings, the palette;
- §3.1: `SCHEMA_FLOOR`, release order steps 3–4, the N+1 ship gates, HoE B3/B4;
- §7: tests and the abuse soak;
- §8 item 3 and the HoE go criteria for C;
- Appendix A: the palette.

**Base:** PR C branches from **PR B's head**: `feat/smart-toolbar-rollout-safety`, docs-plus/editor#28, not merged; `71bad93` when this plan was written. Use the branch's latest head.
- Branch: `feat/smart-toolbar-schema`. PR base: `feat/smart-toolbar-rollout-safety`.
- Retarget the PR to `main` **before** #28 merges, or it is stranded (see the #22 note).
- Task 10 needs PR A's keystroke helpers (#27, `feat/smart-toolbar-a11y`). Before Task 10, rebase onto a `main` that contains #27 (and #28 if merged). If #27 has not merged by then, stop and report; do not copy its helpers.

## Global Constraints

- **Bun only:** use `bun`, `bun <bin>` and `bunx --bun`. Never use npm, npx, yarn or pnpm.
- **Unit tests:**
  - Use `bun test`.
  - For module mocks, spread the real module into `mock.module`, then `await import()`.
  - Load modules that read env at import time through `importFresh()`, and call `resetModules()` in `afterEach`.
  - Tests that spawn Hocus use `spawnHocus()` from `tests/helpers/spawn-hocus.ts`.
- **E2E servers** (one canonical block; `make dev` is pinned to 3000/1234 and is not used):
  ```sh
  export E2E_DB="${TMPDIR:-/tmp}/tinydocy-e2e.sqlite"
  # terminal 1: Hocus
  HOCUS_PORT=1734 DB_PATH="$E2E_DB" HOCUS_ALLOW_ISOLATED_TABS_DOCS=1 HOCUS_THROTTLE=0 \
    MAX_TOTAL_DOCUMENTS=1000000 DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 \
    WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 bun run hocus
  # terminal 2: Next (NEXT_PUBLIC_HOCUS_URL also sets the CSP connect-src)
  DB_PATH="$E2E_DB" MAX_TOTAL_DOCUMENTS=1000000 NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1734 bun next dev -p 3600
  # Playwright
  E2E_BASE_URL=http://localhost:3600 E2E_HOCUS_URL=ws://127.0.0.1:1734 CI= bun playwright test --project=chromium
  ```
  Below, "E2E_RUN" stands for the last line with extra arguments appended. Never test against tiny.docs.plus.
- **Tokens, verbatim from the spec:**
  - Text and highlight colours: `gray, brown, red, orange, yellow, green, teal, blue, purple, pink`, in this order.
  - Font sizes: `xs .75em, sm .875em, lg 1.25em, xl 1.5em`. M is the default and has **no** mark.
  - Mark names and attributes: `textColor { color }` and `fontSize { size }`.
  - Render attributes: `data-text-color`, `data-font-size`, `data-highlight`.
- **Highlight keeps its attribute key `color`** (B4). Only the values become tokens. `data-highlight` is a render attribute only.
- **The schema snapshot may only add the two marks.** Never use a ProseMirror attribute `validate`. Never add an attribute to an existing mark or node. Never loosen `content` or `marks`. Keep `fontSize` out of headings with commands, a transaction rule and paste handling, never with the schema.
- **All three marks are inclusive like bold** (ProseMirror default; do not set `inclusive`).
- **The gate:**
  - `SCHEMA_FLOOR = 2` in code. The effective minimum is `max(HOCUS_MIN_CLIENT_SCHEMA, SCHEMA_FLOOR)` and is used at **both** gate sites in `hocus-server.ts` (the upgrade `outdated` flag and `onConnect`).
  - `CLIENT_SCHEMA` stays `2`.
  - Never lower the floor.
- **Allowlist rule:** `textColor` and `fontSize` join `lib/schema-names.ts` in this PR. Nothing else joins it.
- **Release order:** this PR is deployed by spec §3.1 steps 3–4. Pull, restart Hocus, confirm, **then** build, then restart Next. Never serve the N+1 client before the Hocus restart.
- **Merge gate:** `main` deploys continuously. Do not merge until the N+1 ship gates pass in production: ≥95% `schema=2` adoption over a trailing 24 h, held ≥48 h, read while the gate is log-only (runbook).
- **Code style:**
  - Named exports only; kebab-case files.
  - Extensions live in their own folder under `extensions/` with an `index.ts`, like `extensions/token-highlight/`.
  - Run Biome via `bun run check`.
- **Commits:**
  - Conventional Commits, imperative mood.
  - **No AI/tool trailers.** AGENTS.md overrides any attribution reminder.
  - Before every commit, show a commit review report (files, diff summary, message) and **wait for explicit approval**.

## Review Focus

The five inputs most likely to bite a user. Each one is pinned by a test in the task that owns the code.

1. **Hostile mark attributes from a raw Yjs client.** Examples: `color: "red;background:url(x)"`, an object, a number, `null`, a 10 kB string, or extra keys such as `style` or `onclick`. Expected: the text renders plain, with no `style`, no unknown `data-*` value and no thrown error (a throw in `renderHTML` takes the whole view down). Test: Task 7, render fuzz.
2. **Sized text pasted into the title or a heading,** including copies from another TinyDocy tab. Expected: no heading holds `fontSize` afterwards; colour and highlight are kept. Test: Task 5, "paste into a heading drops fontSize".
3. **A sized paragraph turned into a heading** (`toggleHeading`, the `## ` input rule). Expected: the mark goes in the same transaction, so one undo restores it. Content that reached a heading remotely renders at the heading's size. Tests: Task 5, "toggleHeading strips fontSize in one undo step"; Task 8, "remote fontSize in a heading renders at heading size".
4. **Tampered tokens from PR D's memory store:** `"__proto__"`, `"constructor"`, `"RED"`, `"red "`, `"red;x"`, `"m"`, `"20px"`, `42`. Expected: the helpers return `null`, the commands return `false`, and nothing is written. Tests: Task 1, token table; Tasks 4 and 5, "refuses tampered tokens".
5. **An N client still writing legacy highlight values after the server rewrote the document** (step 3–4 window, old popover). Expected: both forms render the same token. The next load rewrites the legacy value, and the rewrite is idempotent. Test: Task 3, "rewrites a legacy value written after an earlier rewrite".

---

### Task 1: Palette tokens and contrast

**Files:**
- Create: `lib/format-tokens.ts`
- Modify: `lib/highlight-tokens.ts`. Add `DEFAULT_HIGHLIGHT_TOKEN`.
- Modify: `styles/_variables.scss`
  - Set `--tt-color-text-<token>` and `--tt-color-highlight-<token>` in `:root` and `.dark` to the Appendix A hex values.
  - Add `--tt-color-text-teal`.
  - Leave the `-contrast` variables alone.
- Test: `tests/unit/lib/format-tokens.test.ts`, `tests/unit/styles/palette-contrast.test.ts`

**Interfaces:**
- Consumes: `HIGHLIGHT_TOKENS`, `HighlightToken`, `highlightTokenFromValue` (`lib/highlight-tokens.ts`, PR B).
- Produces, in `lib/format-tokens.ts`:
  ```ts
  export const TEXT_COLOR_TOKENS: readonly TextColorToken[]; // === HIGHLIGHT_TOKENS (same ten names)
  export type TextColorToken = HighlightToken;
  export function textColorTokenFromValue(value: unknown): TextColorToken | null; // exact token only, no legacy var
  export const FONT_SIZE_TOKENS: readonly ["xs", "sm", "lg", "xl"];
  export type FontSizeToken = (typeof FONT_SIZE_TOKENS)[number];
  export const FONT_SIZE_EM: Readonly<Record<FontSizeToken, number>>; // { xs: 0.75, sm: 0.875, lg: 1.25, xl: 1.5 }
  export function fontSizeTokenFromValue(value: unknown): FontSizeToken | null;
  ```
- Produces, in `lib/highlight-tokens.ts`: `export const DEFAULT_HIGHLIGHT_TOKEN: HighlightToken = "yellow";`. It is used by `toggleHighlight()`, Mod-Shift-H and `==x==`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/lib/format-tokens.test.ts
const TAMPERED = ["__proto__", "constructor", "toString", "RED", "red ", "red;x",
  "var(--tt-color-text-red)", "#dc2626", "", 42, null, undefined, {}, ["red"]];

it("accepts exactly the ten colour tokens", () => {
  expect(TEXT_COLOR_TOKENS).toEqual(["gray","brown","red","orange","yellow","green","teal","blue","purple","pink"]);
  for (const t of TEXT_COLOR_TOKENS) expect(textColorTokenFromValue(t)).toBe(t);
  for (const v of TAMPERED) expect(textColorTokenFromValue(v)).toBeNull();
});

it("accepts exactly four size tokens; M has no mark", () => {
  expect(FONT_SIZE_TOKENS).toEqual(["xs", "sm", "lg", "xl"]);
  expect(FONT_SIZE_EM).toEqual({ xs: 0.75, sm: 0.875, lg: 1.25, xl: 1.5 });
  for (const v of [...TAMPERED, "m", "M", "md", "20px", "1.25em", "LG"])
    expect(fontSizeTokenFromValue(v)).toBeNull();
});

it("defaults highlights to yellow", () => expect(DEFAULT_HIGHLIGHT_TOKEN).toBe("yellow"));
```

```ts
// tests/unit/styles/palette-contrast.test.ts
// Parses styles/_variables.scss: for each `--tt-color-(text|highlight)-<token>: #rrggbb;` the
// first occurrence is light (:root) and the second dark (.dark). Each of the ten tokens must
// have exactly one light and one dark hex value for both families.
// PAGE mirrors app/globals.css: --background oklch(1 0 0) / oklch(0.145 0 0),
// --foreground oklch(0.145 0 0) / oklch(0.985 0 0).
const PAGE = {
  light: { background: "#ffffff", text: "#0a0a0a" },
  dark: { background: "#0a0a0a", text: "#fafafa" },
};

it("page colours still match app/globals.css", () => {
  const css = readFileSync("app/globals.css", "utf8");
  expect(css).toContain("--background: oklch(1 0 0)");
  expect(css).toContain("--foreground: oklch(0.145 0 0)");
  expect(css).toContain("--background: oklch(0.145 0 0)");
  expect(css).toContain("--foreground: oklch(0.985 0 0)");
});

it("matches Appendix A (spot check)", () => {
  expect(palette.text.red).toEqual({ light: "#dc2626", dark: "#f87171" });
  expect(palette.highlight.teal).toEqual({ light: "#99f6e4", dark: "#174542" });
});

for (const theme of ["light", "dark"] as const) {
  it(`every text token is ≥ 4.5:1 on the ${theme} page (HoE floor 3:1)`, () => {
    for (const t of TEXT_COLOR_TOKENS)
      expect(contrastRatio(palette.text[t][theme], PAGE[theme].background)).toBeGreaterThanOrEqual(4.5);
  });
  it(`default text is ≥ 7:1 (AAA) on every ${theme} highlight (HoE floor 3:1)`, () => {
    for (const t of HIGHLIGHT_TOKENS)
      expect(contrastRatio(PAGE[theme].text, palette.highlight[t][theme])).toBeGreaterThanOrEqual(7);
  });
}
```

`contrastRatio(a: string, b: string): number` is the WCAG 2.x relative-luminance ratio. Define it in `tests/helpers/contrast.ts`. Highlights are measured as default text **on** the highlight. A highlight against the page is 1.2–2.4:1 by design, and that is not a criterion.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/lib/format-tokens.test.ts tests/unit/styles/palette-contrast.test.ts`
Expected: FAIL. `lib/format-tokens` is missing, the teal text variable is missing, and the old dark highlights fail AAA.

- [ ] **Step 3: Implement `lib/format-tokens.ts`, add `DEFAULT_HIGHLIGHT_TOKEN`, and write the Appendix A values into `styles/_variables.scss`**

Look tokens up in a `Set`, never on a plain object: `"__proto__"` must miss.

- [ ] **Step 4: Run them and confirm they pass**

Run: `bun test tests/unit/lib/format-tokens.test.ts tests/unit/styles/palette-contrast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(editor): add text colour and font size tokens with the Appendix A palette`

---

### Task 2: `SCHEMA_FLOOR = 2` (server half, B3)

**Files:**
- Modify: `lib/security/client-schema-gate.ts`
- Modify: `scripts/hocus-server.ts`. Change both gate sites and the startup log line.
- Modify: `lib/security/guardrail-config.ts`. Doc comment only: the env can raise the floor, never lower it.
- Test: `tests/unit/lib/security/client-schema-gate.test.ts`, `tests/unit/scripts/hocus-client-gate.test.ts`

**Interfaces:**
- Consumes: `CLIENT_SCHEMA` (`lib/schema-version.ts`), `isClientOutdated`, `HOCUS_MIN_CLIENT_SCHEMA` (raw env value, still default 0).
- Produces, in `client-schema-gate.ts`:
  ```ts
  /** Lowest client schema Hocus ever admits to gated documents. Only goes up. */
  export const SCHEMA_FLOOR = 2;
  export function effectiveMinClientSchema(configured: number): number; // Math.max(configured, SCHEMA_FLOOR)
  ```
- Produces, in `hocus-server.ts`: `const minClientSchema = effectiveMinClientSchema(HOCUS_MIN_CLIENT_SCHEMA)`. It replaces `HOCUS_MIN_CLIENT_SCHEMA` in the upgrade `outdated` flag and in `onConnect`. The startup line is exactly ``[hocus] client schema gate: min=${minClientSchema} (floor ${SCHEMA_FLOOR}, env ${HOCUS_MIN_CLIENT_SCHEMA})``.

- [ ] **Step 1: Write the failing tests**

```ts
// client-schema-gate.test.ts
it("never goes below the floor", () => {
  expect([0, 1, 2, 3].map(effectiveMinClientSchema)).toEqual([2, 2, 2, 3]);
});
it("the floor never refuses the current client", () => {
  expect(SCHEMA_FLOOR).toBeLessThanOrEqual(CLIENT_SCHEMA);
});
```

In `hocus-client-gate.test.ts`, replace "accepts everything in log-only mode and logs bucketed counts" with the staging drill below. Also remove `HOCUS_MIN_CLIENT_SCHEMA: "2"` from "never lets a refused client grow the queue into a socket reset". It now runs on the floor alone; this is the refused-client soak ship gate.

```ts
for (const env of [{}, { HOCUS_MIN_CLIENT_SCHEMA: "0" }]) {
  it(`enforces the floor with env ${JSON.stringify(env)} (staging drill)`, async () => {
    const server = await start(env);
    const outcomes = await Promise.all(
      [null, "abc", "1", "2"].map((s) => attach(openSocket(server, s), crypto.randomUUID()).outcome),
    );
    expect(outcomes).toEqual(["client_outdated", "client_outdated", "client_outdated", "synced"]);
    expect(server.logs()).toContain("client schema gate: min=2 (floor 2, env 0)");
    await server.stop();
    const line = server.logs().split("\n").find((l) => l.includes('"client_schema"'));
    const counts = JSON.parse(line ?? "{}");
    expect(counts).toMatchObject({ missing: 1, invalid: 1, low: 1, ok: 1 });
    // ≥: confirm against `attach` whether a refused provider can re-send auth; tighten to 3 if not
    expect(counts.refused).toBeGreaterThanOrEqual(3);
  }, TIMEOUT_MS);
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/lib/security/client-schema-gate.test.ts tests/unit/scripts/hocus-client-gate.test.ts`
Expected: FAIL. `SCHEMA_FLOOR` is not exported, and the drill sees `synced` for `null`, `abc` and `1`.

- [ ] **Step 3: Implement the floor and use it at both gate sites**

- [ ] **Step 4: Run the gate, guardrail-config and every spawned-server suite**

Run: `bun test tests/unit/lib/security tests/unit/scripts tests/unit/lib/collab-session-refusal.test.ts tests/unit/helpers/spawn-hocus.test.ts`
Expected: PASS. `guardrail-config.test.ts` still expects the raw env default `0`.

Every socket opener was checked against PR B:
- the app and the load harness send `schema=2` (`withClientVersion`);
- the spawned-server tests send `?schema=2`;
- `global-tabs-poison.spec.ts` only opens exempt `global-tabs-*` documents.

So no other test changes.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(security): enforce a client schema floor of 2 in code`

---

### Task 3: Rewrite stored legacy highlight values on load (server half)

**Files:**
- Modify: `lib/yjs-mark-migration.ts`
- Test: `tests/unit/lib/yjs-mark-migration.test.ts`, `tests/unit/scripts/hocus-highlight-rewrite.test.ts`

**Interfaces:**
- Consumes: `highlightTokenFromValue` (`lib/highlight-tokens.ts`; pure and server-safe), `markNameFromKey`.
- Produces: `migrateLegacyMarks(doc: Y.Doc, fragmentName?: string): number`. The signature is unchanged and the call site in `afterLoadDocument` is untouched. It now also rewrites the `color` of every `highlight` / `highlight--<hash>` attribute whose value is exactly `var(--tt-color-highlight-<token>)` to the bare token.
  - The key and the other attrs stay the same.
  - Hex values, `var(--background)`, tokens, `null` and every other mark's values are left untouched. Nothing is deleted.
  - Renames and rewrites share one pass and one `MARK_MIGRATION_ORIGIN` transaction. The return value counts the patched ranges.

- [ ] **Step 1: Write the failing unit tests**

Build docs with `Y.XmlText.insert(0, "abc", { highlight: { color } })`.

```ts
it("rewrites the legacy variable to its token under plain and hashed keys", () => {
  // keys "highlight" and "highlight--abcd1234", value var(--tt-color-highlight-red)
  expect(migrateLegacyMarks(doc)).toBe(2);
  expect(attrsOf(doc)).toEqual([{ highlight: { color: "red" } }, { "highlight--abcd1234": { color: "red" } }]);
});
it("leaves unknown values, tokens, null and other marks untouched", () => {
  // highlight #ff0, var(--background), "teal", null; textColor { color: "var(--tt-color-highlight-red)" }
  expect(migrateLegacyMarks(doc)).toBe(0);
});
it("renames and rewrites one range in one pass", () => {
  // one range with { link: {...}, highlight: { color: "var(--tt-color-highlight-blue)" } }
  expect(migrateLegacyMarks(doc)).toBe(1);
  expect(attrsOf(doc)[0]).toMatchObject({ hyperlink: expect.any(Object), highlight: { color: "blue" }, link: undefined });
});
it("is idempotent", () => {
  migrateLegacyMarks(doc);
  const updates: Uint8Array[] = [];
  doc.on("update", (u) => updates.push(u));
  expect(migrateLegacyMarks(doc)).toBe(0);
  expect(updates).toHaveLength(0);
});
it("rewrites a legacy value written after an earlier rewrite (N client in the step 3–4 window)", () => {
  migrateLegacyMarks(doc);                    // red → token
  appendLegacy(doc, "var(--tt-color-highlight-green)");
  expect(migrateLegacyMarks(doc)).toBe(1);
});
it("round-trips into the editor schema", () => {
  migrateLegacyMarks(doc);
  const json = yDocToProsemirrorJSON(doc, EDITOR_FRAGMENT_NAME);
  expect(() => getEditorSchema().nodeFromJSON(json)).not.toThrow();
});
```

In `hocus-highlight-rewrite.test.ts`:
- Seed the `documents` table with a title plus a paragraph highlighted `var(--tt-color-highlight-red)`. Do it the way `hocus-root-sweep.test.ts` seeds rows.
- `spawnHocus({ DB_PATH })`, then connect with `?schema=2` using that file's `connect` pattern.
- Expect the paragraph's highlight attrs to be `{ color: "red" }`.
- Expect `server.logs()` to contain `migrated 1 legacy mark range(s)`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/lib/yjs-mark-migration.test.ts tests/unit/scripts/hocus-highlight-rewrite.test.ts`
Expected: FAIL. The values are still `var(--tt-color-highlight-red)`.

- [ ] **Step 3: Extend `collectTextPatches` with the highlight value rewrite**

- [ ] **Step 4: Run them and confirm they pass**

Run: `bun test tests/unit/lib/yjs-mark-migration.test.ts tests/unit/scripts/hocus-highlight-rewrite.test.ts`
Expected: PASS. The existing rename tests still pass.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(hocus): rewrite legacy highlight values to tokens on load`

---

### Task 4: The `textColor` mark

**Files:**
- Create: `extensions/text-color/text-color.ts`, `extensions/text-color/index.ts`
- Modify: `components/document-editor/document-editor.scss`. Add one rule per token: `.tiptap span[data-text-color="<token>"] { color: var(--tt-color-text-<token>); }`. Reuse the `$highlight-tokens` list.
- Test: `tests/unit/extensions/text-color.test.ts`

**Interfaces:**
- Consumes: `textColorTokenFromValue`, `TextColorToken` (Task 1).
- Produces: `export const TextColor: Mark`, named `"textColor"`.
  - Attribute: `color`, default `null`.
    - `parseHTML` reads `data-text-color` through `textColorTokenFromValue`.
    - `renderHTML` returns `{ "data-text-color": token }` or `{}`.
  - Mark `parseHTML`: `[{ tag: "span[data-text-color]", consuming: false, getAttrs }]`. `getAttrs` returns `false` unless the token is valid, so foreign `style="color:…"` spans never match.
  - Mark `renderHTML`: `["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]`.
  - No `inclusive` or `excludes`; no `validate`.
- Produces, the commands PR D calls (module augmentation in `text-color.ts`):
  ```ts
  declare module "@tiptap/core" {
    interface Commands<ReturnType> {
      textColor: {
        /** Applies a palette colour; empty selection sets a stored mark. False for anything but a TextColorToken. */
        setTextColor: (color: TextColorToken) => ReturnType;
        /** Removes text colour from the selection, or the whole run around an empty cursor. */
        unsetTextColor: () => ReturnType;
      };
    }
  }
  ```
  `setTextColor` is `token ? commands.setMark(name, { color: token }) : false`. `unsetTextColor` is `commands.unsetMark(name, { extendEmptyMarkRange: true })`.
  PR D reads the current value with `editor.getAttributes("textColor").color`.

- [ ] **Step 1: Write the failing tests**

Use `createTestEditor({ extensions: [...DEFAULT_EXTENSIONS, TextColor], content })`.

```ts
it("applies a token as data-text-color, never a style", () => {
  editor.chain().setTextSelection({ from: 2, to: 5 }).setTextColor("red").run();
  expect(editor.getHTML()).toContain('<span data-text-color="red">');
  expect(editor.getHTML()).not.toContain("style=");
});
it("refuses tampered tokens", () => {
  for (const v of ["red;x", "__proto__", "RED", "var(--tt-color-text-red)", "#f00"]) {
    expect(editor.commands.setTextColor(v as TextColorToken)).toBe(false);
  }
  expect(editor.getHTML()).not.toContain("data-text-color");
});
it("empty selection sets a stored mark for the next characters", () => {
  editor.chain().setTextSelection(3).setTextColor("blue").insertContent("x").run();
  expect(markAt(editor, 3)).toEqual({ type: "textColor", attrs: { color: "blue" } });
});
it("is inclusive: typing at the end of red text stays red", () => {
  // paragraph "red" fully red; cursor at its end; insertContent("d") → "redd" one red run
});
it("unsetTextColor with an empty cursor removes the whole run", () => {});
it("parses its own spans and drops foreign colour", () => {
  editor.commands.setContent('<h1>t</h1><p><span data-text-color="teal">a</span><span style="color:red">b</span><span data-text-color="red;x">c</span></p>');
  expect(colours(editor)).toEqual(["teal"]);
});
it("does not apply inside inline code or code blocks", () => {
  expect(editorInCodeBlock.can().setTextColor("red")).toBe(false);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/extensions/text-color.test.ts`
Expected: FAIL with `Cannot find module "@/extensions/text-color"`.

- [ ] **Step 3: Implement `TextColor` and its CSS**

- [ ] **Step 4: Run them and confirm they pass**

Run: `bun test tests/unit/extensions/text-color.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(editor): add the textColor token mark`

---

### Task 5: The `fontSize` mark and the heading rule

**Files:**
- Create: `extensions/font-size/font-size.ts`, `extensions/font-size/heading-rule.ts`, `extensions/font-size/index.ts`
- Modify: `components/document-editor/document-editor.scss`
  - Add `$font-size-steps: (xs: 0.75em, sm: 0.875em, lg: 1.25em, xl: 1.5em);` and one rule per entry: `.tiptap span[data-font-size="<k>"] { font-size: <v>; }`.
  - Add `.tiptap :is(h1, h2, h3, h4, h5, h6) span[data-font-size] { font-size: inherit; }` for content that reaches a heading remotely.
- Test: `tests/unit/extensions/font-size.test.ts`

**Interfaces:**
- Consumes:
  - `fontSizeTokenFromValue`, `FontSizeToken`, `FONT_SIZE_EM` (Task 1);
  - `changedRanges` (`extensions/shared`);
  - `ySyncPluginKey` (`@tiptap/y-tiptap`).
- Produces: `export const FontSize: Mark`, named `"fontSize"`. Its attribute is `size`, default `null`. Parse, render and options mirror `TextColor`, with `span[data-font-size]` and `data-font-size`.
- Produces, the commands PR D calls:
  ```ts
  declare module "@tiptap/core" {
    interface Commands<ReturnType> {
      fontSize: {
        /** Sets a size step on text outside headings. Empty selection sets a stored mark (not in a heading).
         *  False for a non-token, or when nothing in the selection can take it. */
        setFontSize: (size: FontSizeToken) => ReturnType;
        unsetFontSize: () => ReturnType; // unsetMark(name, { extendEmptyMarkRange: true }); allowed everywhere
      };
    }
  }
  ```
  `setFontSize` handles a range selection as follows:
  - walk each selection range with `doc.nodesBetween`;
  - for every textblock that is not a `heading` and allows the mark, `tr.addMark` over its part of the range;
  - return whether any block qualified;
  - mutate only when `dispatch` is given.

  So `editor.can().setFontSize("lg")` is `false` in the title and in headings. PR D's stepper uses it for "Headings scale automatically".
- Produces: the `fontSizeHeadingRule` plugin (`heading-rule.ts`), installed by `FontSize.addProseMirrorPlugins()`. Its `appendTransaction(transactions, _old, state)`:
  - returns `null` when no transaction changed the doc, or any carries `ySyncPluginKey` meta (it never writes in response to remote updates);
  - takes `changedRanges(transactions)`, using the whole doc when that is `null`;
  - for every touched `heading` whose content has the mark, calls `tr.removeMark(start, end, fontSize)`;
  - also drops a stored `fontSize` mark when `$from.parent` is a heading.

  This one rule covers `toggleHeading`/`setNode`, the `## ` input rule, paste and drop into headings.

- [ ] **Step 1: Write the failing tests**

```ts
it("applies a size token in a paragraph as data-font-size", () => {});
it("refuses tampered tokens", () => {
  for (const v of ["m", "md", "20px", "LG", "__proto__", 42])
    expect(editor.commands.setFontSize(v as FontSizeToken)).toBe(false);
});
it("cannot size the title or a heading", () => {
  editor.commands.setTextSelection(2); // in the title
  expect(editor.can().setFontSize("lg")).toBe(false);
  expect(editor.commands.setFontSize("lg")).toBe(false);
});
it("a selection across a heading and a paragraph sizes only the paragraph", () => {
  editor.chain().selectAll().setFontSize("xl").run();
  expect(sizesIn(editor, "heading")).toEqual([]);
  expect(sizesIn(editor, "paragraph")).toEqual(["xl"]);
});
it("toggleHeading strips fontSize in one undo step", () => {
  // paragraph with an "lg" run → toggleHeading({ level: 2 })
  expect(sizesIn(editor, "heading")).toEqual([]);
  editor.commands.undo();
  expect(sizesIn(editor, "paragraph")).toEqual(["lg"]);
});
it("paste into a heading drops fontSize, keeps colour", () => {
  editor.commands.setTextSelection(2); // title
  editor.view.pasteHTML('<p><span data-font-size="xl"><span data-text-color="red">Big</span></span></p>');
  expect(sizesIn(editor, "heading")).toEqual([]);
  expect(editor.getHTML()).toContain('data-text-color="red"');
});
it("pasted heading blocks lose fontSize; pasted paragraphs keep it", () => {
  editor.view.pasteHTML('<h2><span data-font-size="xl">H</span></h2><p><span data-font-size="sm">p</span></p>');
  expect(sizesIn(editor, "heading")).toEqual([]);
  expect(sizesIn(editor, "paragraph")).toEqual(["sm"]);
});
it("drops a stored fontSize mark once the cursor is in a heading", () => {});
it("never rewrites remote transactions", () => {
  const tr = editor.state.tr.addMark(2, 4, schema.marks.fontSize.create({ size: "lg" })).setMeta(ySyncPluginKey, {});
  editor.view.dispatch(tr);
  expect(sizesIn(editor, "heading")).toEqual(["lg"]);
});
it("SCSS steps match FONT_SIZE_EM", () => {
  const scss = readFileSync("components/document-editor/document-editor.scss", "utf8");
  for (const [k, v] of Object.entries(FONT_SIZE_EM)) expect(scss).toContain(`${k}: ${v}em`);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/extensions/font-size.test.ts`
Expected: FAIL with `Cannot find module "@/extensions/font-size"`.

- [ ] **Step 3: Implement `FontSize`, `fontSizeHeadingRule` and the CSS**

- [ ] **Step 4: Run them and confirm they pass, then run the existing paste and title suites**

Run: `bun test tests/unit/extensions/font-size.test.ts tests/unit/schema/paste-handling.test.ts tests/unit/schema/title-document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(editor): add the fontSize token mark and keep it out of headings`

---

### Task 6: Highlight values become tokens in the mark (B4)

**Files:**
- Modify: `extensions/token-highlight/token-highlight.ts`
- Modify: `components/tiptap-ui/color-highlight-button/use-color-highlight.ts`. A one-line change: `isColorHighlightActive` compares `highlightTokenFromValue(highlightColor) ?? highlightColor`, so the old popover's swatches still show pressed after their legacy values are normalized.
  - The popover applies colours through `toggleHighlight({ color })` (checked on PR B), so it already goes through the normalizing command.
  - Its "Default background" (`var(--background)`) becomes a no-op.
  - It otherwise keeps working unchanged until PR D replaces it.
- Test: `tests/unit/extensions/token-highlight.test.ts`

**Interfaces:**
- Consumes: `highlightTokenFromValue`, `DEFAULT_HIGHLIGHT_TOKEN`, `HighlightToken`.
- Produces: `TokenHighlight`. The schema and the attribute key `color` are unchanged.
  - `color.renderHTML`: `{ "data-color": token, "data-highlight": token }` or `{}`. The **token** goes into `data-color`, not the raw value, so N tabs parse TinyDocy copies as tokens.
  - `color.parseHTML`: `data-highlight`, else `data-color`, both through `highlightTokenFromValue`. It never reads `style`.
  - Mark `parseHTML`: `[{ tag: "mark", getAttrs }]`, returning `false` without a token. Foreign `<mark>` and `background-color` are dropped.
  - Commands, same signatures as stock:
    - `setHighlight(attributes?: { color: string })` and `toggleHighlight(attributes?: { color: string })` normalize `color` with `highlightTokenFromValue`;
    - a missing `color` means `DEFAULT_HIGHLIGHT_TOKEN`;
    - any other value returns `false`;
    - `unsetHighlight()` is stock.
  - Input and paste rules `==x==`: `markInputRule` / `markPasteRule` with `getAttributes: () => ({ color: DEFAULT_HIGHLIGHT_TOKEN })`.
  - PR D calls `setHighlight({ color: HighlightToken })` and `unsetHighlight()`.

- [ ] **Step 1: Add the failing tests**

```ts
it("stores legacy values as tokens", () => {
  editor.chain().selectAll().setHighlight({ color: "var(--tt-color-highlight-red)" }).run();
  expect(highlightColors(editor)).toEqual(["red"]);
});
it("defaults to yellow for toggleHighlight() and ==x==", () => {
  editor.chain().setTextSelection({ from: 2, to: 4 }).toggleHighlight().run();
  expect(highlightColors(editor)).toEqual(["yellow"]);
  editor.view.pasteText("==hi== ");
  expect(highlightColors(editor)).toEqual(["yellow", "yellow"]);
});
it("refuses non-token values", () => {
  for (const v of ["#ff0", "var(--background)", "red;x"]) expect(editor.commands.setHighlight({ color: v })).toBe(false);
});
it("toggles off a highlight set with the legacy form", () => {
  const legacy = { color: "var(--tt-color-highlight-blue)" };
  editor.chain().selectAll().toggleHighlight(legacy).toggleHighlight(legacy).run();
  expect(highlightColors(editor)).toEqual([]);
});
it("parses own tokens (N and N+1 copies) and drops foreign background", () => {
  editor.commands.setContent('<h1>t</h1><p><mark data-highlight="teal">a</mark><mark data-color="var(--tt-color-highlight-red)">b</mark><mark style="background-color: red">c</mark><span style="background-color:#ff0">d</span></p>');
  expect(highlightColors(editor)).toEqual(["teal", "red"]);
});
it("renders the token in data-color for a stored legacy value", () => {
  expect(html("var(--tt-color-highlight-red)")).toContain('data-color="red"');
});
it("the old popover still shows a legacy swatch as active", () => {
  // apply through the popover's own path: toggleHighlight({ color }) as use-color-highlight.ts calls it
  editor.chain().selectAll().toggleHighlight({ color: "var(--tt-color-highlight-green)" }).run();
  expect(highlightColors(editor)).toEqual(["green"]);
  expect(isColorHighlightActive(editor, "var(--tt-color-highlight-green)")).toBe(true);
});
```

Keep the existing PR B cases: render fuzz, key `color`, and exact legacy matching.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/extensions/token-highlight.test.ts`
Expected: FAIL. The value is stored raw, `toggleHighlight()` stores `null`, and the foreign `<mark>` is parsed.

- [ ] **Step 3: Implement the overrides and the `isColorHighlightActive` normalization**

- [ ] **Step 4: Run them and confirm they pass**

Run: `bun test tests/unit/extensions/token-highlight.test.ts tests/unit/components`
Expected: PASS.

- [ ] **Step 5: Commit** (review report, then wait for approval)

`feat(editor): store highlight values as tokens and drop foreign backgrounds on paste`

---

### Task 7: Register the marks, update the snapshot and allowlist (both halves meet)

The schema snapshot and the allowlist must change in the **same commit**. The tests tie them together (`schema-names.test.ts`: nothing allowed beyond the schema except legacy names), so every commit stays green.

**Files:**
- Modify: `components/document-editor/document-editor-config.ts`. Add `TextColor` and `FontSize` right after `TokenHighlight.configure({ multicolor: true })`.
- Modify: `tests/helpers/create-test-editor.ts`. Add both marks to `DEFAULT_EXTENSIONS`.
- Modify: `tests/fixtures/schema-snapshot.json`, regenerated.
- Modify: `lib/schema-names.ts`. Add `"fontSize"` and `"textColor"` to `SCHEMA_MARK_NAMES`, and update the doc comment: they shipped with this release's server half.
- Modify: `tests/unit/schema/schema-names.test.ts`, `tests/unit/lib/security/hocus-document-guard.test.ts`
- Create: `tests/unit/fuzz/format-render-fuzz.test.ts`, `tests/unit/schema/format-marks-yjs.test.ts`

**Interfaces:**
- Consumes: `TextColor` (Task 4), `FontSize` (Task 5), `TokenHighlight` (Task 6), `getEditorSchema()`, `describeSchema()`.
- Produces: the N+1 editor schema. Its marks are `textColor { color }` and `fontSize { size }`, each `inclusive: true` with default excludes. The allowlist admits both.

- [ ] **Step 1: Write the failing tests**

```ts
// schema-names.test.ts: add
it("allows the release N+1 marks", () => {
  expect(isAllowedMarkKey("textColor")).toBe(true);
  expect(isAllowedMarkKey("fontSize--abcd1234")).toBe(true);
});
// hocus-document-guard.test.ts: replace "refuses the smart toolbar marks until their server half ships"
it("allows the smart toolbar marks now that their server half ships", () => {
  expect(findDisallowedSchemaNames(craft([], ["textColor", "fontSize--abcd1234"]))).toEqual([]);
  expect(findDisallowedSchemaNames(craft([], ["zzz"]))).toEqual(["zzz"]); // unknown names still refused
});
```

```ts
// format-render-fuzz.test.ts: real schema, DOMSerializer.fromSchema(getEditorSchema())
const HOSTILE = ["red;background:url(x)", '" onmouseover="x', "</span><script>", "var(--x)", "RED", " red",
  "x".repeat(10_000), 42, 0, true, {}, { color: "red" }, ["red"], null, undefined];
// plus 2,000 random strings over [a-z0-9;:()"'<>/\\ -] of length 0..40

for (const [mark, attr, data] of [["textColor", "color", "data-text-color"],
  ["fontSize", "size", "data-font-size"], ["highlight", "color", "data-highlight"]] as const) {
  it(`${mark} renders hostile values plain and never throws`, () => {
    for (const value of [...HOSTILE, ...randomStrings(2000)]) {
      const html = render(schema.text("x", [schema.marks[mark].create({ [attr]: value, style: "x", onclick: "x" })]));
      expect(html).not.toContain("style=");
      expect(html).not.toContain("onclick");
      const found = html.match(new RegExp(`${data}="([^"]*)"`))?.[1];
      if (found !== undefined) expect(TOKENS[mark]).toContain(found);
    }
  });
}
```

```ts
// format-marks-yjs.test.ts
it("survives a Yjs round trip", () => {
  const json = docWith([{ type: "textColor", attrs: { color: "teal" } }, { type: "fontSize", attrs: { size: "sm" } }]);
  expect(yDocToProsemirrorJSON(prosemirrorJSONToYDoc(schema, json, "default"), "default")).toEqual(json);
});
it("keeps concurrent colour and size on the same text (separate keys, no last-writer-wins)", () => {
  // two Y.Docs synced, then A formats {textColor:{color:"red"}} and B formats {fontSize:{size:"lg"}} on the same range,
  // exchange updates, both docs project to text carrying both marks
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bun test tests/unit/schema tests/unit/lib/security/hocus-document-guard.test.ts tests/unit/fuzz/format-render-fuzz.test.ts`
Expected: FAIL. The marks are not in the schema, and the allowlist refuses them.

- [ ] **Step 3: Register the marks and add the allowlist entries**

- [ ] **Step 4: Regenerate the snapshot and review the diff**

Run: `UPDATE_SCHEMA_SNAPSHOT=1 bun test tests/unit/schema/schema-snapshot.test.ts; git diff tests/fixtures/schema-snapshot.json`
Expected: the test fails with "Snapshot rewritten". The diff is exactly these two additions under `marks`, and nothing else changes:

```json
"fontSize": { "attrs": ["size"], "inclusive": true, "excludes": "_" },
"textColor": { "attrs": ["color"], "inclusive": true, "excludes": "_" },
```

Anything else (for example a changed `highlight` entry) is a spec §3 violation. Stop and report.

- [ ] **Step 5: Run the unit suite and typecheck**

Run: `bun run test && bun run typecheck`
Expected: PASS. This includes `schema-invariants`, the fuzz suites and the PR B schema-repair tests.

- [ ] **Step 6: Commit** (review report, then wait for approval)

The commit body carries the snapshot justification. Spec §3 allows only additive schema changes. This change adds two marks and adds no attribute to an existing mark or node. It loosens no content or marks spec. The ingress allowlist gains the same two names in the same commit, and Hocus restarts first on deploy.

`feat(editor): register textColor and fontSize and allow them at ingress`

---

### Task 8: Paste and render in a real browser (HoE: tab-to-tab keeps tokens, Docs/Word paste plain)

**Files:**
- Create: `tests/fixtures/clipboard/google-docs.html`, `tests/fixtures/clipboard/word.html`. These are real captures; see Step 1.
- Create: `tests/e2e/helpers/clipboard.ts`, `tests/e2e/format-marks.spec.ts`, `tests/unit/schema/format-paste.test.ts`

**Interfaces:**
- Consumes:
  - the commands from Tasks 4–6, through `window.__tiptap_editor`;
  - `EditorPage`;
  - `E2E_HOCUS_URL` for a raw provider with `?schema=2`.
- Produces, in `tests/e2e/helpers/clipboard.ts`:
  - `copySelectionHtml(page: Page): Promise<string>`. It dispatches a `copy` `ClipboardEvent` with a fresh `DataTransfer` on `.tiptap` and returns `getData("text/html")`, which is ProseMirror's real clipboard serialization in Chromium.
  - `pasteHtml(page: Page, html: string): Promise<void>`. It dispatches a `paste` `ClipboardEvent` whose `DataTransfer` has `text/html` (and `text/plain` stripped of tags).

- [ ] **Step 1: Capture the real clipboard samples** (needs a person with Google Docs and Word)

In each app, type `Red Large Marked Plain`. Make "Red" red text, "Large" 18 pt and "Marked" yellow-highlighted. Select the line and copy. Then on macOS run:
`osascript -e 'the clipboard as «class HTML»' | perl -ne 'print pack("H*", $1) if /«data HTML([0-9A-F]+)»/' > tests/fixtures/clipboard/google-docs.html`

Do the same for Word, into `word.html`. Before committing:
- grep each file for the author's name and email;
- remove any `<o:DocumentProperties>` or `<xml>` metadata block;
- keep only the four words.

Never hand-write these fixtures: the HoE criterion is a real sample.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/schema/format-paste.test.ts
it("round-trips all three tokens between two editors via the clipboard serializer", () => {
  const a = createTestEditor({ content: docWith([...threeMarks]) });
  a.commands.selectAll();
  const { dom } = a.view.serializeForClipboard(a.state.selection.content());
  const b = createTestEditor();
  b.commands.setTextSelection(b.state.doc.content.size - 1);
  b.view.pasteHTML(dom.innerHTML);
  expect(markTypes(b)).toEqual(expect.arrayContaining([
    { type: "textColor", attrs: { color: "red" } },
    { type: "fontSize", attrs: { size: "lg" } },
    { type: "highlight", attrs: { color: "teal" } },
  ]));
});
```

```ts
// tests/e2e/format-marks.spec.ts
test("tab-to-tab paste keeps colour, size and highlight tokens", async ({ context }) => {
  // tab A: new doc, paragraph "Red Large Marked", apply setTextColor("red"), setFontSize("lg"), setHighlight({ color: "teal" })
  // to the three words; select the paragraph; html = await copySelectionHtml(pageA)
  expect(html).toContain('data-text-color="red"');
  // tab B: new doc, caret in an empty paragraph, await pasteHtml(pageB, html)
  await expect(pageB.locator('.tiptap p span[data-text-color="red"]')).toHaveText("Red");
  await expect(pageB.locator('.tiptap p span[data-font-size="lg"]')).toHaveText("Large");
  await expect(pageB.locator('.tiptap p mark[data-highlight="teal"]')).toHaveText("Marked");
});

for (const name of ["google-docs", "word"]) {
  test(`${name} sample pastes plain`, async ({ page }) => {
    const html = readFileSync(`tests/fixtures/clipboard/${name}.html`, "utf8");
    expect(html).toMatch(/(?<![-\w])color:/i);        // the sample really carries text colour (not just background-color)
    expect(html).toMatch(/font-size:/i);
    expect(html).toMatch(/background(-color)?:/i);
    // new doc, caret in an empty paragraph, pasteHtml(page, html)
    await expect(page.locator(".tiptap")).toContainText("Red Large Marked Plain");
    await expect(page.locator(".tiptap [data-text-color], .tiptap [data-font-size], .tiptap mark")).toHaveCount(0);
    expect(await page.locator(".tiptap").innerHTML()).not.toMatch(/style="[^"]*(color|font-size|background)/i);
  });
}

test("remote fontSize in a heading renders at heading size", async ({ page }) => {
  // raw provider (E2E_HOCUS_URL + "/?schema=2") writes an h2 whose text carries { fontSize: { size: "xl" } }
  const [span, h2] = await Promise.all([fontSizeOf(page, ".tiptap h2 span[data-font-size]"), fontSizeOf(page, ".tiptap h2")]);
  expect(span).toBe(h2);
});
```

- [ ] **Step 3: Run them and confirm they fail, or pass for the right reason**

Start the E2E servers (Global Constraints). Run `bun test tests/unit/schema/format-paste.test.ts`, then `E2E_RUN tests/e2e/format-marks.spec.ts`.

Expected: FAIL only on the missing helper module. If a sample test passes before the helper exists, the test is vacuous: fix it.

- [ ] **Step 4: Implement `clipboard.ts` and run again**

Run: the same commands.
Expected: PASS.

- [ ] **Step 5: Look at it in the app**

On `http://localhost:3600`, use `window.__tiptap_editor` to apply all ten text colours, all ten highlights and the four sizes to a paragraph. Screenshot light and dark.

Every colour must match its swatch value in Appendix A. Sizes must step visibly, and an `xl` run converted with `toggleHeading` must lose its size.

- [ ] **Step 6: Commit** (review report, then wait for approval)

`test(e2e): keep own tokens on paste and drop Docs and Word styling`

---

### Task 9: Split the server half from the client half, and drill the release order

This task proves that spec §3.1 step 3 can be deployed on its own. It does not change runtime code.

**Files:**
- Create: `tests/unit/scripts/hocus-import-boundary.test.ts`, `tests/e2e/mixed-version.spec.ts`

**Interfaces:**
- Consumes: `scripts/hocus-server.ts` and its import graph; `EditorPage`; `E2E_HOCUS_URL`.
- Produces: the opt-in env `E2E_N_BASE_URL`, the URL of a `next dev` running release N. When it is unset, the spec skips.

The server half and client half, as files:

| Half | Deployed by | Files in this PR |
|---|---|---|
| Server | `bunx pm2@6.0.14 restart editor-hocus` (TypeScript from source) | `lib/schema-names.ts`, `lib/security/client-schema-gate.ts`, `lib/security/guardrail-config.ts`, `lib/yjs-mark-migration.ts`, `lib/highlight-tokens.ts`, `scripts/hocus-server.ts` |
| Client | `bun run build`, then `restart editor-next` | `extensions/text-color/*`, `extensions/font-size/*`, `extensions/token-highlight/*`, `lib/format-tokens.ts`, `components/document-editor/*`, `components/tiptap-ui/color-highlight-button/*`, `styles/_variables.scss` |

- [ ] **Step 1: Write the import-boundary test**

```ts
// Walks scripts/hocus-server.ts with new Bun.Transpiler({ loader: "ts" }).scan(src).imports
// (type-only imports are not listed), resolving "@/…" and relative paths to files.
it("the Hocus server loads only lib/ and scripts/ code and server packages", () => {
  const { files, packages } = importGraph("scripts/hocus-server.ts");
  expect(files.filter((f) => !/^(lib|scripts)\//.test(f))).toEqual([]);
  expect(packages.filter((p) => !/^(@hocuspocus\/|yjs$|lib0\/|bun:|node:)/.test(p))).toEqual([]);
  expect(files).toContain("lib/yjs-mark-migration.ts");
  expect(files).toContain("lib/highlight-tokens.ts");
});
```

Run: `bun test tests/unit/scripts/hocus-import-boundary.test.ts`
Expected: PASS against today's graph; it was checked on PR B, where it has 22 `lib/` files. To prove the test bites, temporarily add `import "@/extensions/text-color"` to `lib/yjs-mark-migration.ts`, see it FAIL, then revert.

- [ ] **Step 2: Confirm the deploy needs no install or asset change**

Run: `git diff feat/smart-toolbar-rollout-safety...HEAD --stat -- package.json bun.lock public/`
Expected: empty, which means step 3 needs no dependency change. If it is not empty, list the change in the Deploy note.

- [ ] **Step 3: Write the mixed-version spec (ship gate: N + N+1 soak)**

```ts
test.skip(!process.env.E2E_N_BASE_URL, "needs a release N server (E2E_N_BASE_URL)");

test("an N client meets the new marks: freezes, deletes nothing; N+1 never freezes", async ({ browser }) => {
  // N+1 context (baseURL E2E_BASE_URL) and N context (baseURL E2E_N_BASE_URL) open the same new doc id;
  // N+1 seeds a title + 30 paragraphs, both waitForSync, record serverBlocks = block count via raw provider (?schema=2)
  // N+1: setTextColor("red") and setFontSize("lg") on a word in paragraph 3
  await expect(nPage.getByText(OUTDATED_COPY)).toBeVisible({ timeout: 10_000 });
  await expect(nPage.locator(".tiptap")).toHaveAttribute("contenteditable", "false");
  // N+1 keeps typing: 500 characters at full speed in paragraph 10
  await expect(nextPage.locator(".tiptap")).toHaveAttribute("contenteditable", "true");
  await expect(nextPage.locator(".document-size-notice")).toHaveCount(0);
  const server = await readServer(docId);
  expect(server.blocks).toBe(serverBlocks);               // 0 deleted blocks
  expect(server.xml).toContain("textColor");
});
```

`OUTDATED_COPY` is PR B's verbatim banner, "A newer TinyDocy is available. Reload to keep editing; your changes on this device are kept."

- [ ] **Step 4: Run the mixed-version drill**

1. Start the E2E servers (Global Constraints) from this branch.
2. In a scratch worktree of release N, run `N_SHA=$(git rev-parse feat/smart-toolbar-rollout-safety)` (or the PR B merge commit once merged) and `git worktree add --detach "$TMPDIR/editor-n" "$N_SHA"`. The branch itself is checked out in another worktree, so a non-detached add refuses. In the new worktree, run `bun install --frozen-lockfile`, then `DB_PATH="$E2E_DB" MAX_TOTAL_DOCUMENTS=1000000 NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1734 bun next dev -p 3601`.
3. Run: `E2E_N_BASE_URL=http://localhost:3601 E2E_RUN tests/e2e/mixed-version.spec.ts`

Expected: PASS. Then run it with `--repeat-each=5` and expect PASS too; this is the nightly-soak gate run before deploy.

Remove the worktree afterwards (`git worktree remove "$TMPDIR/editor-n"`).

- [ ] **Step 5: Drill steps 3–4 with production builds, including the build-step check**

Run this in a scratch worktree, never against the live site.

1. **Serve release N.** `git worktree add --detach "$TMPDIR/editor-deploy" "$N_SHA"`, then in it: `bun install --frozen-lockfile && NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1734 bun run build && PORT=3700 bun run start`.
2. **Record what N serves.** `curl -s localhost:3700/ | grep -o '/_next/static/chunks/[^"]*\.js' | sort -u > "$TMPDIR/before.txt"`.
3. **Pull and restart Hocus.** In the worktree, `git checkout --detach "$(git rev-parse feat/smart-toolbar-schema)"` (the pull; detached because the branch is checked out in the main worktree). Restart Hocus from it on 1734 with `DB_PATH="$E2E_DB"`. Expect `[hocus] client schema gate: min=2 (floor 2, env 0)`.
   - Open `http://localhost:3700` in the Browser pane. The N client stays editable.
   - A raw provider without `schema` is refused (`client_outdated`).
   - Within a minute the log shows a `client_schema` line with `refused` ≥ 1.
4. **Build-step check (spec builder-check).** Run `bun run build` while the N server keeps running. Then repeat the `curl` into `after.txt`, run `diff "$TMPDIR/before.txt" "$TMPDIR/after.txt"`, and fetch one chunk from `before.txt` (`curl -o /dev/null -w '%{http_code}'`). Record whether the running server served new HTML or returned 404 for old chunks.
   Either result is safe: the build runs after the Hocus restart. If old chunks 404, the Deploy note gains one line: "Pages may fail to load between the build and the Next restart; run them back to back."
5. **Restart Next.** Restart `PORT=3700 bun run start`. Two checks (a production build has no `window.__tiptap_editor`):
   - the chunk list now differs from `before.txt`;
   - the next `client_schema` line's `builds` shows the PR C build id (the short SHA).

Paste the outcomes of steps 3 and 4 into the PR description. Remove the worktree.

- [ ] **Step 6: Commit** (review report, then wait for approval)

`test: guard the Hocus import boundary and drill the N+1 release order`

---

### Task 10: 50k alternating colour runs within the typing budget (HoE abuse soak)

First rebase onto a `main` that contains PR A (#27); see **Base**.

**Files:**
- Create: `tests/e2e/color-runs-perf.spec.ts`
- Modify: `playwright.config.ts`. Add `**/color-runs-perf.spec.ts` to the `perf` project's `testMatch` and to the `chromium` project's `testIgnore`.
- Modify: `tests/TESTING.md`. Add one row describing the spec.

**Interfaces:**
- Consumes (PR A, `tests/e2e/helpers/perf-observer.ts`): `injectKeystrokeTimer(page)`, `collectKeystrokeLatencies(page)`, `percentile(values, p)`, `median(values)`. Also `spawnHocus`, `EditorPage`, and the env knobs `PERF_ROUNDS`, `PERF_CPU_THROTTLE` and `PERF_MAX_REGRESSION`.
- Produces: `colourRunsDoc(mark: "textColor" | "bold"): JSONContent`.
  - It holds a title and 500 paragraphs, each with 100 runs of `"ab "`: 50,000 runs.
  - `textColor` alternates `red`/`blue`. `bold` alternates bold/plain, which gives the same node count.

Decisions recorded here:
- **Baseline.** The baseline arm is the same document with 50k alternating bold runs, in the same run. It isolates what the colour mark costs over an existing mark with the same node count. Plain text would compare 500 text nodes against 50,000.
- **Caps.** 50k colour runs encode to about 3.6 MB of Yjs. That is above both the production cap (`MAX_DOC_SIZE_BYTES` = 2 MiB) and the default frame cap. The spec therefore runs its own `spawnHocus({ MAX_DOC_SIZE_BYTES: "16777216", HOCUS_MAX_PAYLOAD_BYTES: "16777216" })`, with `bypassCSP` and `window.__HOCUS_URL`. In production, a document holds roughly 25k such runs before `document_too_large`.
- **Caret.** It goes at the run boundary between runs 50 and 51 of paragraph 250 (red|blue, or bold|plain). That is the worst case for inclusive-mark logic.

- [ ] **Step 1: Write the spec**

```ts
test.describe.configure({ mode: "serial" });
test("typing p95 over 50k alternating colour runs stays within budget", async ({ browser }) => {
  test.setTimeout(600_000);
  const p95 = { bold: [] as number[], colour: [] as number[] };
  for (let round = 0; round < PERF_ROUNDS; round++) {
    const order = round % 2 === 0 ? (["bold", "colour"] as const) : (["colour", "bold"] as const);
    for (const arm of order) p95[arm].push(await runTrial(browser, arm === "colour" ? "textColor" : "bold"));
  }
  const base = median(p95.bold), colour = median(p95.colour);
  expect(colour, `colour ${colour.toFixed(1)} ms vs bold ${base.toFixed(1)} ms`)
    .toBeLessThanOrEqual(Math.min(base * (1 + PERF_MAX_REGRESSION), base + 16));
});
```

`runTrial(browser, mark): Promise<number>`:
- open a new context with `__HOCUS_URL` and `injectKeystrokeTimer`;
- open a new doc, `waitForSync`, then `setContent(colourRunsDoc(mark))`;
- assert `.document-size-notice` has count 0;
- set the caret with `__tiptap_editor.commands.setTextSelection(boundary)`;
- apply the CPU throttle `PERF_CPU_THROTTLE` (4 by default) via CDP;
- clear the samples, type 100 × `a` with `delay: 10`, and assert 100 samples;
- before throttling, wait until the upload has finished, so the trial measures typing and not the ~3.6 MB upload: `expect.poll` until the provider reports no unsynced changes, via the editor's `data-server-synced` attribute or the provider's `unsyncedChanges === 0`;
- return `percentile(samples, 95)`.

The ≤ +10% and ≤ +16 ms budget is spec §7's.

- [ ] **Step 2: Run it**

Start the E2E servers (Global Constraints). Run: `E2E_BASE_URL=http://localhost:3600 E2E_HOCUS_URL=ws://127.0.0.1:1734 CI= bun playwright test tests/e2e/color-runs-perf.spec.ts --project=perf --no-deps`. `--no-deps` is needed because the `perf` project depends on `chromium`.

Time one trial first. If `2 × PERF_ROUNDS` trials will not fit in 600 s at 4× CPU, raise `test.setTimeout` and say so in the review report.

Expected: PASS. The report logs both medians and the encoded size. Run it three times. If any run fails on noise, raise `PERF_ROUNDS` to 7 and report the spread. If it fails consistently, the colour mark costs more than bold: stop and investigate (`superpowers:systematic-debugging`) rather than loosening the budget.

- [ ] **Step 3: Commit** (review report, then wait for approval)

`test(perf): bound typing over 50k alternating colour runs`

---

### Task 11: Runbook, CHANGELOG with Deploy note, full verification and HoE C evidence

**Files:**
- Modify: `docs/operations/schema-rollout-runbook.md`
  - **Guards.** The gate has a floor (`SCHEMA_FLOOR = 2`, effective `max(env, 2)`) and is never log-only again. Note that the adoption reading below describes release N's log-only window.
  - **Release order.** Mark steps 3–4 as this release, with the exact commands from the Deploy note.
  - **Rollback.** Rolling back Next to N is safe; N clients freeze on the new marks, never delete. **Before rolling Hocus back below this release:**
    - roll back Next first;
    - set `HOCUS_MIN_CLIENT_SCHEMA=2`, because N's code has no floor and with the env unset it readmits pre-N bundles that delete coloured blocks;
    - expect N+1 tabs still open to get `4422` on `textColor`/`fontSize` until they reload.
  - **Allowlist rule.** `textColor` and `fontSize` are now allowed, and this is the worked example of the rule.
  - **Highlights.** Hocus rewrites `var(--tt-color-highlight-X)` to `X` when it loads a document. Unknown values stay as they are and render plain.
  - **Scripts and load tests.** They must always send `?schema=2` now.
- Modify: `docs/operations/abuse-guardrails-runbook.md` (line ~46) and `README.md` (the `HOCUS_MIN_CLIENT_SCHEMA` row). Both read: "Raises the minimum client schema above the built-in floor of 2; lower values have no effect."
- Modify: `tests/TESTING.md`. Document `E2E_N_BASE_URL`, the mixed-version drill, the clipboard fixtures and how to recapture them.
- Modify: `CHANGELOG.md`, under `## [Unreleased]`. Write a new top entry. After rebasing past #28's merge, Unreleased holds only this entry.

The CHANGELOG entry:

**Added**
- `textColor` and `fontSize` marks: theme-aware tokens with no inline styles, kept out of headings, and inclusive like bold.
- Commands for the coming toolbar: `setTextColor`, `unsetTextColor`, `setFontSize`, `unsetFontSize`.
- The Appendix A palette, with a contrast test.

**Changed**
- Highlights store tokens. The old "Default background" swatch is a no-op, and `toggleHighlight()`, Mod-Shift-H and `==x==` use yellow.
- Paste keeps TinyDocy's own colour, size and highlight tokens and drops foreign colour, size and background.
- Hocus rewrites legacy highlight values when it loads a document.

**Security**
- The client schema floor is 2 in code (`SCHEMA_FLOOR`). `HOCUS_MIN_CLIENT_SCHEMA` can only raise it.
- `textColor` and `fontSize` are allowed at ingress.

**Deploy** (spec §3.1 steps 3–4; only after the N+1 ship gates pass; at low traffic):
1. Pull and `bun install --frozen-lockfile` (no dependency changes). **Do not build yet.**
2. Restart Hocus: `bunx pm2@6.0.14 restart editor-hocus --update-env`. Confirm `[hocus] client schema gate: min=2 (floor 2, env 0)` in its log. Within a minute, confirm a `client_schema` line: `ok` counts release N clients, and `refused` counts any pre-N bundles (0 is fine if none are left).
3. Build: `bun run build`. Add the line from Task 9 Step 5 if old chunks returned 404 during the drill.
4. Restart Next: `bunx pm2@6.0.14 restart editor-next --update-env`.
5. Leave `HOCUS_MIN_CLIENT_SCHEMA` unset. Never roll Hocus back below this release without first rolling back Next and setting `HOCUS_MIN_CLIENT_SCHEMA=2` (runbook).

- [ ] **Step 1: Write the docs and the CHANGELOG entry**

- [ ] **Step 2: Run the full static checks and the unit suite**

Run: `bun audit --audit-level=high && bun run check && bun run lint && bun run typecheck && bun run test && bun run build`
Expected: all exit 0.

- [ ] **Step 3: Run the whole e2e and perf suites against the E2E servers**

Run: `E2E_BASE_URL=http://localhost:3600 E2E_HOCUS_URL=ws://127.0.0.1:1734 CI= bun playwright test --project=chromium --project=perf --retries=1`. This is one invocation, as in CI.
Expected: all pass. This includes PR B's `schema-safety.spec.ts` hostile tests (unknown name refused at ingress; delete-all and paragraph-before-title repaired) and `global-tabs-poison.spec.ts`.

- [ ] **Step 4: Run the production-build PWA project**

Run:
1. With Hocus on 1734 running, run `NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1734 bun run build && PORT=3847 bun run start`.
2. Run `PWA_BASE_URL=http://localhost:3847 CI= bun playwright test --project=pwa`.

Expected: PASS.

- [ ] **Step 5: Map the HoE criteria for C to evidence in the PR description**

Paste each test name and its pass output into the PR description:

- B3 (floor): Task 2, the unit tests and the staging drill.
- B4 (key `color`): PR B's "keeps the attribute key color" test, Task 3 (key unchanged) and the Task 7 snapshot diff.
- N+1 gates:
  - adoption ≥95% over 24 h, held 48 h: from the production log, using the runbook query;
  - refused-client soak: Task 2 (floor only);
  - mixed-version soak: Task 9 Step 4;
  - hostile tests: Step 3 here and Task 7;
  - staging drill: Task 2;
  - Deploy note: Step 1.
- Render fuzz emits no `style`: Task 7.
- Palette contrast unit test: Task 1.
- Tab-to-tab paste keeps tokens, and Docs/Word samples paste plain: Task 8.
- 50k alternating colour runs within budget: Task 10.

- [ ] **Step 6: Commit** (review report, then wait for approval)

`docs: record release N+1 schema rollout in the runbook and changelog`

Then open the PR against `feat/smart-toolbar-rollout-safety`, after review and approval, with the merge gate in its description. Retarget it to `main` before #28 merges.

---

## Self-review

**1. Spec coverage:**
- §3 marks (`textColor`, `fontSize` em steps): Tasks 4, 5, 7.
- Not `TextStyleKit`; concurrent colour + size both survive: Task 7, Yjs test.
- Highlight tokens, key `color` and legacy mapping in the mark: Task 6.
- Server rewrite as cleanup: Task 3.
- Render-time enforcement, no `validate`: Tasks 4–6, plus the Task 7 fuzz.
- Paste rules (drop foreign colour, size and background; keep own `data-*`; `renderHTML` emits `data-*`): Tasks 4–6, plus Task 8 with real samples.
- Schema evolution rule and snapshot: Task 7.
- Inclusive marks and stored marks: Tasks 4 and 5.
- `fontSize` out of headings via commands and paste, not the schema: Task 5.
- Palette and contrast: Task 1.
- §3.1:
  - `SCHEMA_FLOOR = 2` and `max(env, floor)`: Task 2;
  - server-only step 3 before Next: Tasks 9 and 11;
  - builder-check on the build step: Task 9 Step 5;
  - allowlist with the server half: Task 7;
  - "never lower the floor" and rollback: Task 11;
  - N+1 gates: Task 11 Step 5.
- §7 tests: schema round trip and render fuzz (Task 7), Yjs survival (Task 7), old-client gate (Task 2), highlight migration (Task 3), abuse soak (Task 10).
- §8 item 3: all of the above. There is no UI, and the commands are exposed for PR D.

**2. Spec ambiguities decided here** (reviewers confirm):
- **Build order.** Building after the Hocus restart replaces the spec's "build into a separate directory" fallback. Safety no longer depends on what the running Next serves during the build. Task 9 still records the build-step check.
- **Heading rule.** `fontSize` leaves headings through one local-only `appendTransaction` (Task 5), which covers the commands, paste, drop and block-type changes. CSS neutralizes remote content. This is still not a schema restriction.
- **Default highlight.** Highlights default to `yellow` for `toggleHighlight()`, Mod-Shift-H and `==x==`.
- **Server rewrite scope.** The server rewrites only the exact legacy variable. Hex values and `var(--background)` stay as stored and render plain, as in N.
- **Contrast thresholds.** "Every token ≥3:1 on both themes" is tested as text tokens ≥4.5:1 against the page and default text ≥7:1 on each highlight. Both exceed 3:1. A highlight against the page is not a contrast pair.
- **Abuse soak.** It uses a bold-runs baseline and raised caps, because 50k colour runs (~3.6 MB) exceed the production cap.
- **Mixed-version soak.** It is an opt-in spec run before deploy, not a nightly job, because N's bundle is a frozen ref.
- **Old popover.** It keeps writing legacy values. The mark normalizes them, and `isColorHighlightActive` normalizes too.

**3. Type consistency:** these names are used identically in every task that touches them:
- `TextColorToken`, `FontSizeToken`, `textColorTokenFromValue`, `fontSizeTokenFromValue`, `FONT_SIZE_EM`, `DEFAULT_HIGHLIGHT_TOKEN` (Tasks 1, 4–7, 10);
- `SCHEMA_FLOOR`, `effectiveMinClientSchema` (Tasks 2, 11);
- `migrateLegacyMarks` (Task 3);
- `setTextColor`, `unsetTextColor`, `setFontSize`, `unsetFontSize`, `setHighlight` (Tasks 4–8, 10);
- `copySelectionHtml`, `pasteHtml` (Task 8);
- `colourRunsDoc` (Task 10).

The startup log text `client schema gate: min=2 (floor 2, env 0)` is identical in Tasks 2, 9 and 11.

**4. Review Focus:** each of the five lines has its test in the owning task (Tasks 7, 5, 5 + 8, 1 + 4 + 5, 3).

**5. Proportion:** the code blocks are tests and signatures. Bodies are omitted except for the `setFontSize` range walk and the heading rule, which the tests do not fully determine.
