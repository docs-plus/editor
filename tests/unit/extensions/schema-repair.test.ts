import { describe, expect, it } from "bun:test";

import { yXmlFragmentToProseMirrorFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { markNameFromKey } from "@/lib/schema-names";
import { findUnknownSchemaNames, repairKnownMisfit } from "@/lib/schema-repair";
import { createCollabEditor } from "@/tests/helpers/collab-editor";

const tick = () => new Promise((r) => setTimeout(r, 0));
const fits = (f: ReturnType<typeof createCollabEditor>) =>
  f.schema.topNodeType.validContent(
    yXmlFragmentToProseMirrorFragment(f.fragment, f.schema),
  );

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
    expect(repairKnownMisfit(f.fragment)).toBe("inserted-title");
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
    expect(repairKnownMisfit(f.fragment)).toBe("seeded");
    expect(fits(f)).toBe(true);
    expect(f.binding()?.invalidContentError).toBeNull();
    f.destroy();
  });

  it("reports a known misfit it cannot fix", async () => {
    const f = createCollabEditor();
    f.remote((frag) => frag.insert(1, [new Y.XmlElement("listItem")]));
    await tick();
    expect(findUnknownSchemaNames(f.fragment, f.schema)).toEqual([]);
    expect(repairKnownMisfit(f.fragment)).toBe("none");
    expect(f.binding()?.invalidContentError).not.toBeNull();
    f.destroy();
  });

  it("concurrent repairs converge", async () => {
    const a = createCollabEditor();
    const b = createCollabEditor({ server: a.server });
    a.remote((frag) => frag.insert(0, [new Y.XmlElement("paragraph")]));
    await tick();
    expect(b.binding()?.invalidContentError).not.toBeNull();
    a.pause();
    b.pause();
    repairKnownMisfit(a.fragment);
    repairKnownMisfit(b.fragment);
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
