import type { JSONContent } from "@tiptap/core";

/**
 * Mermaid sources used by the playground. Each one is verified to render
 * through @docs.plus/extension-mermaid (Pele) with the editor's sanitizer.
 * Stored as plain `codeBlock` nodes with `language: "mermaid"`.
 */
export const PLAYGROUND_DIAGRAMS = {
  flowchart: `flowchart LR
  Client[Browser tab] -->|Yjs update| WS{{Hocuspocus}}
  WS --> Guard[Guardrails]
  Guard -->|allowed| Store[(SQLite)]
  Guard -->|throttled| Drop[Reject]
  WS -->|broadcast| Peers[Other editors]`,
  sequence: `sequenceDiagram
  participant A as Alice
  participant S as Hocuspocus
  participant B as Bob
  A->>S: Yjs update (insert heading)
  S->>S: Persist to SQLite
  S-->>B: Broadcast update
  B->>S: Awareness (cursor)
  S-->>A: Awareness (cursor)`,
  state: `stateDiagram-v2
  [*] --> Connecting
  Connecting --> Synced: handshake
  Synced --> Offline: socket closed
  Offline --> Connecting: retry
  Synced --> [*]: tab closed`,
  entityRelationship: `erDiagram
  DOCUMENT ||--o{ HEADING : contains
  HEADING ||--o{ SECTION : starts
  DOCUMENT ||--|| ACTIVITY : tracks`,
  mindmap: `mindmap
  root((TinyDocy))
    Editing
      Headings
      Lists
      Tables
    Collaboration
      Yjs
      Hocuspocus
    Extensions
      Hyperlink
      Mermaid
      Media`,
  pieChart: `pie title Where review time goes
  "Reading diffs" : 42
  "Running tests" : 23
  "Discussion" : 20
  "Writing comments" : 15`,
  barLineChart: `xychart-beta
  title "p95 keystroke latency (ms)"
  x-axis [W1, W2, W3, W4, W5, W6]
  y-axis "Latency (ms)" 0 --> 20
  bar [14, 12, 11, 9, 8, 7]
  line [14, 12, 11, 9, 8, 7]`,
  gantt: `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  section Editor
  Extensions upgrade :done, e1, 2026-11-02, 4d
  Mermaid examples   :active, e2, after e1, 3d
  section Quality
  Soak tests         :q1, after e2, 5d
  Release            :milestone, after q1, 0d`,
  quadrantChart: `quadrantChart
  title Feature impact vs effort
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Plan
  quadrant-2 Do now
  quadrant-3 Skip
  quadrant-4 Maybe
  Inline code: [0.2, 0.4]
  Mermaid: [0.45, 0.85]
  Media embeds: [0.6, 0.7]
  Offline mode: [0.9, 0.6]`,
  radarChart: `radar-beta
  title Editor quality
  axis Perf, Collab, A11y, Security, DX
  curve Today{4, 5, 3, 4, 4}
  curve Target{5, 5, 5, 5, 5}`,
  sankey: `sankey-beta
Visitors,Playground,60
Visitors,Docs,40
Playground,New document,25
Playground,Left,35
Docs,New document,15`,
  timeline: `timeline
  title Editor milestones
  2025 : Title-first schema : Heading fold
  2026 : Section drag : TOC filter
  2027 : docs.plus extensions`,
} as const;

export type PlaygroundDiagram = keyof typeof PLAYGROUND_DIAGRAMS;

export const PLAYGROUND_DIAGRAM_KEYS = Object.keys(
  PLAYGROUND_DIAGRAMS,
) as PlaygroundDiagram[];

export function createDiagramBlock(diagram: PlaygroundDiagram): JSONContent {
  return {
    type: "codeBlock",
    attrs: { language: "mermaid" },
    content: [{ type: "text", text: PLAYGROUND_DIAGRAMS[diagram] }],
  };
}
