# Dynamic Heading Scale

**Date:** 2026-03-09
**Status:** Brainstorm

## What We're Building

A Tiptap extension that dynamically sizes headings based on their **rank within a section** rather than their fixed HTML heading level. Each H1 starts a new section. Within a section, the distinct heading levels are ranked and their font-sizes are interpolated between a max (20pt) and min (12pt), distributed evenly.

**Example:**

| Section content | Distinct levels | Visual sizes |
|---|---|---|
| H1 → H4 → H6 | 3 (H1, H4, H6) | 20pt → 16pt → 12pt |
| H1 → H2 → H6 | 3 (H1, H2, H6) | 20pt → 16pt → 12pt |
| H1 → H2 → H3 → H4 | 4 (H1-H4) | 20pt → 17.3pt → 14.7pt → 12pt |
| H1 (alone) | 1 (H1) | 20pt |

Both first two examples produce identical visual sizing despite using different heading levels.

## Why This Approach

**ProseMirror Decorations with CSS custom properties** was chosen over inline styles or document attribute mutation because:

- Decorations are read-only overlays — they never modify the Yjs-synced document, so collaboration is unaffected
- CSS custom properties (`--hd-size`, `--hd-rank`, `--hd-total`) give SCSS full control over font-size now, and margin/weight/color later, without changing the plugin
- The plugin only rebuilds the `DecorationSet` when `tr.docChanged`, making it efficient
- DevTools shows named variables, making debugging straightforward

## Key Decisions

1. **Title H1 is included** — the enforced title heading is the first section's rank-1 heading
2. **Each H1 starts a new section** — headings between two H1s form one group
3. **Sizing uses distinct levels, not node count** — two H4s in the same section get the same visual size
4. **Sizes are interpolated** — evenly distributed between 20pt (max) and 12pt (min)
5. **Old fixed sizes become fallbacks** — per-level sizes are preserved as `var(--hd-size, Xpt)` fallbacks for nested headings; dynamic sizes override them via decorations on top-level headings
6. **All heading levels (H1-H6) are supported** — the current H5/H6 gap is closed
7. **TOC and toolbar are unaffected** — they use heading levels (semantic), not visual sizes

## Technical Design

### Extension structure

- **Name:** `HeadingScale`
- **Type:** Tiptap `Extension` (not a Node — it decorates, not defines)
- **Location:** `components/tiptap-node/heading-node/heading-scale-extension.ts`

### Plugin algorithm

Uses `state: { init, apply }` with structural fingerprinting for performance:

```
init(config, state):
  fingerprint = computeFingerprint(state.doc)   // e.g. "1,2,4,1,3"
  decoSet = buildDecorations(state.doc)
  return { fingerprint, decoSet }

apply(tr, prev, _oldState, newState):
  if !tr.docChanged:
    return { ...prev, decoSet: prev.decoSet.map(tr.mapping, tr.doc) }
  newFingerprint = computeFingerprint(newState.doc)
  if newFingerprint === prev.fingerprint:
    return { ...prev, decoSet: prev.decoSet.map(tr.mapping, tr.doc) }
  return {
    fingerprint: newFingerprint,
    decoSet: buildDecorations(newState.doc)
  }

buildDecorations(doc):
  1. Scan top-level doc children for heading nodes
  2. Group into sections: each level-1 heading starts a new section
  3. For each section:
     a. Collect distinct heading levels, sort ascending
     b. Assign rank (0-based index in the sorted distinct levels)
     c. Compute: size = MAX - rank * (MAX - MIN) / max(totalRanks - 1, 1)
  4. Create Decoration.node() for each heading with CSS custom properties:
     --hd-size: computed font-size in pt
     --hd-rank: 1-based rank within section
     --hd-total: total distinct ranks in section
  5. Return DecorationSet.create(doc, decorations)

computeFingerprint(doc):
  Collect heading levels from top-level children in order.
  Return as string, e.g. "1,2,4,1,3"
```

### Constants

- `MAX_SIZE = 20` (pt) — matches current H1
- `MIN_SIZE = 12` (pt) — matches current H4

### SCSS changes

Keep per-level fallbacks so nested headings (inside blockquotes, lists) retain fixed sizes when no decoration is applied:

```scss
h1 { font-size: var(--hd-size, 20pt); }
h2 { font-size: var(--hd-size, 16pt); }
h3 { font-size: var(--hd-size, 14pt); }
h4 { font-size: var(--hd-size, 12pt); }
h5 { font-size: var(--hd-size, 11pt); }
h6 { font-size: var(--hd-size, 10pt); }
```

Top-level headings receive `--hd-size` from decorations (overrides fallback). Nested headings without decorations get the fixed fallback.

### Performance

**Typing must not be affected.** The plugin uses the `state: { init, apply }` pattern with structural fingerprinting:

1. `!tr.docChanged` — return `prevDecoSet.map(tr.mapping, tr.doc)`. Zero computation.
2. `tr.docChanged` — compute heading structure fingerprint (array of heading levels in doc order, e.g. `[1,2,4,1,3]`).
3. Fingerprint unchanged — return `prevDecoSet.map(tr.mapping, tr.doc)`. Positions shift via mapping, sizes stay.
4. Fingerprint changed — full rebuild (heading added, removed, or level changed).

**Result:** Typing in paragraphs or within heading text never triggers a decoration rebuild. Only structural heading changes do. DecorationSet mapping is O(m) where m = heading count — microseconds for 50 headings.

### Memory safety

- No closures over mutable external state
- No DOM event listeners or view references
- `DecorationSet` is an immutable value managed by ProseMirror — old sets are garbage collected on replacement
- Fingerprint is a primitive string, replaced on each `apply`
- **Verdict:** Zero leak vectors

## Open Questions

None — all key decisions resolved during brainstorming.
