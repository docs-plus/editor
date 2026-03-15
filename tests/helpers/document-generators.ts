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
  "codeBlock",
];

interface ContentBlock {
  type: string;
  content?: Array<{ type: string; text?: string }>;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createParagraph(): ContentBlock {
  const words = ["Lorem", "ipsum", "dolor", "sit", "amet", "consectetur"];
  const len = randomInt(3, 8);
  const text = Array.from({ length: len }, () => pick(words)).join(" ");
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function createBlockquote(): ContentBlock {
  return {
    type: "blockquote",
    content: [createParagraph()],
  };
}

function createBulletList(): ContentBlock {
  const items = randomInt(2, 4);
  return {
    type: "bulletList",
    content: Array.from({ length: items }, () => ({
      type: "listItem",
      content: [createParagraph()],
    })),
  };
}

function createCodeBlock(): ContentBlock {
  return {
    type: "codeBlock",
    content: [{ type: "text", text: "const x = 1;\nconsole.log(x);" }],
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
    case "codeBlock":
      return createCodeBlock();
    default:
      return createParagraph();
  }
}

export function generateLargeDocument(
  headingCount: number,
  shape: "flat" | "deep" | "mixed" = "mixed",
): { type: "doc"; content: unknown[] } {
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
    content.push(
      {
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: `Section ${i}` }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: `Content for section ${i}.` }],
      },
    );
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
