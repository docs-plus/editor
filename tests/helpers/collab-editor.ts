import {
  type AnyExtension,
  Editor,
  getSchema,
  type JSONContent,
} from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import {
  type ProsemirrorBinding,
  prosemirrorJSONToYDoc,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { CollaborationRenderOnce } from "@/extensions/render-once";
import { TitleDocument } from "@/extensions/title-document";

const FIELD = "default";

const BASE_EXTENSIONS = [
  StarterKit.configure({
    document: false,
    undoRedo: false,
    link: false,
    code: false,
    trailingNode: { node: "paragraph" },
  }),
  TitleDocument,
];

const SEED: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
  ],
};

export interface CollabEditorFixture {
  schema: Schema;
  /** Stands in for the Hocuspocus document every fixture syncs through. */
  server: Y.Doc;
  client: Y.Doc;
  /** The client's editor fragment. */
  fragment: Y.XmlFragment;
  editor: Editor;
  /** Errors passed to `onInvalidContent`. */
  errors: Error[];
  /** Client updates sent towards the server (all origins but the server). */
  outgoing: Uint8Array[];
  binding(): ProsemirrorBinding | undefined;
  /** Edits the server's fragment, as another collaborator would. */
  remote(fn: (frag: Y.XmlFragment) => void): void;
  /** Queues updates in both directions until `resume`. */
  pause(): void;
  resume(): void;
  destroy(): void;
}

/**
 * Collaborative editor wired to an in-memory "server" Y.Doc, both ways.
 * Several fixtures can share one `server` and see each other's writes.
 */
export function createCollabEditor(
  options: {
    server?: Y.Doc;
    /** Also called with every error passed to `onInvalidContent`. */
    onInvalidContent?: (error: Error) => void;
    /** Added to the StarterKit + title-first schema (tables, task lists…). */
    extensions?: AnyExtension[];
  } = {},
): CollabEditorFixture {
  const extensions = [...BASE_EXTENSIONS, ...(options.extensions ?? [])];
  const schema = getSchema(extensions);
  const server = options.server ?? prosemirrorJSONToYDoc(schema, SEED, FIELD);
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server), server);

  const errors: Error[] = [];
  const outgoing: Uint8Array[] = [];
  let paused = false;
  let toServer: Uint8Array[] = [];
  let toClient: Uint8Array[] = [];

  const sendToServer = (update: Uint8Array) =>
    Y.applyUpdate(server, update, client);
  const sendToClient = (update: Uint8Array) =>
    Y.applyUpdate(client, update, server);

  const onClientUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === server) return;
    outgoing.push(update);
    if (paused) toServer.push(update);
    else sendToServer(update);
  };
  const onServerUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === client) return;
    if (paused) toClient.push(update);
    else sendToClient(update);
  };
  client.on("update", onClientUpdate);
  server.on("update", onServerUpdate);

  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      ...extensions,
      CollaborationRenderOnce.configure({
        document: client,
        ySyncOptions: {
          onInvalidContent: (e: Error) => {
            errors.push(e);
            options.onInvalidContent?.(e);
          },
        },
      }),
    ],
  });

  return {
    schema,
    server,
    client,
    fragment: client.getXmlFragment(FIELD),
    editor,
    errors,
    outgoing,
    binding: () => ySyncPluginKey.getState(editor.state)?.binding,
    remote: (fn) => server.transact(() => fn(server.getXmlFragment(FIELD))),
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      const [up, down] = [toServer, toClient];
      toServer = [];
      toClient = [];
      for (const update of up) sendToServer(update);
      for (const update of down) sendToClient(update);
    },
    destroy: () => {
      editor.destroy();
      client.off("update", onClientUpdate);
      server.off("update", onServerUpdate);
      client.destroy();
    },
  };
}
