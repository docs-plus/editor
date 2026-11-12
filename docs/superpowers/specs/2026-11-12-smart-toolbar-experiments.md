# Smart toolbar — rollout experiments

Evidence for §3.1 of [the design](2026-11-12-smart-toolbar-design.md). Each script was run on 2026-11-12 from a scratch folder against this repo's `node_modules`:

```bash
NODE_PATH=/path/to/editor/node_modules bun <file>.ts
```

They are kept here as Markdown so lint and typecheck ignore them; PR B turns them into real tests.

## `invalid-content.ts`

```ts
// Old-schema client meets a new mark: with vs without onInvalidContent.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const Y = await import("yjs");
const { ySyncPlugin, ySyncPluginKey } = await import("@tiptap/y-tiptap");
const { Schema } = await import("prosemirror-model");
const { EditorState } = await import("prosemirror-state");
const { EditorView } = await import("prosemirror-view");

const nodes = {
  doc: { content: "paragraph+" },
  paragraph: { content: "text*", toDOM: () => ["p", 0] as any },
  text: {},
};
const oldSchema = new Schema({ nodes, marks: { bold: { toDOM: () => ["strong", 0] as any } } });

function makeShared() {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  p.insert(0, [t]);
  frag.insert(0, [p]);
  t.insert(0, "hello ");
  t.insert(6, "world", { textColor: { color: "red" } }); // mark unknown to old schema
  return doc;
}

function run(label: string, withHandler: boolean) {
  const server = makeShared();
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const outgoing: Uint8Array[] = [];
  client.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "remote") outgoing.push(u); });
  const errors: string[] = [];
  const opts = withHandler ? { onInvalidContent: (e: Error) => errors.push(e.message) } : {};
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({ schema: oldSchema, plugins: [ySyncPlugin(client.getXmlFragment("default"), opts)] }),
  });
  ySyncPluginKey.getState(view.state)?.binding?._forceRerender();
  const pmText = view.state.doc.textContent;
  // user types
  view.dispatch(view.state.tr.insertText("X", 1));
  for (const u of outgoing) Y.applyUpdate(server, u, "remote");
  const sharedText = server.getXmlFragment("default").toString();
  console.log(JSON.stringify({ label, pmText, errors, outgoingUpdates: outgoing.length, serverAfter: sharedText }));
  view.destroy();
}
run("no onInvalidContent (today's bundle)", false);
run("with onInvalidContent", true);
```

## `gate.ts`

```ts
// Old client (no ?schema param) refused in onConnect: does it retry, upload, or get reset?
const Y = await import("yjs");
const { Hocuspocus } = await import("@hocuspocus/server");
const { HocuspocusProvider, HocuspocusProviderWebsocket } = await import("@hocuspocus/provider");

let connects = 0, refused = 0;
const hp = new Hocuspocus({
  quiet: true,
  async onConnect({ documentName, requestParameters }) {
    connects++;
    if (documentName === "global-tabs") return;
    if (Number(requestParameters.get("schema") ?? 0) < 2) { refused++; throw Object.assign(new Error("client_outdated"), { reason: "client_outdated" }); }
  },
});
let sockets = 0, closes: string[] = [];
const server = Bun.serve<{ req: Request; c?: any }>({
  port: 0,
  fetch(req, s) { sockets++; s.upgrade(req, { data: { req: new Request(req.url, { headers: req.headers }) } }); return undefined; },
  websocket: {
    open(ws) { ws.data.c = hp.handleConnection(ws as any, ws.data.req); },
    message(ws, m) { ws.data.c.handleMessage(typeof m === "string" ? Buffer.from(m) : m); },
    close(ws, code, reason) { closes.push(`${code}:${reason}`); ws.data.c.handleClose({ code, reason }); },
  },
});
const url = `ws://127.0.0.1:${server.port}`;
const socket = new HocuspocusProviderWebsocket({ url }); // OLD client: no schema param
const tabsDoc = new Y.Doc();
const tabs = new HocuspocusProvider({ websocketProvider: socket, name: "global-tabs", document: tabsDoc });
tabs.attach();
const doc = new Y.Doc();
const failures: string[] = [];
const p = new HocuspocusProvider({ websocketProvider: socket, name: "doc-a", document: doc });
p.on("authenticationFailed", ({ reason }: any) => failures.push(reason));
p.attach();
await Bun.sleep(500);
console.log("after connect:", { connects, refused, failures, sockets, tabsSynced: tabs.isSynced });
// old client keeps typing locally (provider stays attached, as lib/collab-session.ts does for non-deleted reasons)
const t = doc.getText("t");
for (let i = 0; i < 1100; i++) { t.insert(t.length, "x"); if (i % 100 === 0) await Bun.sleep(5); }
await Bun.sleep(2500);
const serverDoc = hp.documents.get("doc-a");
console.log("after 1100 edits:", { connects, refused, failures: failures.length, sockets, closes, serverHasDocA: !!serverDoc, serverTextLen: serverDoc?.getText("t").length ?? 0 });
socket.destroy(); server.stop(true); process.exit(0);
```

## `extra-attr.ts`

```ts
// Old-schema client meets a new mark: with vs without onInvalidContent.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const Y = await import("yjs");
const { ySyncPlugin, ySyncPluginKey } = await import("@tiptap/y-tiptap");
const { Schema } = await import("prosemirror-model");
const { EditorState } = await import("prosemirror-state");
const { EditorView } = await import("prosemirror-view");

const nodes = {
  doc: { content: "paragraph+" },
  paragraph: { content: "text*", toDOM: () => ["p", 0] as any },
  text: {},
};
const oldSchema = new Schema({ nodes, marks: { textColor: { attrs: { color: { default: null } }, toDOM: () => ["span", 0] as any } } });

function makeShared() {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  p.insert(0, [t]);
  frag.insert(0, [p]);
  t.insert(0, "hello ");
  t.insert(6, "world", { textColor: { color: "red", weight: 2 } }); // mark unknown to old schema
  return doc;
}

function run(label: string, withHandler: boolean) {
  const server = makeShared();
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  const outgoing: Uint8Array[] = [];
  client.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "remote") outgoing.push(u); });
  const errors: string[] = [];
  const opts = withHandler ? { onInvalidContent: (e: Error) => errors.push(e.message) } : {};
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({ schema: oldSchema, plugins: [ySyncPlugin(client.getXmlFragment("default"), opts)] }),
  });
  ySyncPluginKey.getState(view.state)?.binding?._forceRerender();
  const pmText = view.state.doc.textContent;
  // user types
  view.dispatch(view.state.tr.insertText("X", 1)); console.log("pm:", view.state.doc.textContent);
  for (const u of outgoing) Y.applyUpdate(server, u, "remote");
  const sharedText = server.getXmlFragment("default").toString();
  console.log(JSON.stringify({ label, pmText, errors, outgoingUpdates: outgoing.length, serverAfter: sharedText }));
  view.destroy();
}

run("with onInvalidContent", true);
```

## `attrs.ts`

```ts
const { Schema } = await import("prosemirror-model");
const s = new Schema({ nodes: { doc: { content: "text*" }, text: {} }, marks: { textColor: { attrs: { color: { default: null } } } } });
const tryIt = (l: string, f: () => unknown) => { try { console.log(l, JSON.stringify(f())); } catch (e) { console.log(l, "THROWS", (e as Error).message); } };
tryIt("unknown attr key", () => s.mark("textColor", { color: "red", weight: 2 }).attrs);
tryIt("unknown token value", () => s.mark("textColor", { color: "cyan" }).attrs);
const s2 = new Schema({ nodes: { doc: { content: "text*" }, text: {} }, marks: { textColor: { attrs: { color: { default: null, validate: (v: unknown) => { if (v !== "red") throw new Error("bad token"); } } } } } });
tryIt("validate() on new token", () => s2.mark("textColor", { color: "cyan" }).attrs);
```
