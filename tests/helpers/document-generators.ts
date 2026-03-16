import { pick, randomInt, shuffle } from "@/lib/random";

export interface GenerateRandomDocumentOptions {
  minSections?: number;
  maxSections?: number;
  maxDepth?: number;
  includeContent?: boolean;
  contentTypes?: string[];
}

const DEFAULT_CONTENT_TYPES = [
  "paragraph",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
];

type ContentBlock = Record<string, unknown>;

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
  "function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet('World'));",
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

function createParagraph(): ContentBlock {
  const count = randomInt(2, 4);
  const sentences: string[] = [];
  for (let i = 0; i < count; i++) {
    sentences.push(pick(PROSE_SENTENCES));
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text: sentences.join(" ") }],
  };
}

function createBlockquote(): ContentBlock {
  return {
    type: "blockquote",
    content: [createParagraph(), createParagraph()],
  };
}

function createBulletList(): ContentBlock {
  const items = randomInt(3, 6);
  const pool = shuffle([...LIST_ITEMS]);
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

function createOrderedList(): ContentBlock {
  const items = randomInt(3, 5);
  const pool = shuffle([...LIST_ITEMS]);
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

function createTaskList(): ContentBlock {
  const items = randomInt(3, 5);
  const pool = shuffle([...TASK_LABELS]);
  return {
    type: "taskList",
    content: Array.from({ length: items }, (_, i) => ({
      type: "taskItem",
      attrs: { checked: Math.random() < 0.4 },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: pool[i % pool.length] }],
        },
      ],
    })),
  };
}

function createCodeBlock(): ContentBlock {
  return {
    type: "codeBlock",
    content: [{ type: "text", text: pick(CODE_SAMPLES) }],
  };
}

function createContentBlock(contentType: string): ContentBlock {
  switch (contentType) {
    case "paragraph":
      return createParagraph();
    case "blockquote":
      return createBlockquote();
    case "bulletList":
      return createBulletList();
    case "orderedList":
      return createOrderedList();
    case "taskList":
      return createTaskList();
    case "codeBlock":
      return createCodeBlock();
    default:
      return createParagraph();
  }
}

function createSectionBody(contentTypes: string[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  const paraCount = randomInt(3, 5);
  for (let i = 0; i < paraCount; i++) {
    blocks.push(createParagraph());
  }

  const structuredTypes = contentTypes.filter((t) => t !== "paragraph");
  const structuredCount = randomInt(1, 3);
  for (let i = 0; i < structuredCount; i++) {
    const insertAt = randomInt(1, blocks.length);
    blocks.splice(insertAt, 0, createContentBlock(pick(structuredTypes)));
  }

  if (Math.random() < 0.4) {
    const insertAt = randomInt(1, blocks.length);
    blocks.splice(insertAt, 0, createParagraph());
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
}

export function generateLargeDocument(
  headingCount: number,
  shapeOrOptions:
    | "flat"
    | "deep"
    | "mixed"
    | GenerateLargeDocumentOptions = "mixed",
): { type: "doc"; content: unknown[] } {
  const opts: GenerateLargeDocumentOptions =
    typeof shapeOrOptions === "string"
      ? { shape: shapeOrOptions }
      : shapeOrOptions;
  const shape = opts.shape ?? "mixed";
  const richContent = opts.richContent ?? true;
  const contentTypes = opts.contentTypes ?? DEFAULT_CONTENT_TYPES;

  const content: unknown[] = [
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
        level = randomInt(2, 6);
        break;
    }

    const title = `${SECTION_TITLES[i % SECTION_TITLES.length]} ${Math.ceil(i / SECTION_TITLES.length)}`;
    content.push({
      type: "heading",
      attrs: { level },
      content: [{ type: "text", text: title }],
    });

    if (richContent) {
      content.push(...createSectionBody(contentTypes));
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
): { type: "doc"; content: unknown[] } {
  const {
    minSections = 1,
    maxSections = 10,
    maxDepth = 3,
    includeContent = true,
    contentTypes = DEFAULT_CONTENT_TYPES,
  } = options;

  const sectionCount = randomInt(minSections, maxSections);
  const content: unknown[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Test Title" }],
    },
  ];

  for (let s = 0; s < sectionCount - 1; s++) {
    const level = randomInt(1, Math.min(maxDepth, 6));
    const headingText = `Section ${s + 2} Level ${level}`;
    content.push({
      type: "heading",
      attrs: { level },
      content: [{ type: "text", text: headingText }],
    });

    if (includeContent) {
      const blockCount = randomInt(0, 3);
      for (let b = 0; b < blockCount; b++) {
        const contentType = pick(contentTypes);
        content.push(createContentBlock(contentType));
      }
    }
  }

  return { type: "doc", content };
}
