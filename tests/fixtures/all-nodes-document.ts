import type { JSONContent } from "@tiptap/core";

/**
 * One document with every node and mark the editor schema can write
 * (`lib/schema-names.ts`), for the headless schema and Markdown tests.
 * Valid against the editor schema (checked in headless-schema.test.ts).
 */

const text = (value: string, marks?: JSONContent["marks"]): JSONContent =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };

const paragraph = (...content: JSONContent[]): JSONContent =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };

const heading = (level: number, value: string): JSONContent => ({
  type: "heading",
  attrs: { level, "data-toc-id": `toc-${level}-${value.length}` },
  content: [text(value)],
});

const item = (type: string, value: string, ...nested: JSONContent[]) => ({
  type,
  content: [paragraph(text(value)), ...nested],
});

const cell = (
  type: string,
  value: string,
  attrs?: Record<string, unknown>,
): JSONContent => ({
  type,
  ...(attrs ? { attrs } : {}),
  content: [paragraph(text(value))],
});

export const ALL_NODES_DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, "data-toc-id": "toc-title" },
      content: [text("Kitchen"), { type: "hardBreak" }, text("sink")],
    },
    {
      type: "heading",
      attrs: { level: 2, textAlign: "center", "data-toc-id": "toc-second" },
      content: [text("Second"), { type: "hardBreak" }, text("level")],
    },
    heading(3, "Third level"),
    heading(4, "Fourth level"),
    heading(5, "Fifth level"),
    heading(6, "Sixth level"),
    paragraph(
      text("bold", [{ type: "bold" }]),
      text(" "),
      text("italic", [{ type: "italic" }]),
      text(" "),
      text("underline", [{ type: "underline" }]),
      text(" "),
      text("strike", [{ type: "strike" }]),
      text(" "),
      text("code", [{ type: "inlineCode" }]),
      text(" "),
      text("marked", [{ type: "highlight", attrs: { color: "green" } }]),
      text(" "),
      text("red", [{ type: "textColor", attrs: { color: "red" } }]),
      text(" "),
      text("large", [{ type: "fontSize", attrs: { size: "lg" } }]),
      text(" x"),
      text("2", [{ type: "superscript" }]),
      text(" H"),
      text("2", [{ type: "subscript" }]),
      text("O "),
      text("link", [
        {
          type: "hyperlink",
          attrs: { href: "https://example.com/a?b=1", title: "Link title" },
        },
      ]),
      text(" "),
      text("bold italic", [{ type: "bold" }, { type: "italic" }]),
    ),
    {
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [text("Centred text")],
    },
    paragraph(text("line one"), { type: "hardBreak" }, text("line two")),
    paragraph(),
    {
      type: "blockquote",
      content: [paragraph(text("Quoted")), paragraph(text("Second line"))],
    },
    {
      type: "bulletList",
      content: [
        item("listItem", "Bullet", {
          type: "bulletList",
          content: [item("listItem", "Nested bullet")],
        }),
        item("listItem", "Second bullet"),
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3, type: "a" },
      content: [item("listItem", "Third"), item("listItem", "Fourth")],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [
            paragraph(text("Done")),
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [paragraph(text("Nested to-do"))],
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [paragraph(text("Open"))],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [text("const a = 1;\nconst b = `x`;")],
    },
    {
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [text("graph TD\n  A --> B")],
    },
    { type: "codeBlock", content: [text("plain code")] },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            cell("tableHeader", "Name", { align: "center", colwidth: [140] }),
            cell("tableHeader", "Value", { align: "right" }),
          ],
        },
        {
          type: "tableRow",
          content: [
            cell("tableCell", "a", { align: "left" }),
            cell("tableCell", "1"),
          ],
        },
      ],
    },
    {
      type: "image",
      attrs: {
        src: "https://example.com/picture.png",
        alt: "A picture",
        title: "Hover title",
        caption: "A caption",
        width: 320,
        height: 200,
        float: "left",
        display: "inline",
        margin: 4,
        clear: "both",
      },
    },
    {
      type: "youtube",
      attrs: {
        src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        width: 480,
        height: 270,
        caption: "Video caption",
        float: "right",
        display: "inline",
        clear: "both",
        margin: 4,
        start: 30,
      },
    },
    { type: "vimeo", attrs: { src: "https://vimeo.com/76979871" } },
    {
      type: "loom",
      attrs: {
        src: "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184",
      },
    },
    {
      type: "soundcloud",
      attrs: { src: "https://soundcloud.com/forss/flickermood" },
    },
    {
      type: "spotify",
      attrs: { src: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" },
    },
    { type: "x", attrs: { src: "https://x.com/jack/status/20" } },
    { type: "video", attrs: { src: "https://example.com/clip.mp4" } },
    { type: "audio", attrs: { src: "https://example.com/sound.mp3" } },
    { type: "imageUpload" },
    paragraph(text("The end.")),
  ],
};
