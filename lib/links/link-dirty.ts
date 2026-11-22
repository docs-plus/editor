/**
 * Says when an open document's derived rows (`deriveDocument`: links and
 * headings) may have changed, so the links pass can skip the walk while
 * nothing it reads was touched. Pure Yjs: no DOM, no storage.
 *
 * A transaction marks the document dirty when it:
 * - deletes anything: text, an atom or a whole block. A deleted link can't
 *   be inspected afterwards, so every deletion counts (this includes
 *   Backspace in a paragraph with no links; one extra pass is cheap);
 * - inserts a block or any other child element or text node. Yjs reports
 *   no events for the content of a type created in the same transaction,
 *   so a pasted paragraph or a new heading shows only as this insert (it
 *   also moves the section of every link after a new heading);
 * - inserts or formats text whose delta carries a `hyperlink` attribute
 *   (any href; `null` is a link being removed);
 * - inserts text into a block that holds a link (any href) in any of its
 *   text runs: the row's `context` is that block's text;
 * - changes a heading's text, `data-toc-id` (links' sections) or `level`.
 *
 * Plain typing (and other formatting) in a block with no links leaves it
 * clean. The tracker starts dirty: the document was never scanned.
 *
 * Call `markClean()` in the same synchronous step as `deriveDocument`:
 * an edit made between an async scan and `markClean()` would be lost.
 */
import * as Y from "yjs";

const LINK_MARK = "hyperlink";
const HEADING = "heading";
const HEADING_ATTRS = ["data-toc-id", "level"];

export interface LinkChangeTracker {
  isDirty(): boolean;
  markClean(): void;
  dispose(): void;
}

interface DeltaOp {
  readonly insert?: unknown;
  readonly retain?: number;
  readonly delete?: number;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export function trackLinkChanges(fragment: Y.XmlFragment): LinkChangeTracker {
  let dirty = true;
  const onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    // Once dirty, nothing more to learn until the next scan.
    if (dirty) return;
    dirty = events.some(touchesDerivedRows);
  };
  fragment.observeDeep(onChange);
  return {
    isDirty: () => dirty,
    markClean: () => {
      dirty = false;
    },
    dispose: () => fragment.unobserveDeep(onChange),
  };
}

/** Reads the event inside the observer: Yjs forbids it afterwards. */
function touchesDerivedRows(event: Y.YEvent<Y.AbstractType<unknown>>): boolean {
  const { target } = event;
  if (target instanceof Y.XmlText) return textChangeCounts(event, target);
  const { added, deleted } = event.changes;
  if (added.size > 0 || deleted.size > 0) return true;
  return (
    target instanceof Y.XmlElement &&
    target.nodeName === HEADING &&
    HEADING_ATTRS.some((name) => event.changes.keys.has(name))
  );
}

function textChangeCounts(
  event: Y.YEvent<Y.AbstractType<unknown>>,
  text: Y.XmlText,
): boolean {
  const delta = event.delta as DeltaOp[];
  let inserted = false;
  for (const op of delta) {
    if (op.delete !== undefined) return true;
    if (op.attributes && LINK_MARK in op.attributes) return true;
    if (op.insert !== undefined) inserted = true;
  }
  if (!inserted) return false;
  const block = text.parent;
  if (!(block instanceof Y.XmlElement)) return holdsLink(text);
  if (block.nodeName === HEADING) return true;
  return block
    .toArray()
    .some((child) => child instanceof Y.XmlText && holdsLink(child));
}

function holdsLink(text: Y.XmlText): boolean {
  return (text.toDelta() as DeltaOp[]).some(
    (op) => op.attributes?.[LINK_MARK] != null,
  );
}
