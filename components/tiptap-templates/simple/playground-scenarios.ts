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

const CODE_SAMPLES: { code: string; language: string }[] = [
  {
    language: "typescript",
    code: `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));`,
  },
  {
    language: "typescript",
    code: "const items = [1, 2, 3, 4, 5];\nconst doubled = items.map(n => n * 2);\nconsole.log(doubled);",
  },
  {
    language: "typescript",
    code: "interface Config {\n  port: number;\n  host: string;\n}\n\nconst defaults: Config = { port: 3000, host: 'localhost' };",
  },
  {
    language: "python",
    code: "def fibonacci(n: int) -> list[int]:\n    a, b = 0, 1\n    result = []\n    for _ in range(n):\n        result.append(a)\n        a, b = b, a + b\n    return result\n\nprint(fibonacci(10))",
  },
  {
    language: "css",
    code: ".container {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));\n  gap: 1rem;\n  padding: 2rem;\n}",
  },
  {
    language: "sql",
    code: "SELECT u.name, COUNT(o.id) AS order_count\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.active = true\nGROUP BY u.name\nORDER BY order_count DESC\nLIMIT 10;",
  },
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

const HIGHLIGHT_COLORS = [
  "#f1c40f",
  "#2ecc71",
  "#e74c3c",
  "#3498db",
  "#9b59b6",
  "#e67e22",
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
  | "image"
  | "table";

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
  "table",
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
      "highlight",
      "highlight",
    ] as const);
    if (mark === "link") {
      parts.push({
        type: "text",
        text: slice,
        marks: [
          { type: "link", attrs: { href: "https://example.com", title: null } },
        ],
      });
    } else if (mark === "highlight") {
      parts.push({
        type: "text",
        text: slice,
        marks: [
          {
            type: "highlight",
            attrs: { color: pick(HIGHLIGHT_COLORS) },
          },
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
  const sample = pick(CODE_SAMPLES);
  return {
    type: "codeBlock",
    attrs: { language: sample.language },
    content: [{ type: "text", text: sample.code }],
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

const TABLE_DATA: { headers: string[]; rows: string[][] }[] = [
  {
    headers: ["Feature", "Status", "Priority"],
    rows: [
      ["Authentication", "Complete", "High"],
      ["Dashboard", "In Progress", "High"],
      ["Notifications", "Planned", "Medium"],
      ["Analytics", "Not Started", "Low"],
    ],
  },
  {
    headers: ["Endpoint", "Method", "Description"],
    rows: [
      ["/api/users", "GET", "List all users"],
      ["/api/users/:id", "GET", "Get user by ID"],
      ["/api/documents", "POST", "Create document"],
      ["/api/documents/:id", "DELETE", "Delete document"],
    ],
  },
  {
    headers: ["Metric", "Target", "Current"],
    rows: [
      ["p95 Latency", "< 16ms", "12ms"],
      ["Memory Growth", "< 50%", "23%"],
      ["Test Coverage", "> 80%", "87%"],
    ],
  },
];

function createTable(): JSONContent {
  const data = pick(TABLE_DATA);
  const headerCells: JSONContent[] = data.headers.map((text) => ({
    type: "tableHeader",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }));
  const bodyRows: JSONContent[] = data.rows.map((row) => ({
    type: "tableRow",
    content: row.map((text) => ({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  }));
  return {
    type: "table",
    content: [{ type: "tableRow", content: headerCells }, ...bodyRows],
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
    case "table":
      return createTable();
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

function headingAttrs(level: number): Record<string, unknown> {
  const id = crypto.randomUUID();
  return { level, id, "data-toc-id": id };
}

function headingNodesToContent(nodes: HeadingNode[]): JSONContent[] {
  const result: JSONContent[] = [];
  for (const node of nodes) {
    result.push({
      type: "heading",
      attrs: headingAttrs(node.level),
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
      attrs: headingAttrs(1),
      content: [{ type: "text", text: pick(DOC_TITLES) }],
    },
    ...createSectionBody(),
    ...headingNodesToContent(nestedHeadings),
  ];

  return { type: "doc", content };
}
