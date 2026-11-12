import { describe, expect, it } from "bun:test";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { yXmlFragmentToProseMirrorFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { markNameFromKey } from "@/lib/schema-names";
import {
  findUnknownSchemaNames,
  repairKnownMisfit,
  SCHEMA_REPAIR_ORIGIN,
} from "@/lib/schema-repair";
import {
  type CollabEditorFixture,
  createCollabEditor,
} from "@/tests/helpers/collab-editor";

const tick = () => new Promise((r) => setTimeout(r, 0));
const fits = (f: ReturnType<typeof createCollabEditor>) =>
  f.schema.topNodeType.validContent(
    yXmlFragmentToProseMirrorFragment(f.fragment, f.schema),
  );

/** The app's tables and task lists, so their parts are known names. */
const FULL_SCHEMA = [TableKit, TaskList, TaskItem.configure({ nested: true })];

const serverXml = (f: CollabEditorFixture) =>
  f.server.getXmlFragment("default").toString();

/** The Yjs item of the seeded "hello world" paragraph, by identity. */
const helloItem = (f: CollabEditorFixture) =>
  f.fragment
    .toArray()
    .find((child) => child.toString().includes("hello world"));

/** Repairs, then checks the editor is unfrozen, valid and synced. */
function expectHealed(f: CollabEditorFixture): void {
  const hello = helloItem(f);
  expect(hello).toBeDefined();
  expect(repairKnownMisfit(f.fragment, f.schema)).not.toBe("none");
  expect(f.binding()?.invalidContentError).toBeNull();
  expect(f.editor.view.editable).toBe(true);
  expect(fits(f)).toBe(true);
  // untouched blocks keep their Yjs identity: no whole-document rewrite
  expect(helloItem(f)).toBe(hello);
  expect(serverXml(f)).toBe(f.fragment.toString());
  const sent = f.outgoing.length;
  f.editor.commands.insertContentAt(1, "X");
  expect(f.outgoing.length).toBeGreaterThan(sent);
  expect(serverXml(f)).toContain("X");
}

describe("B1: freeze on unknown names, repair known misfits", () => {
  it("freezes on an unknown mark, keeps the block and sends nothing", async () => {
    const f = createCollabEditor();
    // fragment index 1 is the "hello world" paragraph
    f.remote((frag) =>
      ((frag.get(1) as Y.XmlElement).get(0) as Y.XmlText).format(0, 5, {
        zzz: { v: 1 },
      }),
    );
    await tick();
    expect(f.errors).toHaveLength(1);
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expect(f.editor.view.editable).toBe(false);
    expect(findUnknownSchemaNames(f.fragment, f.schema)).toEqual(["zzz"]);
    const sent = f.outgoing.length;
    f.editor.view.dispatch(f.editor.state.tr.insertText("X", 1));
    expect(f.outgoing.length).toBe(sent);
    // toString renders marks as tags: the text and the unknown mark both survive
    expect(f.server.getXmlFragment("default").toString()).toContain(
      '<zzz v="1">hello</zzz> world',
    );
    f.destroy();
  });

  it("reads hashed mark keys by name", () => {
    expect(markNameFromKey("zzz--abcd1234")).toBe("zzz");
    expect(markNameFromKey("bold--AbC+/=12")).toBe("bold");
    expect(markNameFromKey("bold")).toBe("bold");
  });

  it("unfreezes after inserting a title before a leading paragraph", async () => {
    const f = createCollabEditor();
    f.remote((frag) => frag.insert(0, [new Y.XmlElement("paragraph")]));
    await tick();
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expect(findUnknownSchemaNames(f.fragment, f.schema)).toEqual([]);
    expect(repairKnownMisfit(f.fragment, f.schema)).toBe("inserted-title");
    expect(fits(f)).toBe(true); // gate (1)
    expect(f.binding()?.invalidContentError).toBeNull(); // gate (2): the hypothesis
    expect(f.editor.view.editable).toBe(true);
    const sent = f.outgoing.length;
    f.editor.commands.insertContentAt(1, "X");
    expect(f.outgoing.length).toBeGreaterThan(sent);
    expect(f.server.getXmlFragment("default").toString()).toContain("X");
    f.destroy();
  });

  it("unfreezes after delete-all is reseeded", async () => {
    const f = createCollabEditor();
    f.remote((frag) => frag.delete(0, frag.length));
    await tick();
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expect(repairKnownMisfit(f.fragment, f.schema)).toBe("seeded");
    expect(fits(f)).toBe(true);
    expect(f.binding()?.invalidContentError).toBeNull();
    f.destroy();
  });

  /** Raw top-level inserts of known names that the title rule alone can't fix. */
  const topLevelMisfits: [string, (frag: Y.XmlFragment) => void][] = [
    ["listItem", (frag) => frag.insert(1, [new Y.XmlElement("listItem")])],
    ["hardBreak", (frag) => frag.insert(1, [new Y.XmlElement("hardBreak")])],
    ["text", (frag) => frag.insert(1, [new Y.XmlElement("text")])],
    ["tableRow", (frag) => frag.insert(1, [new Y.XmlElement("tableRow")])],
    ["tableCell", (frag) => frag.insert(1, [new Y.XmlElement("tableCell")])],
    ["taskItem", (frag) => frag.insert(1, [new Y.XmlElement("taskItem")])],
  ];

  for (const [name, misfit] of topLevelMisfits) {
    it(`heals a top-level ${name}`, async () => {
      const f = createCollabEditor({ extensions: FULL_SCHEMA });
      f.remote(misfit);
      await tick();
      expect(f.binding()?.invalidContentError).not.toBeNull();
      expect(findUnknownSchemaNames(f.fragment, f.schema)).toEqual([]);
      expectHealed(f);
      f.destroy();
    });
  }

  it("keeps a top-level hard break, wrapped in a paragraph", async () => {
    const f = createCollabEditor();
    f.remote((frag) => frag.insert(1, [new Y.XmlElement("hardBreak")]));
    await tick();
    expect(repairKnownMisfit(f.fragment, f.schema)).toBe("fitted");
    expect(serverXml(f)).toBe(
      '<heading level="1">Title</heading><paragraph><hardbreak></hardbreak></paragraph><paragraph>hello world</paragraph>',
    );
    f.destroy();
  });

  /** A paragraph carrying an attribute this release does not know. */
  function futureParagraph(): Y.XmlElement {
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.setAttribute("futureAttr", "keep-me");
    paragraph.insert(0, [new Y.XmlText("future block")]);
    return paragraph;
  }
  const futureItem = (f: CollabEditorFixture) =>
    f.fragment
      .toArray()
      .find((child) => child.toString().includes("future block"));

  /** Sibling layouts around a block with an unknown attribute. */
  const siblingLayouts: [string, (frag: Y.XmlFragment) => void][] = [
    [
      "after a top-level hard break",
      (frag) => {
        frag.insert(1, [futureParagraph()]);
        frag.insert(1, [new Y.XmlElement("hardBreak")]);
      },
    ],
    [
      "between misfits that change the block count",
      (frag) => {
        // Two hard breaks share one paragraph: later blocks shift up.
        frag.insert(1, [
          new Y.XmlElement("hardBreak"),
          new Y.XmlElement("hardBreak"),
          futureParagraph(),
          new Y.XmlElement("hardBreak"),
        ]);
      },
    ],
  ];

  for (const [layout, misfit] of siblingLayouts) {
    it(`keeps an untouched sibling's unknown attribute ${layout}`, async () => {
      const f = createCollabEditor();
      f.remote(misfit);
      await tick();
      const future = futureItem(f);
      expect(future).toBeDefined();
      expect(repairKnownMisfit(f.fragment, f.schema)).toBe("fitted");
      expect(fits(f)).toBe(true);
      expect(futureItem(f)).toBe(future);
      expect(serverXml(f)).toContain(
        '<paragraph futureAttr="keep-me">future block</paragraph>',
      );
      f.destroy();
    });
  }

  it("heals a misfit nested in a list", async () => {
    const f = createCollabEditor({ extensions: FULL_SCHEMA });
    f.remote((frag) => {
      // bulletList > paragraph: the listItem in between is missing
      const list = new Y.XmlElement("bulletList");
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText("stray")]);
      list.insert(0, [paragraph]);
      frag.insert(2, [list]);
    });
    await tick();
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expectHealed(f);
    f.destroy();
  });

  it("heals a misfit nested in a table", async () => {
    const f = createCollabEditor({ extensions: FULL_SCHEMA });
    f.remote((frag) => {
      // table > tableRow > paragraph: the cell is missing
      const table = new Y.XmlElement("table");
      const row = new Y.XmlElement("tableRow");
      row.insert(0, [new Y.XmlElement("paragraph")]);
      table.insert(0, [row]);
      frag.insert(2, [table]);
    });
    await tick();
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expectHealed(f);
    f.destroy();
  });

  it("writes every repair under the repair origin", async () => {
    const f = createCollabEditor();
    f.remote((frag) => {
      frag.insert(1, [new Y.XmlElement("listItem")]);
      frag.insert(1, [new Y.XmlElement("hardBreak")]);
    });
    await tick();
    const origins: unknown[] = [];
    f.client.on("afterTransaction", (tr: Y.Transaction) => {
      const wrote = tr.changed.size > 0 || tr.deleteSet.clients.size > 0;
      if (tr.local && wrote) origins.push(tr.origin);
    });
    repairKnownMisfit(f.fragment, f.schema);
    expect(origins.length).toBeGreaterThan(0);
    // anything else (e.g. y-tiptap's own delete) would be undoable by the user
    expect(origins.every((origin) => origin === SCHEMA_REPAIR_ORIGIN)).toBe(
      true,
    );
    f.destroy();
  });

  it("drops top-level content that is not an element", () => {
    const f = createCollabEditor();
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const title = new Y.XmlElement<{ level: number }>("heading");
    title.setAttribute("level", 1);
    fragment.insert(0, [
      title as Y.XmlElement,
      new Y.XmlText("stray"),
      new Y.XmlElement("paragraph"),
    ]);
    expect(repairKnownMisfit(fragment, f.schema)).toBe("fitted");
    expect(fragment.toString()).toBe(
      '<heading level="1"></heading><paragraph></paragraph>',
    );
    f.destroy();
  });

  it("leaves content that already fits untouched", async () => {
    const f = createCollabEditor({ extensions: FULL_SCHEMA });
    await tick();
    const sent = f.outgoing.length;
    expect(repairKnownMisfit(f.fragment, f.schema)).toBe("none");
    expect(f.outgoing.length).toBe(sent);
    f.destroy();
  });

  it("concurrent repairs of a top-level hard break converge", async () => {
    const a = createCollabEditor();
    const b = createCollabEditor({ server: a.server });
    a.remote((frag) => frag.insert(1, [new Y.XmlElement("hardBreak")]));
    await tick();
    a.pause();
    b.pause();
    repairKnownMisfit(a.fragment, a.schema);
    repairKnownMisfit(b.fragment, b.schema);
    a.resume();
    b.resume();
    await tick();
    expect(a.fragment.toString()).toBe(b.fragment.toString());
    for (const f of [a, b]) {
      expect(fits(f)).toBe(true);
      expect(f.binding()?.invalidContentError).toBeNull();
      expect(f.editor.view.editable).toBe(true);
    }
    a.destroy();
    b.destroy();
  });

  it("concurrent repairs converge", async () => {
    const a = createCollabEditor();
    const b = createCollabEditor({ server: a.server });
    a.remote((frag) => frag.insert(0, [new Y.XmlElement("paragraph")]));
    await tick();
    expect(b.binding()?.invalidContentError).not.toBeNull();
    a.pause();
    b.pause();
    repairKnownMisfit(a.fragment, a.schema);
    repairKnownMisfit(b.fragment, b.schema);
    a.resume();
    b.resume();
    await tick();
    expect(a.fragment.toString()).toBe(b.fragment.toString());
    for (const f of [a, b]) {
      expect(fits(f)).toBe(true);
      expect(f.binding()?.invalidContentError).toBeNull();
    }
    a.destroy();
    b.destroy();
  });

  it("runs on one copy of y-tiptap ≥ 3.3.0", async () => {
    // the package's `exports` map blocks a `package.json` subpath import
    const { version } = await Bun.file(
      "node_modules/@tiptap/y-tiptap/package.json",
    ).json();
    expect(Bun.semver.satisfies(version, ">=3.3.0")).toBe(true);
    const pkg = await Bun.file("package.json").json();
    expect(
      Bun.semver.satisfies("3.2.9", pkg.dependencies["@tiptap/y-tiptap"]),
    ).toBe(false);
    const viaCollab = Bun.resolveSync(
      "@tiptap/y-tiptap",
      Bun.resolveSync("@tiptap/extension-collaboration", import.meta.dir),
    );
    expect(viaCollab).toBe(
      Bun.resolveSync("@tiptap/y-tiptap", import.meta.dir),
    );
  });
});
