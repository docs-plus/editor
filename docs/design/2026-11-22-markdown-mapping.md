# Markdown export and import: node and mark mapping (P2.8a)

**Status:** implemented in `lib/headless/` (P2.8a, the part of plan P2.8 that needs no Electron shell).
**Specs:** [plan](../superpowers/specs/2026-11-15-desktop-local-first-design.md) §8.4, row P2.8; [onboarding, templates and import](../superpowers/specs/2026-11-16-onboarding-templates-import-design.md) §4.2, §4.6, §4.7; [web library](../superpowers/specs/2026-11-16-web-library-design.md) §6.1; [details](../superpowers/specs/2026-11-15-desktop-documents-and-editor-details.md) §3, E7.

This page explains how a TinyDocy document becomes Markdown and comes back. The round-trip tests in `tests/unit/lib/headless/markdown-round-trip.test.ts` enforce it. `normalizeForMarkdown` there applies every loss listed below, and the import of an export must equal it exactly.

## Modules

| Module | What it does |
|---|---|
| `lib/headless/schema-extensions.ts` | The editor's schema extensions with no view, DOM, React or collaboration plugins. A test compares the result with the editor's schema: names, content, groups, attribute names and defaults, and mark order. |
| `lib/headless/headless-schema.ts` | `getHeadlessSchema()`, `yDocToProseMirror` / `yDocToJSON` (read-only; unknown names throw `SchemaMismatchError`), and `jsonToYDoc`. These work on the editor's `default` fragment. |
| `lib/headless/markdown.ts` | One `@tiptap/markdown` `MarkdownManager` over those extensions, with its own `marked` instance. |
| `lib/headless/front-matter.ts` | Writes the front matter, and reads it with a restricted reader: string scalars and flat lists only, 64 KiB cap. |
| `lib/headless/markdown-export.ts` | `exportMarkdown(ydoc, { tags, createdAt, modifiedAt })` and `documentToMarkdown(node, meta)`. |
| `lib/headless/markdown-import.ts` | `importMarkdown(text, { fileName })` returns `{ title, tags, createdAt, modifiedAt, doc, droppedProperties, droppedTags }`. |
| `lib/filenames.ts` | `cleanFileStem`, `fileName`, `uniqueName` / `nameKey`, `documentPath`. |

The module runs in Bun, in a `worker_thread` and in a browser bundle. `headless-runtime.test.ts` checks the worker with no DOM and the browser build. `import-boundaries.test.ts` checks its static graph: no `components/`, React, Hocuspocus, DOMPurify, lowlight or Mermaid. Nothing in the web app imports it yet.

## File layout

```markdown
---
title: "Q4 plan"
tags:
  - "planning"
created: 2026-11-01T10:00:00.000Z
modified: 2026-11-20T12:30:00.000Z
---

# Q4 plan

Body…
```

- **Front matter fields.** `title`, `tags` (always written; `[]` when empty), and `created` and `modified` (ISO 8601 UTC, left out when unknown). Strings are JSON-quoted. A JSON string is a valid YAML double-quoted scalar once DEL, C1 and BOM are escaped too, so no title can break out of its line.
- **The title appears twice:** in the front matter, and as the first heading of the body. That way the file reads well in any viewer. On import, a leading heading equal to the front matter title *is* the title, so it is not repeated.
- **Only the document fragment and the metadata you pass are exported.** Comments, share secrets and other shared types in the Y.Doc never reach the file (tested).

## Nodes

| Node | Markdown | Comes back as | Lost |
|---|---|---|---|
| `doc` | Blocks separated by a blank line | Same | — |
| `heading` (title) | `# Title`, plus front matter `title` | Title heading | `id`, `data-toc-id` (regenerated), `textAlign` |
| `heading` 1–6 | `#`–`######`; a trailing ` #` is escaped | Same level | `id`, `data-toc-id`, `textAlign`. An **empty** heading below the title comes back as an empty paragraph. |
| `paragraph` | Text. Line starts that Markdown would read as block syntax (`# `, `- `, `+ `, `1. `, `1) `, `>`, `---`, `===`, `* * *`) are backslash-escaped. Leading spaces and tabs become `&#32;` / `&#9;`. | Same text | `textAlign` |
| empty `paragraph` | Blank lines; `&nbsp;` from the second one in a run (Tiptap's convention) | Empty paragraph | — |
| `hardBreak` | Two trailing spaces and a newline | Same | — |
| `blockquote` | `> ` | Same | — |
| `bulletList` / `listItem` | `- `, nested by indentation | Same | — |
| `orderedList` | `3. ` (keeps `start`) | Same | `type` |
| `taskList` / `taskItem` | `- [ ]` / `- [x]`, nested | Same, checked state kept | — |
| `codeBlock` | A fence one backtick longer than any backtick run inside (at least ```` ``` ````), with the language | Same | An unsafe language (not `^[A-Za-z0-9_+#.-]{1,40}$`) is dropped on export, as in the editor. |
| `codeBlock` with language `mermaid` (Mermaid diagrams) | ```` ```mermaid ```` fence holding the source | A Mermaid block | — (other viewers show the source; GitHub renders it) |
| `horizontalRule` | `---` | Same | — |
| `table` / `tableRow` / `tableHeader` / `tableCell` | GFM table; `\|` escaped in cells | Same | **Merged cells are unmerged:** the text stays in the first cell, and the cells it covered come back empty. **A cell with several blocks** becomes one paragraph with line breaks (`<br>`); a list in a cell becomes `- ` text. **A table without a header row** gets an empty header row. `align` and `colwidth` are lost. |
| `image` | `![alt](src "caption"){width=… height=… float=… display=… clear=…}` (the media kit's form) | Same | Hover `title`, `margin`. `asset:` sources are kept as they are; the image store's P2.8+ step rewrites them to an `<name>-images/` folder. |
| `youtube`, `vimeo`, `loom`, `soundcloud`, `spotify`, `x`, `video`, `audio` | `![youtube](src "caption"){…}`: the media kit's image syntax, with the node name as the alt text | The same embed | Embed options (`start`, `autoplay`, `controls`…) and `margin`. **Other viewers show a broken image** with the node name. This form was kept on purpose: it is what the editor's own Markdown serializer (Copy as Markdown) writes, and it is the only form that comes back as an embed. |
| `imageUpload` | Nothing (left out) | — | The node: it is a placeholder that only exists while an upload runs. |

## Marks

| Mark | Markdown | Comes back as | Lost |
|---|---|---|---|
| `bold` | `**text**` | Same | — |
| `italic` | `*text*` | Same | — |
| `strike` | `~~text~~` | Same | — |
| `inlineCode` | `` `text` ``, with a longer fence when the text holds a backtick | Same | — |
| `hyperlink` | `[text](href)` | Same | `title`; `href` is percent-encoded (`x y` → `x%20y`) |
| `underline` | `<u>text</u>` | Underline (renderer) / literal text (worker) | — |
| `superscript` | `<sup>text</sup>` | Superscript (renderer) / literal text (worker) | — |
| `subscript` | `<sub>text</sub>` | Subscript (renderer) / literal text (worker) | — |
| `highlight` | `==text==` | Highlight in the **default token (`yellow`)** | The colour, as the onboarding design §4.2 specifies for imports |
| `textColor` | Plain text | Plain text | The mark |
| `fontSize` | Plain text | Plain text | The mark |

**HTML-tag marks.** `@tiptap/markdown` parses raw HTML only where a `DOMParser` exists. In the renderer (and under the tests' happy-dom), `<u>`, `<sup>` and `<sub>` come back as marks. In a worker they stay literal text. That is the split onboarding §4.6 plans: IM1's worker hands raw HTML tokens to the renderer's sanitiser and schema parse. `headless-runtime.test.ts` pins the worker behaviour.

## Literal text that must stay text

Markdown syntax typed as text is escaped so it comes back unchanged (tested): `*x*`, `**x**`, `_x_`, `` `x` ``, `~~x~~`, `==x==`, `[[Wikilink]]`, `[x](notes.md)`, `![x](x.png)`, `<script>`, `&amp;`, `a | b`, backslashes, and the block-syntax line starts listed under `paragraph`.

**One known change:** a bare URL typed as plain text (not a link) comes back as a link, because GFM autolinks `https://…` and `www.…`. The editor already autolinks URLs as they are typed, so plain-text URLs are rare.

## Import rules in P2.8a

`importMarkdown` is the inverse used by the round-trip tests and the first piece of IM1. What it does now:

- **Title:** front matter `title` › a leading H1 › the file name without its extension › empty. A leading heading equal to the title is not repeated.
- **Tags:** front matter `tags`, as a list or a comma string. Each tag is cleaned and loses a leading `#`. Tags are deduplicated case-insensitively, at most 40 characters and 20 per document, and the extras are counted in `droppedTags`.
- **Dates:** `created` › `date`, and `modified` › `updated`, as epoch milliseconds.
- **Other properties:** dropped, and named in `droppedProperties` with the ones the restricted reader refused (anchors, aliases, tags, block scalars, nested maps).
- **Blocks the parser leaves inside a paragraph** (embeds) are lifted out, and the result is checked against the schema.

**Left to IM1:** the link scheme filter (`http`, `https`, `mailto` only), the sanitiser for raw HTML, wikilink and relative-path bookkeeping, footnotes and callouts, Notion id stripping, the images pipeline, and size caps.

## File names

`lib/filenames.ts` implements the P2.8 test row "separators, `..`, reserved names, trailing dots, paths over 240 characters". A title becomes a name like this:

- **Text cleanup.** NFC, and lone surrogates are removed. Control, bidi and zero-width characters become spaces (`cleanText`), and so do `/ \ < > : " | ? *`. Whitespace runs collapse to one space.
- **Edges.** No leading dot or space (so no hidden files and no `..`), and no trailing dot or space.
- **Windows device names.** `CON`, `PRN`, `AUX`, `NUL`, `COM0–9`, `LPT0–9`, `COM¹²³`, `LPT¹²³`, `CONIN$` and `CONOUT$` get a `_`, even before an extension (`nul_.tar.gz`) or a space.
- **Empty result.** `Untitled`.
- **Length.** At most 255 UTF-8 bytes, cut at a grapheme boundary.
- **The full name.** `fileName(title, { extension, shortId })` gives `<stem>-<short id>.<ext>` and cuts only the stem.
- **Collisions.** `uniqueName` adds ` (2)`, ` (3)`… before the extension. It compares names the way macOS and Windows do: ignoring case and Unicode normalisation (`nameKey`). Pass `folder: true` for names without an extension.
- **Paths.** `documentPath(folders, title, options)` cleans each folder name and shortens the longest part until the relative path fits in 240 characters.

A property test runs 1,000 seeded random titles over hostile Unicode ranges through all three functions.

## Follow-ups

- **The live editor's Markdown serializer returns an empty string for a whole document** (checked against `buildDocumentEditorExtensions`). `TitleDocument` replaces StarterKit's `Document`, which carries the Markdown renderer for the root, so `serialize(doc)` finds no renderer. `HeadlessTitleDocument` adds it back for the headless module. The editor needs the same one line (a few bytes in the editor chunk) before D-A7 backups, the web `md` cache or Copy as Markdown use it. It also lacks the escaping above, the code-fence and inline-code fixes, and `<sup>`/`<sub>`.
- **`SafeCodeBlock` should share its language gate** with `HeadlessCodeBlock` once `components/document-editor/` is free. `lib/code-language.ts` imports editor action modules, so the gate is copied for now. The parity and export tests pin both.
- **The editor's extension list could be built from `buildHeadlessSchemaExtensions()`** plus its view-only extensions, so the parity test becomes structural.
