/**
 * Mermaid starter diagrams (spec §5 M17b). The last one used is remembered
 * in the `mermaidTemplate` choice slot (cleared by "Forget my choices").
 */
import {
  type ChoiceSpec,
  readChoice,
  rememberChoice,
  subscribeChoices,
} from "@/lib/remembered-choice";

export const MERMAID_TEMPLATES = [
  {
    id: "flowchart",
    label: "Flowchart",
    source:
      "flowchart LR\n  Start([Start]) --> Step[Do the work]\n  Step --> Check{Done?}\n  Check -->|Yes| Finish([Finish])\n  Check -->|No| Step",
  },
  {
    id: "sequence",
    label: "Sequence",
    source:
      "sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello Bob\n  B-->>A: Hi Alice",
  },
  {
    id: "state",
    label: "State",
    source:
      "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Draft: changes requested\n  Review --> Published\n  Published --> [*]",
  },
  {
    id: "mindmap",
    label: "Mind map",
    source:
      "mindmap\n  root((Topic))\n    Idea one\n    Idea two\n    Idea three",
  },
  {
    id: "pie",
    label: "Pie chart",
    source:
      'pie title Share of time\n  "Writing" : 50\n  "Reviewing" : 30\n  "Meetings" : 20',
  },
] as const;

export type MermaidTemplate = (typeof MERMAID_TEMPLATES)[number];
export type MermaidTemplateId = MermaidTemplate["id"];

export function isMermaidTemplateId(
  value: unknown,
): value is MermaidTemplateId {
  return MERMAID_TEMPLATES.some((template) => template.id === value);
}

export function getMermaidTemplate(id: MermaidTemplateId): MermaidTemplate {
  return (
    MERMAID_TEMPLATES.find((template) => template.id === id) ??
    MERMAID_TEMPLATES[0]
  );
}

export const MERMAID_TEMPLATE_CHOICE: ChoiceSpec<MermaidTemplateId> = {
  slot: "mermaidTemplate",
  maxRecent: 0,
  validate: isMermaidTemplateId,
  fallback: "flowchart",
};

/** The same slot, read without the fallback: null until a first use. */
const USED_TEMPLATE_CHOICE: ChoiceSpec<MermaidTemplateId | null> = {
  ...MERMAID_TEMPLATE_CHOICE,
  validate: (value): value is MermaidTemplateId | null =>
    value === null || isMermaidTemplateId(value),
  fallback: null,
};

/** In-page values; dropped on any memory-layer change (Forget, other tabs). */
let lastTemplate: MermaidTemplateId | undefined;
let usedTemplate: MermaidTemplateId | null | undefined;
let watching = false;

function watch(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  subscribeChoices(() => {
    lastTemplate = undefined;
    usedTemplate = undefined;
  });
}

/**
 * The template actually used last, or null on a fresh profile (where
 * `lastMermaidTemplate()` falls back to flowchart): only a real use earns
 * the "Last used" mark.
 */
export function usedMermaidTemplate(): MermaidTemplateId | null {
  watch();
  if (usedTemplate === undefined) {
    usedTemplate = readChoice(USED_TEMPLATE_CHOICE).last;
  }
  return usedTemplate;
}

export function lastMermaidTemplate(): MermaidTemplateId {
  watch();
  if (lastTemplate === undefined) {
    const stored = readChoice(MERMAID_TEMPLATE_CHOICE).last;
    lastTemplate = isMermaidTemplateId(stored)
      ? stored
      : MERMAID_TEMPLATE_CHOICE.fallback;
  }
  return lastTemplate;
}

/** Called only from `template.mermaid`'s `run()` after the insert succeeded. */
export function rememberMermaidTemplate(id: MermaidTemplateId): void {
  watch();
  rememberChoice(MERMAID_TEMPLATE_CHOICE, id);
  lastTemplate = id;
  usedTemplate = id;
}
