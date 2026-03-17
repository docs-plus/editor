---
date: 2026-03-15
topic: heading-extensions-audit
deepened: 2026-03-18
---

# Heading Extensions Quality Audit & Portability Sweep

## What We're Building

A targeted code-quality sweep of the five custom heading extensions
(HeadingScale, HeadingDrag, HeadingFold, HeadingFilter, TitleDocument) plus
their shared `helpers/` directory. The audit checks naming against
Tiptap/ProseMirror conventions, DRY violations, over-engineering, and
portability blockers — with the goal of making these extensions copy-pasteable
(shadcn-style) into any Tiptap project.

## Enhancement Summary

**Deepened on:** 2026-03-18

The heading extensions were audited at file level. Key findings:

- **2 CRITICAL** portability blockers (`@/` imports, hardcoded storage prefix)
- **4 MEDIUM** issues (URL params, fold coupling, `data-toc-id`, CSS class)
- **Architecture and cleanup are solid** — plugin views have proper `destroy()`,
  decorations are efficient, shared helpers are not duplicated

## Why This Approach

The extensions are already working and well-structured. A full architecture
review would risk YAGNI — surfacing issues that don't need fixing. A targeted
sweep catches the high-value items: naming inconsistencies, duplicated logic,
unnecessary abstractions, and hard-coded app dependencies that block
portability.

## Key Decisions

- **Audit scope:** Targeted sweep — naming, DRY, over-engineering, portability
  blockers
- **Extraction form:** Copy-pasteable directory (shadcn-style), not npm package
- **HeadingFilter ↔ HeadingFold coupling:** Make optional — filter works
  standalone, folding is a bonus when HeadingFold is present
- **Persistence:** Keep localStorage/URL as defaults — they're sensible for
  most apps
- **CSS:** Keep SCSS files as-is, document required CSS custom properties
- **Naming standard:** Tiptap conventions for extensions, ProseMirror
  conventions for plugins/helpers

## Audit Results

### 1. Naming & Conventions — PASS (1 LOW issue)

| Check | Status | Notes |
|-------|--------|-------|
| Extension names match Tiptap style | ✓ | `headingFold`, `headingDrag`, etc. |
| Plugin keys use `PluginKey` instances | ✓ | No string literals |
| Helper function names are camelCase | ✓ | |
| File names are kebab-case | ✓ | |
| CSS class consistency | **LOW** | `has-drag-handle` breaks `heading-{feature}-{element}` pattern; consider `heading-drag-has-handle` |
| TitleDocument inline PluginKeys | INFO | `new PluginKey("enforceH1Title")` inline; acceptable for internal use |

### 2. DRY Violations — PASS (0 issues)

| Check | Status | Notes |
|-------|--------|-------|
| `canMapDecorations` shared | ✓ | Used by all 4 plugins correctly |
| `computeSection` not duplicated | ✓ | Shared between fold/drag |
| `computeOwnRange` vs `computeSection` | ✓ | Different semantics (own range vs full section) |
| No repeated heading traversal | ✓ | Each plugin iterates differently per its needs |
| Decoration patterns consistent | ✓ | |

### 3. Over-Engineering / KISS — PASS (0 issues)

| Check | Status | Notes |
|-------|--------|-------|
| No unnecessary abstractions | ✓ | |
| Plugin state shapes minimal | ✓ | No unused fields |
| Helper functions not over-generalized | ✓ | |
| No premature configuration | ✓ | |

### 4. Portability Blockers — 2 CRITICAL, 3 MEDIUM

| Finding | Severity | Location | Fix |
|---------|----------|----------|-----|
| `@/` imports in all heading-node files | **CRITICAL** | All TS files | Convert to relative imports |
| Hardcoded `tinydocy-folds-` prefix | **CRITICAL** | `helpers/fold-storage.ts:1` | Add `storagePrefix?: string` to `HeadingFoldOptions` |
| Hardcoded URL params `filter`, `mode` | **MEDIUM** | `helpers/filter-url.ts:1-3` | Add to `HeadingFilterOptions` |
| HeadingFilter → HeadingFold coupling | **MEDIUM** | `heading-filter-plugin.ts:269-297` | Document optional dependency |
| `data-toc-id` attribute required | **MEDIUM** | Multiple files | Document as required setup |

### 5. ProseMirror Best Practices — PASS

| Check | Status | Notes |
|-------|--------|-------|
| HeadingDrag `destroy` | ✓ | `cleanupDrag`, `cancelAnimationFrame`, `unmountParent`, event listeners, `wrapperEl.remove` |
| HeadingFold `destroy` | ✓ | Clears `pendingTimers` |
| HeadingFilter `destroy` | ✓ | Resets closure vars |
| HeadingScale | ✓ | No plugin view, no cleanup needed |
| Decoration mapping efficient | ✓ | `canMapDecorations` before `map()` |
| `apply` handles doc changes | ✓ | `tr.docChanged` checked |
| Plugin metadata via PluginKey | ✓ | Not string keys |

### Required CSS Custom Properties

Extensions require these `--tt-*` tokens from the consuming app:

| Variable | Used by | Fallback |
|----------|---------|----------|
| `--tt-fold-duration` | heading-fold.scss | 350ms |
| `--tt-transition-easing-cubic` | heading-fold.scss | — |
| `--tt-border-color-tint` | heading-fold.scss | — |
| `--tt-radius-xs` | heading-drag.scss | 4px |
| `--tt-gray-light-a-100` | heading-drag.scss | — |
| `--tt-gray-dark-a-200` | heading-drag.scss | — |
| `--tt-brand-color-400` | heading-drag.scss | `rgba(122,82,255,1)` |
| `--tt-bg-color` | heading-drag.scss | `#fff` / `#0e0e11` (Phase 2 replaces with `--background`) |
| `--tt-border-color` | heading-drag.scss | `rgba(37,39,45,0.1)` (Phase 2 replaces with `--border`) |
| `--tt-shadow-elevated-md` | heading-drag.scss | — |
| `--tt-gray-light-a-700` | heading-drag.scss | `#333` |
| `--tt-gray-dark-a-800` | heading-drag.scss | `#ddd` |

### Required Peer Dependencies

| Extension | Dependencies |
|-----------|-------------|
| All | `@tiptap/core`, `@tiptap/pm` |
| HeadingDrag | + `@floating-ui/dom` |
| HeadingFold | Optional `documentId`, `onFoldChange` |
| HeadingFilter | Optional link to HeadingFold for fold-on-filter |
| TitleDocument | Document schema `heading block*` |
| All | `data-toc-id` on headings (e.g. via `@tiptap/extension-table-of-contents`) |

## Audit Checklist (updated with results)

### 1. Naming & Conventions (Tiptap + ProseMirror)

- [x] Extension names match `@tiptap/extension-*` patterns
- [x] Plugin keys follow ProseMirror conventions (PluginKey instances)
- [x] Helper function names are clear and follow camelCase
- [ ] CSS class names follow `heading-{feature}-{element}` consistently — `has-drag-handle` outlier
- [x] No typos in exports, plugin keys, CSS classes, or comments
- [x] File names follow kebab-case consistently

### 2. DRY Violations

- [x] `canMapDecorations` shared correctly (used by all 4 plugins)
- [x] `computeSection` not duplicated between fold/drag/filter
- [x] No repeated heading traversal logic across plugins
- [x] Decoration patterns consistent across plugins

### 3. Over-Engineering / KISS

- [x] No unnecessary abstractions or wrapper layers
- [x] Plugin state shapes are minimal (no unused fields)
- [x] Helper functions aren't over-generalized beyond actual usage
- [x] No premature configuration options that nobody uses

### 4. Portability Blockers

- [ ] HeadingFilter works without HeadingFold — works but dispatches ignored meta
- [ ] No hard-coded `tinydocy-*` localStorage keys — `tinydocy-folds-` hardcoded
- [ ] No hard-coded URL param names — `filter`, `mode` hardcoded
- [ ] CSS custom properties documented — documented above
- [ ] No imports from app-specific modules — `@/` used throughout
- [x] Each extension's required peer dependencies documented

## Next Steps

→ Portability fixes (relative imports, configurable prefixes) are deferred to
a separate portability pass. Not part of the main quality audit scope.
