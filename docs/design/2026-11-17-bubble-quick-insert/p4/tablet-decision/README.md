# Tablet stand-in words: the decision (P4, O8 a)

**Decided 2026-11-22: the owner chose option (b), and it is built.**
- `option-b-built-{768,820}-{paragraph,code}-{light,dark}.jpg` show the shipped row; all fit (0 px overflow).
- `option-b-built-820-more-menu-{light,dark}.jpg` show Redo leading ⋯ on a touch tablet.
- The real rule uses a window query, `(min-width: 768px) and (max-width: 847.98px) and (pointer: coarse)`, so that ⋯, which is portalled outside the row, can match it too. The mock below used a container query instead.
- Measured: app CSS +71 B gz for the step, +138 B gz for the words; the editor chunk group is unchanged at −23 B against `main` 84a9458.
- The mocks below are kept as the record.

These are headless shots of the row on a coarse pointer (`hasTouch`, `isMobile`) in the light theme, with the caret in a paragraph or in a code block. Each file is `<case>-{paragraph,code}.jpg`. The words add 120 px to the row: Format +44, Layout +42, Block +34. The code block is the widest context; a table gives the same width.

Row overflow, measured in the shot script as `scrollWidth − clientWidth`:

| Case | Paragraph | Code block |
|---|---|---|
| current-768 (no words) | 0 | 0 |
| current-820 (no words) | 0 | 0 |
| current-848 (words) | 0 | 0 |
| words at 768, nothing else changed | 2 px | 80 px |
| words at 820, nothing else changed | 0 | 28 px |
| option-b-768 | 0 | 0 |
| option-b-820 | 0 | 0 |
| option-c-820 | 0 | 0 |

## (a) Accept the gate. This is what the branch ships.
- **Files:** `current-768`, `current-820` and `current-848`.
- **What changes:** the words appear only from an 848 px window (an 832 px row). iPad portrait (768–834 px) keeps the bare icons: T ▾, ¶ ▾ and the sliders ▾.
- **Cost:** none beyond today's. The rule lives in `app/globals.css`, outside the editor chunk group, and costs 157 B gz there.

## (b) Retune `$ladder-touch`: one more collapse step on touch tablets
- **Files:** `option-b-768` and `option-b-820`.
- **The mocked retune:**
  - Words are drawn from 768 px, with no 832 px gate.
  - A new touch-only step applies when the row is narrower than 832 px:

    ```css
    @media (min-width: 768px) and (pointer: coarse) {
      @container smart-toolbar (width < 832px) {
        [data-toolbar-group="history"] [data-action-id="history.redo"],
        .st-split[data-list-face] > [data-action-id^="list."] { display: none; }
      }
    }
    ```

- **What moves:**
  - **Redo** (the history group) leaves the row. Its stand-in would be the ⋯ menu, which has no Redo today. ⌘⇧Z and Ctrl+Y still work.
  - **The list split's quick-toggle face** (Bullet list, or the last list type used) leaves the row. List ▾ stays and lists all three types, so applying the last-used list type takes two taps instead of one.
  - Together they free 88 px, which covers the 80 px the code context needs at 768.
- **Visual result:** iPad portrait gets the words in every context, and the row fits at 768 and 820 px.
- **Estimated cost:**
  - The step's CSS is about 60–80 B gz. In `smart-toolbar.scss` it would land in the editor chunk group, which is counted, so it would break the 0 B gate. In `app/globals.css`, next to the words, it costs 0 B to the editor group.
  - Adding `history.redo` to the ⋯ menu's commands is about 10 B in the lazy menu chunk.
  - Dropping the 832 px gate saves a few bytes of CSS.
  - It also needs a contract amendment, because the ladder thresholds are recorded in A5 and Redo becomes a ⋯ item. The roving Tab stop needs a check (hidden items are skipped). The ladder tests need new expectations at 768 and 824 px.

## (c) Drop the ▾ on the worded stand-ins
- **File:** `option-c-820`.
- **The mocked change:** on the three worded stand-ins, `> svg:last-child { display: none }`. The stand-ins shrink to Format 72, Layout 70 and Block 62 px, saving 16 px each.
- **Visual result:** at 820 px the words fit in every context (0 overflow). At 768 px they still don't: about 32 px over in the code context (measured earlier at a 12 px word size). So the gate would move from 848 down to about 800 px, not to 768. Those three controls also lose the ▾ menu cue that every other menu trigger in the row has; `aria-haspopup` still tells assistive technology.
- **Estimated cost:** about 25 B gz of CSS in `app/globals.css`, 0 B to the editor group. Mixing ▾ and no-▾ triggers in one row is a small visual inconsistency.

## Recommendation for the owner's call
- **(b)** is the only option that gives iPad portrait (768 px and up) the words in every context. The price is Redo and the one-tap list toggle below 832 px.
- **(c)** keeps every control but only reaches about 800 px.
- **(a)** keeps everything as it is and shows the words only on wider tablets.
