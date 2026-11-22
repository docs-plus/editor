import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { trackLinkChanges } from "@/lib/links/link-dirty";

/**
 * The links pass is skipped while nothing it reads has changed. Built on a
 * bare Y.Doc, the way y-tiptap writes: a paragraph is an XmlElement holding
 * XmlText, a link is the `hyperlink` text attribute.
 */
const KEY = "0123456789abcdef0123456789abcdef";
const DOC_LINK = { hyperlink: { href: `tinydocy:doc/${KEY}` } };
const WEB_LINK = { hyperlink: { href: "https://example.com" } };
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

interface Fixture {
  readonly ydoc: Y.Doc;
  readonly fragment: Y.XmlFragment;
  readonly heading: Y.XmlElement;
  readonly headingText: Y.XmlText;
  /** A paragraph with no links. */
  readonly plain: Y.XmlText;
  /** A paragraph holding one document link. */
  readonly linked: Y.XmlText;
  /** A paragraph holding one web link. */
  readonly webLinked: Y.XmlText;
}

function fixture(): Fixture {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const heading = new Y.XmlElement("heading");
  const headingText = new Y.XmlText();
  const blocks = [heading];
  const texts = [headingText, new Y.XmlText(), new Y.XmlText()];
  const webText = new Y.XmlText();
  heading.insert(0, [headingText]);
  for (const text of [...texts.slice(1), webText]) {
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [text]);
    blocks.push(paragraph);
  }
  fragment.insert(0, blocks);
  heading.setAttribute("data-toc-id", T1);
  heading.setAttribute("level", 1 as unknown as string);
  headingText.insert(0, "Title");
  const [, plain, linked] = texts;
  plain.insert(0, "Plain text.");
  linked.insert(0, "See ");
  linked.insert(4, "budget", DOC_LINK);
  linked.insert(10, " now.");
  webText.insert(0, "Visit ");
  webText.insert(6, "site", WEB_LINK);
  return {
    ydoc,
    fragment,
    heading,
    headingText,
    plain,
    linked,
    webLinked: webText,
  };
}

/** A fixture whose tracker has just been marked clean. */
function cleanFixture() {
  const f = fixture();
  const tracker = trackLinkChanges(f.fragment);
  tracker.markClean();
  return { ...f, tracker };
}

describe("trackLinkChanges", () => {
  it("starts dirty: the document was never scanned", () => {
    const { fragment } = fixture();
    const tracker = trackLinkChanges(fragment);
    expect(tracker.isDirty()).toBe(true);
    tracker.markClean();
    expect(tracker.isDirty()).toBe(false);
    tracker.dispose();
  });

  it("stays clean while typing in a paragraph with no links", () => {
    const { plain, tracker } = cleanFixture();
    plain.insert(5, "er");
    plain.insert(plain.length, " More.");
    expect(tracker.isDirty()).toBe(false);
    tracker.dispose();
  });

  it("stays clean for y-tiptap's write pattern in a link-free paragraph", () => {
    // y-tiptap's updateYText: delete(i, 0), insert with inherited
    // attributes, then applyDelta re-asserting every run's attributes.
    const { ydoc, plain, tracker } = cleanFixture();
    ydoc.transact(() => {
      plain.delete(5, 0);
      plain.insert(5, "x");
      plain.applyDelta([{ retain: plain.length, attributes: {} }]);
    });
    expect(tracker.isDirty()).toBe(false);
    tracker.dispose();
  });

  it("stays clean when bolding text in a link-free paragraph", () => {
    const { plain, tracker } = cleanFixture();
    plain.format(0, 5, { bold: {} });
    expect(tracker.isDirty()).toBe(false);
    tracker.dispose();
  });

  it("marks dirty when text carrying a hyperlink is inserted", () => {
    const { plain, tracker } = cleanFixture();
    plain.insert(0, "Q4", DOC_LINK);
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when text is formatted as a link", () => {
    const { plain, tracker } = cleanFixture();
    plain.format(0, 5, DOC_LINK);
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when a link is removed by formatting", () => {
    const { linked, tracker } = cleanFixture();
    linked.format(4, 6, { hyperlink: null });
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when typing inside a link", () => {
    const { linked, tracker } = cleanFixture();
    // Inherits the link's attributes, so the delta carries `hyperlink`.
    linked.insert(7, "x");
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when typing outside the link in a block that holds one", () => {
    // The row's `context` is that block's text.
    const { linked, tracker } = cleanFixture();
    linked.insert(0, "Please ", {});
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when typing in a block whose link sits in another text run", () => {
    // A hard break splits a block into two XmlTexts; context spans both.
    const { ydoc, fragment, tracker } = cleanFixture();
    const paragraph = new Y.XmlElement("paragraph");
    const first = new Y.XmlText();
    const second = new Y.XmlText();
    paragraph.insert(0, [first, new Y.XmlElement("hardBreak"), second]);
    fragment.push([paragraph]);
    first.insert(0, "doc", DOC_LINK);
    second.insert(0, "after");
    tracker.markClean();

    ydoc.transact(() => second.insert(5, "wards", {}));
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when typing beside a web link (any hyperlink counts)", () => {
    const { webLinked, tracker } = cleanFixture();
    webLinked.insert(0, "Do ", {});
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty on any deletion, even in a link-free paragraph", () => {
    // A deleted link can no longer be inspected, so every deletion counts.
    const { plain, tracker } = cleanFixture();
    plain.delete(0, 1);
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when a block is removed", () => {
    const { fragment, tracker } = cleanFixture();
    fragment.delete(2, 1);
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when a block is inserted (it may hold links or be a heading)", () => {
    const { fragment, tracker } = cleanFixture();
    fragment.push([new Y.XmlElement("paragraph")]);
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when a heading's data-toc-id changes", () => {
    const { heading, tracker } = cleanFixture();
    heading.setAttribute("data-toc-id", T2);
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when a heading's level changes", () => {
    const { heading, tracker } = cleanFixture();
    heading.setAttribute("level", 2 as unknown as string);
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty when a heading's text changes", () => {
    const { headingText, tracker } = cleanFixture();
    headingText.insert(5, " plan", {});
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("stays clean when a paragraph attribute changes", () => {
    const { fragment, tracker } = cleanFixture();
    const paragraph = fragment.get(1) as Y.XmlElement;
    paragraph.setAttribute("textAlign", "center");
    expect(tracker.isDirty()).toBe(false);
    tracker.dispose();
  });

  it("stays dirty until marked clean, then tracks again", () => {
    const { plain, linked, tracker } = cleanFixture();
    linked.insert(7, "x");
    plain.insert(0, "y");
    expect(tracker.isDirty()).toBe(true);
    tracker.markClean();
    plain.insert(0, "z");
    expect(tracker.isDirty()).toBe(false);
    linked.insert(7, "x");
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("marks dirty from a remote update", () => {
    const { ydoc, tracker } = cleanFixture();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
    const remoteText = (
      remote.getXmlFragment("default").get(1) as Y.XmlElement
    ).get(0) as Y.XmlText;
    remoteText.insert(0, "Q4", DOC_LINK);
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(remote, Y.encodeStateVector(ydoc)),
    );
    expect(tracker.isDirty()).toBe(true);
    tracker.dispose();
  });

  it("stops observing after dispose", () => {
    const { linked, tracker } = cleanFixture();
    tracker.dispose();
    linked.insert(7, "x");
    expect(tracker.isDirty()).toBe(false);
  });
});
