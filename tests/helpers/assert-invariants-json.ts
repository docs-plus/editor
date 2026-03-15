export function assertInvariantsFromJSON(json: {
  content?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
}): void {
  const content = json?.content;
  if (!content || content.length === 0) {
    throw new Error("Document has no content");
  }
  const first = content[0];
  if (first.type !== "heading") {
    throw new Error(`First node is "${first.type}", expected "heading"`);
  }
  if (first.attrs?.level !== 1) {
    throw new Error(`First heading level is ${first.attrs?.level}, expected 1`);
  }
  for (const node of content) {
    if (node.type === "heading") {
      const level = node.attrs?.level as number;
      if (level < 1 || level > 6) {
        throw new Error(`Invalid heading level: ${level}`);
      }
    }
  }
}
