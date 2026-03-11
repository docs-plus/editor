# TinyDocy

A collaborative document editor built with Next.js, Tiptap, and Yjs.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.10

## Getting Started

```bash
# Install dependencies
bun install

# Start the development server
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

| Script             | Description                                |
| ------------------ | ------------------------------------------ |
| `bun dev`          | Start the development server               |
| `bun run build`    | Build for production                       |
| `bun start`        | Start the production server                |
| `bun run lint`     | Run ESLint (Next.js rules)                 |
| `bun run format`   | Format all files with Biome                |
| `bun run check`    | Run Biome lint + format check              |
| `bun run check:fix`| Run Biome lint + format with auto-fix      |

## Project Structure

```
app/              Next.js App Router (pages, layout, global styles)
components/       React components
  tiptap-ui/      Tiptap editor UI components
  tiptap-node/    Custom Tiptap node extensions
  tiptap-templates/ Editor templates
  toc-sidebar/    Table of contents sidebar
hooks/            Custom React hooks
```

## Tech Stack

- **Framework** — Next.js 16 (App Router)
- **Editor** — Tiptap 3 + Yjs (real-time collaboration)
- **Styling** — Tailwind CSS 4, Sass
- **UI** — Radix UI primitives
- **Language** — TypeScript 5.9

## Conventions

### Commits

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Commit messages are enforced via commitlint.

```
feat: add collaborative cursor support
fix: resolve sidebar scroll issue
chore: update dependencies
docs: improve README
refactor: extract editor toolbar
```

### Code Quality

- **Formatting** — [Biome](https://biomejs.dev/) (auto-runs on commit via lint-staged)
- **Linting** — Biome (recommended rules) + ESLint (Next.js-specific rules)
- **Editor** — Settings defined in `.editorconfig`

## License

Private
