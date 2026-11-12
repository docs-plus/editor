import { afterEach, describe, expect, it, vi } from "bun:test";

import * as Y from "yjs";

import {
  createSchemaGuard,
  type SchemaGuard,
  type SchemaGuardOptions,
} from "@/lib/schema-guard";
import {
  type CollabEditorFixture,
  createCollabEditor,
} from "@/tests/helpers/collab-editor";

/** Long enough for a 0 ms repair delay plus the observer's deferred check. */
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

type Setup = {
  f: CollabEditorFixture;
  guard: SchemaGuard;
  onRepairFailed: ReturnType<typeof vi.fn>;
  unbind: () => void;
  setWritable(writable: boolean): void;
};

const fixtures: CollabEditorFixture[] = [];

function setup(
  options: {
    repairDelayMs?: number;
    server?: Y.Doc;
    repair?: SchemaGuardOptions["repair"];
  } = {},
): Setup {
  let guard: SchemaGuard | undefined;
  const f = createCollabEditor({
    server: options.server,
    onInvalidContent: (error) => guard?.onInvalidContent(error),
  });
  fixtures.push(f);
  const onRepairFailed = vi.fn();
  guard = createSchemaGuard(f.fragment, {
    repairDelayMs: () => options.repairDelayMs ?? 0,
    onRepairFailed,
    repair: options.repair,
  });
  let writable = true;
  const unbind = guard.bind({ editor: f.editor, canWrite: () => writable });
  return {
    f,
    guard,
    onRepairFailed,
    unbind,
    setWritable: (next) => {
      writable = next;
    },
  };
}

const paragraphFirst = (frag: Y.XmlFragment) =>
  frag.insert(0, [new Y.XmlElement("paragraph")]);

/** Puts the unknown mark `zzz` on "hello" (fragment index 1). */
const unknownMark = (frag: Y.XmlFragment, value: unknown = { v: 1 }) =>
  ((frag.get(1) as Y.XmlElement).get(0) as Y.XmlText).format(0, 5, {
    zzz: value,
  });

afterEach(() => {
  for (const f of fixtures) f.destroy();
  fixtures.length = 0;
});

describe("schema guard", () => {
  it("records only: nothing is written before the delay", async () => {
    const { f, guard } = setup({ repairDelayMs: 20 });
    const sent = f.outgoing.length;
    f.remote(paragraphFirst);
    expect(f.errors).toHaveLength(1);
    expect(f.outgoing.length).toBe(sent);
    expect(guard.getState()).toBe("ok");
    await settle(40);
    expect(f.outgoing.length).toBeGreaterThan(sent);
  });

  it("goes outdated on unknown names and writes nothing", async () => {
    const { f, guard } = setup();
    const listener = vi.fn();
    guard.subscribe(listener);
    const sent = f.outgoing.length;
    f.remote(unknownMark);
    await settle();
    expect(guard.getState()).toBe("outdated");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(f.outgoing.length).toBe(sent);
    expect(f.binding()?.invalidContentError).not.toBeNull();
  });

  it("repairs a paragraph before the title and stays ok", async () => {
    const { f, guard, onRepairFailed } = setup();
    f.remote(paragraphFirst);
    await settle();
    expect(guard.getState()).toBe("ok");
    expect(f.binding()?.invalidContentError).toBeNull();
    const first = f.server.getXmlFragment("default").get(0) as Y.XmlElement;
    expect(first.nodeName).toBe("heading");
    expect(onRepairFailed).not.toHaveBeenCalled();
  });

  it("heals a top-level list item instead of locking the document", async () => {
    const { f, guard, onRepairFailed } = setup();
    f.remote((frag) => frag.insert(1, [new Y.XmlElement("listItem")]));
    await settle();
    expect(guard.getState()).toBe("ok");
    expect(f.binding()?.invalidContentError).toBeNull();
    expect(f.editor.view.editable).toBe(true);
    expect(f.server.getXmlFragment("default").toString()).toBe(
      '<heading level="1">Title</heading><paragraph>hello world</paragraph>',
    );
    expect(onRepairFailed).not.toHaveBeenCalled();
  });

  it("reports unrepairable once", async () => {
    const { guard, f, onRepairFailed } = setup({ repair: () => "none" });
    f.remote((frag) => frag.insert(1, [new Y.XmlElement("listItem")]));
    await settle();
    expect(guard.getState()).toBe("unrepairable");
    expect(onRepairFailed).toHaveBeenCalledTimes(1);
    f.remote((frag) => frag.insert(1, [new Y.XmlElement("listItem")]));
    await settle();
    expect(guard.getState()).toBe("unrepairable");
    expect(onRepairFailed).toHaveBeenCalledTimes(1);
  });

  it("reports a repair that throws as unrepairable", async () => {
    const { guard, f, onRepairFailed } = setup({
      repair: () => {
        throw new Error("boom");
      },
    });
    f.remote((frag) => frag.insert(1, [new Y.XmlElement("listItem")]));
    await settle();
    expect(guard.getState()).toBe("unrepairable");
    expect(onRepairFailed).toHaveBeenCalledTimes(1);
  });

  it("does not write when another client already repaired", async () => {
    const { f, guard } = setup({ repairDelayMs: 50 });
    const sent = f.outgoing.length;
    f.remote(paragraphFirst);
    // Another collaborator's guard repairs first.
    f.remote((frag) => {
      const title = new Y.XmlElement<{ level: number }>("heading");
      title.setAttribute("level", 1);
      frag.insert(0, [title as Y.XmlElement]);
    });
    expect(f.binding()?.invalidContentError).toBeNull();
    await settle(80);
    expect(guard.getState()).toBe("ok");
    expect(f.outgoing.length).toBe(sent);
  });

  it("returns to ok when the unknown content is removed remotely", async () => {
    const { f, guard } = setup();
    f.remote(unknownMark);
    await settle();
    expect(guard.getState()).toBe("outdated");
    f.remote((frag) => unknownMark(frag, null));
    await settle();
    expect(f.binding()?.invalidContentError).toBeNull();
    expect(guard.getState()).toBe("ok");
  });

  it("does not repair while the document is refused", async () => {
    const { f, guard, setWritable, onRepairFailed } = setup();
    setWritable(false);
    const sent = f.outgoing.length;
    f.remote(paragraphFirst);
    await settle();
    expect(f.outgoing.length).toBe(sent);
    expect(guard.getState()).toBe("ok");
    expect(f.binding()?.invalidContentError).not.toBeNull();
    expect(onRepairFailed).not.toHaveBeenCalled();
  });

  it("evaluates content that was already invalid when it binds", async () => {
    const server = new Y.Doc();
    const frag = server.getXmlFragment("default");
    const title = new Y.XmlElement<{ level: number }>("heading");
    title.setAttribute("level", 1);
    frag.insert(0, [title as Y.XmlElement]);
    paragraphFirst(frag);
    const { f, guard } = setup({ server });
    expect(f.errors).toHaveLength(1);
    await settle();
    expect(guard.getState()).toBe("ok");
    expect(f.binding()?.invalidContentError).toBeNull();
  });

  it("cleans up on unbind", async () => {
    const { f, guard, unbind } = setup({ repairDelayMs: 20 });
    f.remote(paragraphFirst);
    const sent = f.outgoing.length;
    unbind();
    await settle(40);
    expect(f.outgoing.length).toBe(sent);
    f.remote(unknownMark);
    await settle(40);
    expect(guard.getState()).toBe("ok");
    expect(f.outgoing.length).toBe(sent);
  });

  it("stops watching the fragment once unbound while frozen", async () => {
    const { f, guard, unbind } = setup();
    f.remote(unknownMark);
    await settle();
    expect(guard.getState()).toBe("outdated");
    unbind();
    f.remote((frag) => unknownMark(frag, null));
    await settle();
    expect(guard.getState()).toBe("outdated");
  });
});
