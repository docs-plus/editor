---
date: 2026-03-12
topic: shadcn-migration
---

# shadcn/ui Migration

## What We're Building

A full migration from custom tiptap-ui-primitive components and SCSS-based styling to shadcn/ui, replacing the entire UI layer with shadcn's component library. The goal is to reduce ~2,500 lines of custom primitive code, adopt a professional design system, and accelerate future UI development. Editor node styles (heading, paragraph, code-block, etc.) remain as SCSS since they're tightly coupled to ProseMirror DOM structure.

## Why This Approach

The project currently maintains 10 custom UI primitives (Button, Card, Popover, Tooltip, Separator, Spacer, Input, Badge, DropdownMenu, Toolbar) with extensive SCSS styling and `--tt-*` design tokens. shadcn provides production-quality equivalents for 8 of these, built on the same Radix/Base UI foundation already partially used. Adopting shadcn eliminates maintenance burden, provides consistent design, and enables rapid UI development using the shadcn ecosystem.

Layer-by-layer migration was chosen over big-bang or component-by-component because it balances risk with speed — each layer is independently verifiable while the total number of passes stays manageable.

## Key Decisions

- **Preset**: Use `bunx --bun shadcn@latest init --preset a18OYK --base base --template next` — custom design preset with Base UI primitives
- **Base UI over Radix**: Clean break from current `@radix-ui` dependencies. shadcn API is identical regardless of underlying primitives.
- **Token strategy**: Replace all `--tt-*` tokens with shadcn's CSS variable system entirely. No mapping or bridging layer.
- **Editor content styling**: Full shadcn typography — editor content area drops Google Docs appearance and adopts shadcn's design language.
- **Primitives fate**: Delete `tiptap-ui-primitive/` entirely. Build any custom components (Toolbar, Spacer equivalents) on top of shadcn patterns.
- **SCSS scope**: Keep SCSS only for ProseMirror editor node styling (heading-node, paragraph-node, code-block-node, image-node, horizontal-rule, list-node, blockquote-node). All UI chrome moves to Tailwind utility classes via shadcn.
- **Migration strategy**: Layer-by-layer — 4 sequential passes, each independently committable.

## Execution Layers

### Layer 1: Install & Configure

- Run shadcn init with preset command
- Review generated theme/config files
- Verify Tailwind v4 + shadcn CSS variable integration
- Set up shadcn component output directory at `components/ui/` (shadcn default)
- Replace `lib/cn.ts` (simple class filter) with shadcn's `cn()` implementation using `clsx` + `tailwind-merge` — the simple version can't merge conflicting Tailwind utilities
- Remove or update `styles/_variables.scss` — keep only editor-specific variables

### Layer 2: Add shadcn Components

- Add shadcn equivalents: Button, Card, Popover, Tooltip, Separator, Input, Badge, DropdownMenu
- Build Toolbar replacement on shadcn patterns (keyboard navigation, grouping)
- Build Spacer equivalent (simple flex utility)
- Verify each component renders correctly in isolation

### Layer 3: Rewrite Consumers

- Update all tiptap-ui/ components (heading-button, mark-button, link-popover, etc.) to import from shadcn instead of tiptap-ui-primitive
- Update document-editor.tsx toolbar composition
- Update tab-bar, toc-sidebar, playground-toolbar, theme-toggle
- Convert remaining UI SCSS to Tailwind utility classes
- Update `cn()` usage — shadcn ships its own `cn()` via `clsx` + `tailwind-merge`

### Layer 4: Cleanup

- Delete `tiptap-ui-primitive/` directory entirely
- Delete UI-related SCSS files (button.scss, button-colors.scss, badge.scss, badge-colors.scss, card.scss, etc.)
- Remove `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`, `@floating-ui/react` dependencies
- Update `styles/_variables.scss` — remove all `--tt-*` UI tokens, keep only editor node tokens
- Keep `sass` — still needed for editor node SCSS files
- Update AGENTS.md and repo-conventions with new component conventions

## Open Questions

_None — all key decisions have been resolved during brainstorming._

## Next Steps

→ `/workflows:plan` for implementation details per layer
