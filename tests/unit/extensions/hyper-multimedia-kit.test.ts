import { afterEach, describe, expect, it } from "bun:test";

import { Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";

import {
  HyperMultimediaKit,
  keepViewOnReconfigure,
} from "@/extensions/hyper-multimedia/hyper-multimedia-kit";

let editor: Editor | undefined;
afterEach(() => {
  if (editor && !editor.isDestroyed) editor.destroy();
  editor = undefined;
});

/** An editor with one plugin whose views count updates and destroys. */
function createCountingEditor() {
  const counts = { created: 0, updated: 0, destroyed: 0 };
  const plugin = new Plugin({
    key: new PluginKey("counted"),
    view: () => {
      counts.created += 1;
      return {
        update: () => {
          counts.updated += 1;
        },
        destroy: () => {
          counts.destroyed += 1;
        },
      };
    },
  });
  keepViewOnReconfigure(plugin);
  editor = new Editor({
    extensions: [
      StarterKit,
      Extension.create({
        name: "counted",
        addProseMirrorPlugins: () => [plugin],
      }),
    ],
  });
  return { editor, counts };
}

const probe = () => new Plugin({ key: new PluginKey("probe") });

describe("keepViewOnReconfigure", () => {
  it("skips destroy when another plugin registers or leaves", () => {
    const { editor, counts } = createCountingEditor();
    const created = counts.created;

    editor.registerPlugin(probe());
    editor.unregisterPlugin("probe");

    expect(counts.created).toBe(created + 2);
    expect(counts.destroyed).toBe(0);
  });

  it("forwards updates to the inner view", () => {
    const { editor, counts } = createCountingEditor();
    editor.commands.insertContent("Hello");
    expect(counts.updated).toBeGreaterThan(0);
  });

  it("destroys the view with the editor", () => {
    const { editor, counts } = createCountingEditor();
    editor.registerPlugin(probe());
    editor.destroy();
    expect(counts.destroyed).toBe(1);
  });

  it("destroys the view when its own plugin is removed", () => {
    const { editor, counts } = createCountingEditor();
    editor.unregisterPlugin("counted");
    expect(counts.destroyed).toBe(1);
  });

  it("leaves a plugin without a view alone", () => {
    const plugin = probe();
    keepViewOnReconfigure(plugin);
    expect(plugin.spec.view).toBeUndefined();
  });
});

describe("HyperMultimediaKit", () => {
  // The kit matches its media control extensions by name; an upstream
  // rename would silently bring back the hide on every plugin rebuild.
  it("still has the media control extensions it wraps", () => {
    editor = new Editor({ extensions: [StarterKit, HyperMultimediaKit] });
    const names = editor.extensionManager.extensions.map(({ name }) => name);
    expect(names).toContain("MediaResizeControls");
    expect(names).toContain("MediaResizeGripper");
  });
});
