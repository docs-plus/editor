# Brainstorm 14 — Collaboration Caret Identity

- **Status:** Decided
- **Date:** 2026-03-18
- **Scope:** User identity (name + color) for collaboration cursors

## What We're Building

A user identity system for the `CollaborationCaret` extension: each user gets a name and caret color that other collaborators see. Users change their identity via a modal dialog opened from a toolbar button. Identity persists in `localStorage`.

On first visit, a random name (e.g. "Curious Otter") and random preset color are assigned silently — no onboarding prompt. The user opens the dialog whenever they want to change either.

## Why This Approach

- **Toolbar button** next to `ThemeToggle` — matches existing preference-control placement; no layout changes needed
- **Preset color palette** (8–12 curated colors) — keeps cursors visually distinct and avoids clashing/illegible colors; simpler than a full picker
- **Modal dialog** — gives enough room for name input + color grid without cramped popover layout
- **localStorage persistence** (`tinydocy-user`) — follows the established `tinydocy-*` key pattern; survives page reloads
- **Silent random default** — zero friction on first visit; user can customize later

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Trigger lives in `MainToolbarContent` alongside `ThemeToggle` | Consistent with existing preference controls |
| 2 | Preset palette of 8–12 curated colors, no free picker | Visual consistency, simplicity, KISS |
| 3 | Modal dialog (not popover) for editing | Enough space for name field + color grid |
| 4 | Persist both name and color in `tinydocy-user` localStorage key | Standard project pattern, survives sessions |
| 5 | Random name + color on first visit, no prompt | Zero friction; user opts in to customize |
| 6 | Call `editor.commands.updateUser({ name, color })` in a `useEffect` after editor is ready, and on dialog save | Syncs identity to Yjs awareness; cannot be set in extension config because `useEditor` creates the editor before mount |
| 7 | Use existing shadcn/ui `Dialog` component (add if missing) | Consistent with the component library |
| 8 | Toolbar trigger shows a small colored circle (user's caret color) | Visual indicator of current identity |

## Implementation Sketch

### Data Flow

```
localStorage("tinydocy-user")
  → { name: string, color: string }
  → useEffect (editor ready) → editor.commands.updateUser(user)
  → dialog save → saveUserIdentity() + editor.commands.updateUser(user)
```

### Components

1. **`UserIdentityDialog`** — modal with name `<input>`, color grid, save/cancel
2. **Toolbar trigger** — colored circle button in `MainToolbarContent`, opens dialog
3. **`lib/user-identity.ts`** — `getUserIdentity()` / `saveUserIdentity()` helpers; generates random defaults on first call

### Color Palette (draft)

8 visually distinct, accessible-on-white colors:

```
#E57373  red
#F06292  pink
#BA68C8  purple
#64B5F6  blue
#4DB6AC  teal
#81C784  green
#FFB74D  orange
#A1887F  brown
```

### Random Name Generator

Animal-adjective combos: "Curious Otter", "Swift Falcon", "Bold Panda", etc. ~20 adjectives × ~20 animals = 400 combinations — enough for local uniqueness.

## Open Questions

None — all decisions resolved.
