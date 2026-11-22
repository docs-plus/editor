# TinyDocy glossary

Fixed terms for every interface language. A term here is translated **one
way** in a language, everywhere it appears. The English column and its
rules come from the desktop UX spec §9.2 (vocabulary) and the languages
design §3.5 and §7 (copy rules). Each language's column is filled by its
L8.x PR and approved by that language's named native reviewer (D26). Agent
drafts (`bun run i18n:draft`, L1a) read this file.

Seeded by L0 (2026-11-22) with English only. Empty cells mean "not decided
yet"; a draft must not invent one.

## Rules for every message

- Each message is a whole sentence. Never build a sentence from fragments.
- Don't rely on English word order, plural shape or casing.
- Shortcuts, brand names and file paths are never in translatable text.
  They are placeholders (`{shortcut}`, `{app}`, `{path}`).
- `{title}`, `{folder}` and `{name}` are text a person wrote, in any
  language and direction. TinyDocy isolates them; translators choose the
  quotation marks around them (“ ” in English, « » in Persian and Arabic).
- Plurals list every CLDR category the language needs (`bun run i18n:check`
  fails otherwise). Arabic needs six, Hebrew three, Persian two.
- The interface never addresses or describes a person by gender. Write
  messages that name a person (“{name} is editing”) in a neutral form.
- Key names (Shift, Ctrl, Alt, Enter, Esc, Tab) stay in English, as most
  keyboards print them. A reviewer may ask for an exception per language.
- Digits and dates come from `Intl` for the locale. Never write digits by
  hand in a message.
- `core.*` messages (the editor's own chrome) are plain text with `{name}`
  values only: no ICU apostrophe escapes (`''`, `'{`, `'}`). Write a
  typographic apostrophe (’) or a single plain one (“l’élément”, “Don't”).
- Search keywords (`action.*.keywords`) are separated by commas; the
  language's own comma (، 、 ，) works too.
- Put each translation in the file of its key's namespace
  (`library.trash.empty` goes in `library.json`); only that file is loaded
  where the message shows.

## Never translated

| Term | Why |
|---|---|
| TinyDocy, docs.plus | Brand names (placeholders in messages) |
| Markdown, HTML, Mermaid, JSON | Format and tool names |
| Code-language names (JavaScript, Python, …) | Shown as written in code |
| Shift, Ctrl, Alt, Option, Command, Enter, Esc, Tab, F1–F12 | Printed on keyboards (rule above) |

## Fixed terms

| English | Never in English | Meaning and notes | fa | ar | he |
|---|---|---|---|---|---|
| document | file, page, note, pad, doc | What a person writes in TinyDocy. “File” is only for things on disk. | | | |
| file | — | Only things on disk: import, export, backup files, Show in Finder | | | |
| Library | vault, workspace, database | The tree of folders and documents on this computer | | | |
| folder | collection, notebook | | | | |
| Local | offline, private, unsynced | A state (“only on this computer”), not a place | | | |
| Live | cloud, synced, online | A shared document (Live release) | | | |
| Trash / Move to Trash | Recycle Bin, Bin, Delete | The app's own Trash, the same word on every OS | | | |
| Delete Forever / Empty Trash | Purge, Remove permanently | The only uses of “delete” | | | |
| Close (a tab) | — | Never deletes on desktop | | | |
| backup (noun), back up (verb) | export (for backups) | Readable files in TinyDocy Backups | | | |
| daily snapshot | version, history, restore point | The 7 internal daily copies | | | |
| version | — | Reserved for the Live release's restore points | | | |
| Restore | Revert, Roll back, Recover | Always with an object: from Trash, from a daily snapshot, from backup | | | |
| Import / Export | Open (for .md), Save As | “Open” means opening a document from the Library | | | |
| Playground | demo, sample doc | A sample document on this computer | | | |
| Settings | Preferences, Options | Every OS | | | |
| Quick Open | Search, Go to | The surface; its field says “Search by title” | | | |
| Show in Finder / File Explorer / Files | Reveal, Open folder | Per-OS label | | | |

## Proposed terms (L0 seed; the owner confirms in review)

These come from today's interface copy, not from UX §9.2.

| English | Avoid | Meaning and notes | fa | ar | he |
|---|---|---|---|---|---|
| outline | table of contents | The heading list beside the page (“Toggle outline”) | | | |
| heading | — | A section heading in a document | | | |
| title | — | The document's first heading, which names it | | | |
| toolbar | — | The row of formatting controls | | | |
| comment | — | Comments design | | | |
| Share | — | Live release | | | |
