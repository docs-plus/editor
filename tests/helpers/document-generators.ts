import type { JSONContent } from "@tiptap/core";

/**
 * A source of numbers in [0, 1). `Math.random` by default; the fixture
 * generators (`scripts/fixtures/`) pass a seeded one so a seed replays the
 * same document.
 */
export type Random = () => number;

// `pick`, `randomInt` and `shuffle` mirror `lib/random.ts` with an
// injected `random` (same draw order, so `Math.random` callers see no
// change). They are copied, not shared, because `lib/random.ts` ships in
// the app (the playground scenarios): giving it a parameter would change
// app code and its chunk sizes for a test-only need, and this PR adds 0 B.
// A fix to one belongs in both.
function pick<T>(random: Random, arr: readonly T[]): T {
  return arr[Math.floor(random() * arr.length)];
}

function randomInt(random: Random, min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function shuffle<T>(random: Random, arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface GenerateRandomDocumentOptions {
  minSections?: number;
  maxSections?: number;
  maxDepth?: number;
  includeContent?: boolean;
  contentTypes?: string[];
  random?: Random;
}

const DEFAULT_CONTENT_TYPES = [
  "paragraph",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
];

type ContentBlock = JSONContent;

const PROSE_SENTENCES = [
  "The architecture relies on a shared document model enforced at the schema level.",
  "Each section can be folded independently, preserving context across sessions.",
  "Collaboration is powered by Yjs CRDTs, enabling conflict-free concurrent editing.",
  "Performance remains stable even in documents exceeding two hundred headings.",
  "Users can filter sections by keyword, hiding unmatched content in real time.",
  "Drag-and-drop reordering moves entire sections including nested subsections.",
  "The table of contents updates reactively as headings are added or removed.",
  "Dark mode support follows user preference without requiring a page reload.",
  "Heading scale dynamically adjusts font size based on section depth and position.",
  "Document persistence uses SQLite via Hocuspocus for offline-first reliability.",
  "Task lists allow teams to track progress directly within the document body.",
  "Code blocks support syntax highlighting for common programming languages.",
  "Blockquotes visually distinguish editorial comments from primary content.",
  "The editor enforces a single H1 title as the first node in every document.",
  "Nested heading structures support up to six levels of hierarchy.",
  "Undo and redo history is preserved across collaboration sessions.",
  "WebSocket connections automatically reconnect after transient network failures.",
  "Keyboard shortcuts follow platform conventions for bold, italic, and lists.",
];

const CODE_SAMPLES = [
  `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));`,
  "const items = [1, 2, 3, 4, 5];\nconst doubled = items.map(n => n * 2);\nconsole.log(doubled);",
  "interface Config {\n  port: number;\n  host: string;\n  debug: boolean;\n}\n\nconst defaults: Config = {\n  port: 3000,\n  host: 'localhost',\n  debug: false,\n};",
  "async function fetchData(url: string) {\n  const res = await fetch(url);\n  if (!res.ok) throw new Error(res.statusText);\n  return res.json();\n}",
];

const TASK_LABELS = [
  "Review the pull request for edge cases",
  "Update the deployment documentation",
  "Add integration tests for the new endpoint",
  "Verify performance benchmarks pass the threshold",
  "Fix the flaky collaboration sync test",
  "Migrate the legacy configuration format",
  "Audit third-party dependency licenses",
  "Set up CI pipeline for the staging branch",
];

const LIST_ITEMS = [
  "Configure the development environment",
  "Install required dependencies and verify versions",
  "Run the test suite to confirm baseline",
  "Review the coding standards document",
  "Set up branch protection rules",
  "Enable automated code formatting",
  "Document the API contract for consumers",
  "Prepare the changelog for the next release",
  "Coordinate rollout timing with the platform team",
  "Monitor error rates after deployment",
];

function createParagraph(r: Random): ContentBlock {
  const count = randomInt(r, 2, 4);
  const sentences: string[] = [];
  for (let i = 0; i < count; i++) {
    sentences.push(pick(r, PROSE_SENTENCES));
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text: sentences.join(" ") }],
  };
}

function createBlockquote(r: Random): ContentBlock {
  return {
    type: "blockquote",
    content: [createParagraph(r), createParagraph(r)],
  };
}

function createBulletList(r: Random): ContentBlock {
  const items = randomInt(r, 3, 6);
  const pool = shuffle(r, [...LIST_ITEMS]);
  return {
    type: "bulletList",
    content: Array.from({ length: items }, (_, i) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: pool[i % pool.length] }],
        },
      ],
    })),
  };
}

function createOrderedList(r: Random): ContentBlock {
  const items = randomInt(r, 3, 5);
  const pool = shuffle(r, [...LIST_ITEMS]);
  return {
    type: "orderedList",
    content: Array.from({ length: items }, (_, i) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: `Step ${i + 1}: ${pool[i % pool.length]}` },
          ],
        },
      ],
    })),
  };
}

function createTaskList(r: Random): ContentBlock {
  const items = randomInt(r, 3, 5);
  const pool = shuffle(r, [...TASK_LABELS]);
  return {
    type: "taskList",
    content: Array.from({ length: items }, (_, i) => ({
      type: "taskItem",
      attrs: { checked: r() < 0.4 },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: pool[i % pool.length] }],
        },
      ],
    })),
  };
}

function createCodeBlock(r: Random): ContentBlock {
  return {
    type: "codeBlock",
    content: [{ type: "text", text: pick(r, CODE_SAMPLES) }],
  };
}

function createContentBlock(r: Random, contentType: string): ContentBlock {
  switch (contentType) {
    case "paragraph":
      return createParagraph(r);
    case "blockquote":
      return createBlockquote(r);
    case "bulletList":
      return createBulletList(r);
    case "orderedList":
      return createOrderedList(r);
    case "taskList":
      return createTaskList(r);
    case "codeBlock":
      return createCodeBlock(r);
    default:
      return createParagraph(r);
  }
}

function createSectionBody(r: Random, contentTypes: string[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  const paraCount = randomInt(r, 3, 5);
  for (let i = 0; i < paraCount; i++) {
    blocks.push(createParagraph(r));
  }

  const structuredTypes = contentTypes.filter((t) => t !== "paragraph");
  const structuredCount = randomInt(r, 1, 3);
  for (let i = 0; i < structuredCount; i++) {
    const insertAt = randomInt(r, 1, blocks.length);
    blocks.splice(insertAt, 0, createContentBlock(r, pick(r, structuredTypes)));
  }

  if (r() < 0.4) {
    const insertAt = randomInt(r, 1, blocks.length);
    blocks.splice(insertAt, 0, createParagraph(r));
  }

  return blocks;
}

const SECTION_TITLES = [
  "Getting Started",
  "Installation Guide",
  "Configuration Options",
  "Architecture Overview",
  "Authentication and Authorization",
  "Data Model Design",
  "API Reference",
  "Error Handling Strategy",
  "Testing and Quality Assurance",
  "Deployment Procedures",
  "Performance Optimization",
  "Security Considerations",
  "Monitoring and Observability",
  "Migration Guide",
  "Troubleshooting",
  "Release Notes",
  "Contributing Guidelines",
  "Accessibility Standards",
  "Internationalization",
  "Plugin Development",
];

export interface GenerateLargeDocumentOptions {
  shape?: "flat" | "deep" | "mixed";
  richContent?: boolean;
  contentTypes?: string[];
  random?: Random;
}

export function generateLargeDocument(
  headingCount: number,
  shapeOrOptions:
    | "flat"
    | "deep"
    | "mixed"
    | GenerateLargeDocumentOptions = "mixed",
): { type: "doc"; content: JSONContent[] } {
  const opts: GenerateLargeDocumentOptions =
    typeof shapeOrOptions === "string"
      ? { shape: shapeOrOptions }
      : shapeOrOptions;
  const shape = opts.shape ?? "mixed";
  const richContent = opts.richContent ?? true;
  const contentTypes = opts.contentTypes ?? DEFAULT_CONTENT_TYPES;
  const r = opts.random ?? Math.random;

  const content: JSONContent[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Soak Test Document" }],
    },
  ];

  for (let i = 1; i < headingCount; i++) {
    let level: number;
    switch (shape) {
      case "flat":
        level = 2;
        break;
      case "deep":
        level = ((i - 1) % 5) + 2;
        break;
      case "mixed":
        level = randomInt(r, 2, 6);
        break;
    }

    const title = `${SECTION_TITLES[i % SECTION_TITLES.length]} ${Math.ceil(i / SECTION_TITLES.length)}`;
    content.push({
      type: "heading",
      attrs: { level },
      content: [{ type: "text", text: title }],
    });

    if (richContent) {
      content.push(...createSectionBody(r, contentTypes));
    } else {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: `Content for section ${i}.` }],
      });
    }
  }

  return { type: "doc", content };
}

/**
 * Generates a valid Tiptap JSON document conforming to the heading block* schema.
 * First node is always H1 title, followed by random sections with headings and content.
 */
export function generateRandomDocument(
  options: GenerateRandomDocumentOptions = {},
): { type: "doc"; content: JSONContent[] } {
  const {
    minSections = 1,
    maxSections = 10,
    maxDepth = 3,
    includeContent = true,
    contentTypes = DEFAULT_CONTENT_TYPES,
    random: r = Math.random,
  } = options;

  const sectionCount = randomInt(r, minSections, maxSections);
  const content: JSONContent[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Test Title" }],
    },
  ];

  for (let s = 0; s < sectionCount - 1; s++) {
    const level = randomInt(r, 1, Math.min(maxDepth, 6));
    const headingText = `Section ${s + 2} Level ${level}`;
    content.push({
      type: "heading",
      attrs: { level },
      content: [{ type: "text", text: headingText }],
    });

    if (includeContent) {
      const blockCount = randomInt(r, 0, 3);
      for (let b = 0; b < blockCount; b++) {
        const contentType = pick(r, contentTypes);
        content.push(createContentBlock(r, contentType));
      }
    }
  }

  return { type: "doc", content };
}
