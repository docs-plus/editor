import type { JSONContent } from "@tiptap/core";

export type PlaygroundScenario = {
  id: string;
  label: string;
  generate: () => JSONContent;
};

function heading(level: number, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function paragraph(text: string): JSONContent {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const FILLER = [
  "This paragraph demonstrates body content between headings. The dynamic heading scale adjusts sizes based on how many distinct heading levels exist in each section.",
  "Notice how headings within each section are sized relative to each other, regardless of their HTML level number. Two sections with different level combinations but the same count of distinct levels will look visually consistent.",
  "The interpolation distributes sizes evenly between 20pt (largest) and 12pt (smallest). A section with three distinct levels gets sizes at 20pt, 16pt, and 12pt.",
  "Content blocks like paragraphs, lists, and code blocks sit between headings and are unaffected by the dynamic scale. Only heading nodes receive the computed size.",
  "Each section is independent. Adding or removing a heading in one section does not affect the sizing in another section.",
  "Try editing these headings — change their levels, add new ones, or delete them. The sizes update instantly as the heading structure changes.",
];

type SectionTemplate = {
  title: string;
  subLevels: number[];
  description: string;
};

const TEMPLATES: SectionTemplate[] = [
  {
    title: "Standard Hierarchy",
    subLevels: [2, 3],
    description: "A classic three-level section: H1, H2, H3.",
  },
  {
    title: "Sparse Levels",
    subLevels: [4, 6],
    description:
      "Skips levels entirely (H1, H4, H6) — the scale treats them as three evenly-spaced ranks.",
  },
  {
    title: "Deep Nesting",
    subLevels: [2, 3, 4],
    description:
      "Four distinct levels produce tighter size steps between each rank.",
  },
  {
    title: "Single Heading",
    subLevels: [],
    description: "A section with only an H1 and body content. Gets max size.",
  },
  {
    title: "Odd Levels Only",
    subLevels: [3, 5],
    description:
      "Uses H1, H3, H5 — three ranks distributed the same as H1, H2, H3.",
  },
  {
    title: "Full Spectrum",
    subLevels: [2, 3, 4, 5, 6],
    description:
      "All six HTML heading levels in one section. Six ranks from 20pt down to 12pt.",
  },
  {
    title: "Two Levels",
    subLevels: [3],
    description:
      "Only H1 and H3 — two ranks means max size and min size, nothing between.",
  },
  {
    title: "Even Levels",
    subLevels: [2, 4, 6],
    description:
      "H1, H2, H4, H6 — four ranks evenly interpolated across the size range.",
  },
];

function buildSection(template: SectionTemplate): JSONContent[] {
  const nodes: JSONContent[] = [];

  nodes.push(heading(1, template.title));
  nodes.push(paragraph(template.description));

  for (const level of template.subLevels) {
    nodes.push(heading(level, `Level ${level} heading`));
    nodes.push(paragraph(pick(FILLER)));
  }

  if (template.subLevels.length === 0) {
    nodes.push(paragraph(pick(FILLER)));
  }

  return nodes;
}

function generateHeadingScaleContent(): JSONContent {
  const count = 3 + Math.floor(Math.random() * 3); // 3-5 sections
  const selected = shuffle(TEMPLATES).slice(0, count);

  const content: JSONContent[] = [];
  for (const template of selected) {
    content.push(...buildSection(template));
  }

  return { type: "doc", content };
}

export const scenarios: PlaygroundScenario[] = [
  {
    id: "heading-scale",
    label: "Dynamic Heading Scale",
    generate: generateHeadingScaleContent,
  },
];
