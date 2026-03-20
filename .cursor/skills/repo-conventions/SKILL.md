---
name: repo-conventions
description: Enforce TinyDocy repository conventions including Bun-only commands, Biome formatting, ESLint rules, TypeScript standards, naming conventions, Conventional Commits, and code quality standards. Use when writing code, running commands, installing dependencies, creating scripts, modifying configuration, or making commits in this repository.
---

# Repository Conventions

All tooling decisions below are final. Any agent working in this repo must follow them.

## Runtime & Package Manager

**Bun only. No exceptions.**

| Do                              | Do NOT                          |
|---------------------------------|---------------------------------|
| `bun install`                   | `npm install`                   |
| `bun add <pkg>`                 | `npm install <pkg>`             |
| `bun add -d <pkg>`              | `npm install --save-dev <pkg>`  |
| `bun run <script>`              | `npm run <script>`              |
| `bunx <tool>`                   | `npx <tool>`                    |
| `bun dev`                       | `npm run dev`                   |
| `bun test`                      | `npm test`                      |

- The lockfile is `bun.lock` — never generate or reference `package-lock.json` or `yarn.lock`
- Bun version is pinned in `.tool-versions` and `package.json` (`packageManager` + `engines`)
- When suggesting commands in comments, docs, or READMEs, always use `bun`/`bunx`

## TypeScript

TypeScript `strict` mode is enabled. This is non-negotiable.

### Type safety rules

| Rule | Policy |
|------|--------|
| `any` | **Avoid.** Biome warns on `noExplicitAny`. Use `unknown` and narrow, or define a proper type. Existing `any` is tech debt — do not introduce new ones. |
| Non-null assertions (`!`) | **Avoid.** Biome warns on `noNonNullAssertion`. Use optional chaining, nullish coalescing, or proper null checks instead. |
| Type-only imports | **Required.** Use `import type { Foo }` for types. Biome warns on `useImportType`. |
| Unused imports | **Remove them.** Biome warns on `noUnusedImports`. |
| `as` type assertions | Prefer type guards or generics. Only use `as` when you can prove the assertion is safe. |

### Exports

Use **named exports only**. Do not use `export default` except where required by the framework (Next.js pages/layouts, config files). Named exports are tree-shakeable and provide explicit imports.

### Path aliases

Use `@/*` for imports from the project root (configured in `tsconfig.json`):

```typescript
import { useSyncedTabs } from "@/hooks/use-synced-tabs";
```

## Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Directories | kebab-case | `toc-sidebar/`, `tiptap-ui/` |
| Files (components) | kebab-case | `tab-bar.tsx`, `document-editor.tsx` |
| Files (hooks) | kebab-case, `use-` prefix | `use-synced-tabs.ts`, `use-document-storage.ts` |
| Files (utilities) | kebab-case | `editor-utils.ts`, `cn.ts` |
| React components | PascalCase export, title-case acronyms | `export function TocSidebar()` |
| Hooks | camelCase, `use` prefix | `export function useSyncedTabs()` |
| Constants | UPPER_SNAKE_CASE | `const MAX_RETRIES = 3` |
| Types/Interfaces | PascalCase | `interface EditorProps` |
| Boolean props/vars | `is`/`has`/`should` prefix | `isActive`, `hasUnsavedChanges` |

## Architecture & Abstraction Layers

The project has a clear layer hierarchy. Each layer may only import from layers at the same level or below — never upward.

```
┌─────────────────────────────────────────┐
│  app/              Pages & layout       │  ← top: composes everything
├─────────────────────────────────────────┤
│  components/       App-level components │  ← tab-bar, toc-sidebar
├─────────────────────────────────────────┤
│  document-editor/ Integrated editor      │  ← document-editor
├─────────────────────────────────────────┤
│  tiptap-ui/        Toolbar controls     │  ← buttons, popovers, dropdowns
├─────────────────────────────────────────┤
│  tiptap-ui-primitive/ Base UI blocks    │  ← Button, Card, Tooltip, Popover
├─────────────────────────────────────────┤
│  tiptap-node/      Node extensions      │  ← extensions + node-level styles
├─────────────────────────────────────────┤
│  hooks/            Shared React hooks   │  ← no UI, just logic
├─────────────────────────────────────────┤
│  lib/              Pure utilities       │  ← cn, shortcuts, editor-utils, url-utils, icons
├─────────────────────────────────────────┤
│  styles/           Design tokens        │  ← variables, keyframes
└─────────────────────────────────────────┘
```

### Import rules

| From | Can import |
|------|-----------|
| `app/` | anything |
| `components/` (root) | hooks, lib, styles, tiptap-ui-primitive |
| `document-editor/` | tiptap-ui, tiptap-node, extensions, hooks, lib, styles |
| `tiptap-ui/` | tiptap-ui-primitive, hooks, lib, styles |
| `tiptap-ui-primitive/` | hooks, lib, styles |
| `tiptap-node/` | lib, styles |
| `hooks/` | lib |
| `lib/` | nothing (pure utilities) |
| `styles/` | nothing (design tokens) |

### Where new code goes

| You're building... | Put it in... |
|---------------------|-------------|
| A new page or route | `app/` |
| An app-level component (sidebar, tab bar) | `components/` in its own folder |
| A new editor toolbar control | `tiptap-ui/<name>/` with hook + component + index |
| A generic UI primitive (button variant, input) | `tiptap-ui-primitive/<name>/` |
| A new Tiptap node style/nodeview asset | `tiptap-node/<name>/` |
| A new standalone Tiptap extension/plugin | `extensions/<name>/` |
| A shared React hook | `hooks/use-<name>.ts` |
| A pure utility function | `lib/` |
| A shared SCSS variable or animation | `styles/` |

### Anti-overengineering rules

These are hard rules, not suggestions:

1. **No premature abstraction.** Do not extract a shared component, hook, or utility until there are 3+ concrete use cases. Duplication is cheaper than the wrong abstraction.
2. **No new layers.** Do not create new directories like `services/`, `providers/`, `contexts/`, `stores/`, or `models/` at the project root. If it's a hook, it goes in `hooks/`. If it's a utility, it goes in `lib/`. If it's a type, it lives next to the code that uses it. Exception: `types/` exists for TypeScript declaration files (e.g., `scss.d.ts`) — not for application types.
3. **No barrel files at directory roots.** Do not create `components/index.ts` or `hooks/index.ts`. Barrel files are only for individual component folders (e.g. `tiptap-ui/mark-button/index.tsx`).
4. **No dedicated types files.** Types and interfaces live in the file that defines or primarily uses them. `Tab` lives in `use-synced-tabs.ts`, not in `types/tab.ts`.
5. **No wrapper components for the sake of wrapping.** If a component just passes props through to another component, delete it. Direct imports are better than indirection.
6. **No "utils" dumping ground.** Split utilities by domain (e.g. `lib/cn.ts`, `lib/shortcuts.ts`, `lib/editor-utils.ts`, `lib/url-utils.ts`), not by creating a `utils/` folder.
7. **Co-locate everything.** Styles, hooks, tests, and types for a component live in its folder, not in separate top-level directories.

### Tiptap code ownership

All code in `document-editor/`, `tiptap-ui/`, `tiptap-node/`, and `extensions/` is fully owned — refactor, rename, and restructure freely. There is no upstream scaffold boundary.

## Code Formatting & Linting

### Biome (primary)

Biome handles **formatting** and **linting**. Configuration lives in `biome.json`.

```bash
bun run format       # format all files
bun run format:check # check formatting without writing
bun run check        # lint + format check
bun run check:fix    # lint + format with auto-fix
```

- Biome runs automatically on staged files via lint-staged (pre-commit hook)
- 2-space indentation, double quotes, trailing commas, semicolons
- Import sorting is handled by Biome's assist — do not add other import sorting tools
- Line width: 80 characters

### ESLint (Next.js rules only)

ESLint is scoped to **Next.js-specific rules only** (`eslint-config-next`). All stylistic and formatting rules are disabled — Biome owns those.

```bash
bun run lint         # run ESLint
```

Do not add ESLint plugins for formatting, import sorting, or stylistic concerns. Those belong in `biome.json`.

## Commits

All commits follow [Conventional Commits](https://www.conventionalcommits.org/). Commitlint enforces this via the `commit-msg` hook.

```
<type>(<scope>): <imperative summary>
```

Allowed types: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `build`, `ci`, `chore`, `docs`, `revert`

See the `commit-review` skill for full commit message guidelines.

## Git Hooks

Husky manages git hooks:

- **pre-commit** — runs `bunx lint-staged` (Biome check on staged files)
- **commit-msg** — runs `bunx commitlint` (enforces conventional commits)

Do not bypass hooks with `--no-verify` unless explicitly asked by the user.

## Editor Config

`.editorconfig` enforces:

- 2-space indentation
- LF line endings
- UTF-8 charset
- Trailing whitespace trimmed (except in `.md` files)
- Final newline inserted

## Adding Dependencies

```bash
bun add <package>           # production dependency
bun add -d <package>        # dev dependency
bun remove <package>        # remove a dependency
```

Never pin exact versions manually — use the `^` range that Bun sets by default. Let the lockfile handle determinism.

## Testing

**Framework:** Vitest (when tests are added).

New features and bug fixes should include tests. Test files live next to the code they test:

```
components/tab-bar.tsx
components/tab-bar.test.tsx
```

## Project Scripts

| Script              | Purpose                           |
|---------------------|-----------------------------------|
| `bun dev`           | Start development server          |
| `bun run build`     | Production build                  |
| `bun start`         | Start production server           |
| `bun run lint`      | ESLint (Next.js rules)            |
| `bun run format`    | Biome format all files            |
| `bun run check`     | Biome lint + format check         |
| `bun run check:fix` | Biome lint + format with auto-fix |
