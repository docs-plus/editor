import type { JSONContent } from "@tiptap/core";
import { pick, randomInt, shuffle } from "@/lib/random";

const DOC_TITLES = [
  "Project Overview",
  "Technical Specification",
  "Design Document",
  "Implementation Guide",
  "Architecture Notes",
  "Research Findings",
  "Product Requirements",
  "System Design",
];

const SECTION_TITLES = [
  "Getting Started",
  "Installation",
  "Configuration",
  "Architecture",
  "Authentication",
  "Data Model",
  "API Reference",
  "Error Handling",
  "Testing",
  "Deployment",
  "Performance",
  "Security",
  "Monitoring",
  "Migration",
  "Troubleshooting",
  "Release Notes",
  "Contributing",
  "Accessibility",
  "Internationalization",
  "Plugin Development",
  "Best Practices",
  "Common Patterns",
  "Advanced Usage",
  "Limitations",
  "Future Roadmap",
];

const PROSE = [
  "The architecture relies on a shared document model enforced at the schema level.",
  "Each section can be folded independently, preserving context across sessions.",
  "Collaboration is powered by Yjs CRDTs, enabling conflict-free concurrent editing.",
  "Users can filter sections by keyword, hiding unmatched content in real time.",
  "The table of contents updates reactively as headings are added or removed.",
  "Document persistence uses SQLite via Hocuspocus for offline-first reliability.",
  "Task lists allow teams to track progress directly within the document body.",
  "Code blocks support syntax highlighting for common programming languages.",
  "Blockquotes visually distinguish editorial comments from primary content.",
  "Nested heading structures support up to six levels of hierarchy.",
  "Performance remains stable even in documents exceeding two hundred headings.",
  "Drag-and-drop reordering moves entire sections including nested subsections.",
  "Dark mode support follows user preference without requiring a page reload.",
  "Heading scale dynamically adjusts font size based on section depth and position.",
  "WebSocket connections automatically reconnect after transient network failures.",
  "Keyboard shortcuts follow platform conventions for bold, italic, and lists.",
  "Undo and redo history is preserved across collaboration sessions.",
  "The editor enforces a single H1 title as the first node in every document.",
  "Real-time sync ensures all collaborators see changes within milliseconds.",
  "The filter sidebar highlights matching sections across the entire document.",
];

const CODE_SAMPLES = [
  "function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet('World'));",
  "const items = [1, 2, 3, 4, 5];\nconst doubled = items.map(n => n * 2);\nconsole.log(doubled);",
  "interface Config {\n  port: number;\n  host: string;\n}\n\nconst defaults: Config = { port: 3000, host: 'localhost' };",
];

const TASK_LABELS = [
  "Review the pull request",
  "Update documentation",
  "Add integration tests",
  "Verify benchmarks",
  "Fix flaky tests",
  "Migrate configuration",
];

const LIST_ITEMS = [
  "Configure development environment",
  "Install dependencies",
  "Run test suite",
  "Review coding standards",
  "Document API contract",
  "Prepare changelog",
];

const IMAGE_URLS = [
  "https://picsum.photos/seed/doc1/400/300",
  "https://picsum.photos/seed/doc2/400/250",
  "https://picsum.photos/seed/doc3/400/300",
];

type ContentBlockType =
  | "paragraph"
  | "paragraphMarks"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "image";

const CONTENT_TYPES: ContentBlockType[] = [
  "paragraph",
  "paragraph",
  "paragraphMarks",
  "bulletList",
  "bulletList",
  "orderedList",
  "orderedList",
  "taskList",
  "taskList",
  "blockquote",
  "codeBlock",
  "image",
];

function createParagraph(): JSONContent {
  const count = randomInt(3, 6);
  const sentences: string[] = [];
  for (let i = 0; i < count; i++) {
    sentences.push(pick(PROSE));
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text: sentences.join(" ") }],
  };
}

function createParagraphWithMarks(): JSONContent {
  const parts: NonNullable<JSONContent["content"]> = [];
  const words = pick(PROSE).split(" ").filter(Boolean);
  let i = 0;
  while (i < words.length) {
    const len = randomInt(1, Math.min(4, words.length - i));
    const slice = words.slice(i, i + len).join(" ");
    i += len;
    if (!slice) continue;
    const mark = pick([
      "bold",
      "italic",
      "strike",
      "code",
      "underline",
      "link",
    ] as const);
    if (mark === "link") {
      parts.push({
        type: "text",
        text: slice,
        marks: [
          { type: "link", attrs: { href: "https://example.com", title: null } },
        ],
      });
    } else {
      parts.push({
        type: "text",
        text: slice,
        marks: [{ type: mark }],
      });
    }
  }
  return {
    type: "paragraph",
    content: parts.length > 0 ? parts : [{ type: "text", text: pick(PROSE) }],
  };
}

function createBulletList(): JSONContent {
  const items = randomInt(4, 8);
  const pool = shuffle([...LIST_ITEMS]);
  const listItems: JSONContent[] = [];
  for (let i = 0; i < items; i++) {
    const item: JSONContent = {
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: pool[i % pool.length] }],
        },
      ],
    };
    if (Math.random() < 0.35 && i < items - 1) {
      const nestedType = pick(["bulletList", "orderedList"] as const);
      item.content?.push({
        type: nestedType,
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: pick(LIST_ITEMS) }],
              },
            ],
          },
        ],
      } as JSONContent);
    }
    listItems.push(item);
  }
  return { type: "bulletList", content: listItems };
}

function createOrderedList(): JSONContent {
  const items = randomInt(4, 7);
  const pool = shuffle([...LIST_ITEMS]);
  const listItems: JSONContent[] = [];
  for (let i = 0; i < items; i++) {
    const item: JSONContent = {
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: `Step ${i + 1}: ${pool[i % pool.length]}` },
          ],
        },
      ],
    };
    if (Math.random() < 0.25 && i < items - 1) {
      item.content?.push({
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: pick(LIST_ITEMS) }],
              },
            ],
          },
        ],
      } as JSONContent);
    }
    listItems.push(item);
  }
  return { type: "orderedList", content: listItems };
}

function createTaskList(): JSONContent {
  const items = randomInt(4, 8);
  const pool = shuffle([...TASK_LABELS]);
  const taskItems: JSONContent[] = [];
  for (let i = 0; i < items; i++) {
    const item: JSONContent = {
      type: "taskItem",
      attrs: { checked: Math.random() < 0.4 },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: pool[i % pool.length] }],
        },
      ],
    };
    if (Math.random() < 0.2 && i < items - 1) {
      item.content?.push({
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: Math.random() < 0.3 },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: pick(TASK_LABELS) }],
              },
            ],
          },
        ],
      } as JSONContent);
    }
    taskItems.push(item);
  }
  return { type: "taskList", content: taskItems };
}

function createBlockquote(): JSONContent {
  const paraCount = randomInt(2, 4);
  return {
    type: "blockquote",
    content: Array.from({ length: paraCount }, () => createParagraph()),
  };
}

function createCodeBlock(): JSONContent {
  return {
    type: "codeBlock",
    content: [{ type: "text", text: pick(CODE_SAMPLES) }],
  };
}

function createImage(): JSONContent {
  return {
    type: "image",
    attrs: {
      src: pick(IMAGE_URLS),
      alt: "Sample image",
      title: null,
    },
  };
}

function createContentBlock(type: ContentBlockType): JSONContent {
  switch (type) {
    case "paragraph":
      return createParagraph();
    case "paragraphMarks":
      return createParagraphWithMarks();
    case "bulletList":
      return createBulletList();
    case "orderedList":
      return createOrderedList();
    case "taskList":
      return createTaskList();
    case "blockquote":
      return createBlockquote();
    case "codeBlock":
      return createCodeBlock();
    case "image":
      return createImage();
    default: {
      const _exhaustive: never = type;
      return createParagraph();
    }
  }
}

function createSectionBody(): JSONContent[] {
  const blocks: JSONContent[] = [];
  const paraCount = randomInt(5, 10);
  for (let i = 0; i < paraCount; i++) {
    blocks.push(createParagraph());
  }
  const structuredCount = randomInt(5, 12);
  for (let i = 0; i < structuredCount; i++) {
    const insertAt = randomInt(1, blocks.length);
    blocks.splice(insertAt, 0, createContentBlock(pick(CONTENT_TYPES)));
  }
  return blocks;
}

type HeadingNode = {
  level: number;
  title: string;
  children: HeadingNode[];
};

function buildNestedHeadings(
  minLevel: number,
  maxLevel: number,
  count: number,
  usedTitles: Set<string>,
): HeadingNode[] {
  if (count <= 0 || minLevel > maxLevel) return [];
  const nodes: HeadingNode[] = [];
  let remaining = count;
  while (remaining > 0) {
    const canHaveChildren = minLevel < maxLevel && remaining > 1;
    const preferDeep = canHaveChildren && remaining > 4 && Math.random() < 0.55;
    const level = preferDeep
      ? randomInt(minLevel, Math.min(minLevel + 1, maxLevel))
      : randomInt(minLevel, Math.min(minLevel + 2, maxLevel));
    let title = pick(SECTION_TITLES);
    let attempts = 0;
    while (usedTitles.has(title) && attempts < 20) {
      title = `${pick(SECTION_TITLES)} ${randomInt(1, 99)}`;
      attempts++;
    }
    usedTitles.add(title);
    const maxChildren = Math.min(remaining - 1, 8);
    const minChildren = preferDeep && maxChildren >= 2 ? randomInt(2, 4) : 0;
    const childCount =
      level < maxLevel && maxChildren > 0
        ? randomInt(minChildren, Math.max(minChildren, maxChildren))
        : 0;
    const children = buildNestedHeadings(
      level + 1,
      maxLevel,
      childCount,
      usedTitles,
    );
    remaining -= 1 + children.length;
    nodes.push({ level, title, children });
  }
  return nodes;
}

function headingNodesToContent(nodes: HeadingNode[]): JSONContent[] {
  const result: JSONContent[] = [];
  for (const node of nodes) {
    result.push({
      type: "heading",
      attrs: { level: node.level },
      content: [{ type: "text", text: node.title }],
    });
    result.push(...createSectionBody());
    result.push(...headingNodesToContent(node.children));
  }
  return result;
}

export function generatePlaygroundContent(): JSONContent {
  const usedTitles = new Set<string>();
  const sectionCount = randomInt(32, 56);
  const nestedHeadings = buildNestedHeadings(1, 6, sectionCount, usedTitles);

  const content: JSONContent["content"] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: pick(DOC_TITLES) }],
    },
    ...createSectionBody(),
    ...headingNodesToContent(nestedHeadings),
  ];

  return { type: "doc", content };
}
