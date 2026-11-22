/**
 * Convergence through what ships (comments design §10): live collaborative
 * editors, each with its own comments controller, make random edits,
 * comments, undos and redos while their updates are held back and
 * released at random. After a full sync, every controller's range for
 * every thread is what a fresh resolution from Yjs gives, and every client
 * resolves every thread the same way. Unlike the headless convergence
 * suite (`tests/unit/lib/comments/convergence.test.ts`, whose harness
 * re-resolves every thread after each update, as on open), the remote path
 * here is the controller's own: `tracker.remote` plus the threads failing.
 */
import { afterAll, describe, expect, it } from "bun:test";

import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";

import {
  attachComments,
  type CommentsController,
} from "@/extensions/comments/comments-controller";
import { COMMENTS_DEPS } from "@/extensions/comments/comments-deps";
import { DecorationHost } from "@/extensions/decoration-host/decoration-host";
import { resolveAnchors } from "@/lib/comments/anchors";
import { type Anchors, anchorKey } from "@/lib/comments/model";
import { readThreads } from "@/lib/comments/threads";

import {
  type CollabEditorFixture,
  createCollabEditor,
} from "../../helpers/collab-editor";
import {
  pickOne,
  randInt,
  randomDocument,
  randomTextRange,
  randomTransaction,
  seededRng,
} from "../../helpers/comment-fuzz-ops";

const SEEDS = 40;
const CLIENTS = 3;

const probe = createCollabEditor();
const schema = probe.schema;
probe.destroy();

interface Client {
  fixture: CollabEditorFixture;
  controller: CommentsController;
  paused: boolean;
}

function network(seed: number) {
  const rng = seededRng(seed);
  const server = prosemirrorJSONToYDoc(schema, randomDocument(rng), "default");
  // A clock that moves a minute per read keeps the client rates open.
  let clock = Date.UTC(2026, 10, 22);
  const now = () => {
    clock += 60_000;
    return clock;
  };
  const clients: Client[] = [];
  for (let index = 0; index < CLIENTS; index++) {
    const fixture = createCollabEditor({
      server,
      extensions: [
        DecorationHost.configure({ layers: [{ name: "comments", map: true }] }),
      ],
    });
    const letter = String.fromCharCode(65 + index);
    const controller = attachComments({
      editor: fixture.editor,
      doc: fixture.client,
      deps: COMMENTS_DEPS,
      canComment: () => true,
      identity: () => ({
        id: letter.repeat(22),
        name: `Writer ${letter}`,
        color: "#64B5F6",
      }),
      schedule: () => () => {},
      idle: (run) => {
        run();
        return () => {};
      },
      now,
    });
    clients.push({ fixture, controller, paused: false });
  }

  const act = () => {
    const client = pickOne(rng, clients);
    const { editor } = client.fixture;
    const roll = rng();
    if (roll < 0.5) {
      const next = randomTransaction(rng, editor.state);
      if (next) editor.view.dispatch(next.tr);
    } else if (roll < 0.65) {
      const range = randomTextRange(rng, editor.state.doc);
      if (!range) return;
      editor.commands.setTextSelection(range);
      client.controller.createFromSelection("A note");
    } else if (roll < 0.8) {
      editor.commands.undo();
    } else if (roll < 0.85) {
      editor.commands.redo();
    } else {
      // Hold this client's updates back, or release them.
      client.paused = !client.paused;
      if (client.paused) client.fixture.pause();
      else client.fixture.resume();
    }
    // A frame now and then; microtask re-anchors run in `flush` too.
    if (rng() < 0.5) client.controller.flush();
  };

  const settle = () => {
    for (const client of clients) {
      if (client.paused) client.fixture.resume();
      client.paused = false;
    }
    // A flush can write anchors that the others then resolve.
    for (let round = 0; round < 3; round++) {
      for (const client of clients) client.controller.flush();
    }
  };

  return { rng, clients, act, settle };
}

function freshView({ fixture, controller }: Client) {
  const binding = COMMENTS_DEPS.syncBinding(fixture.editor.state);
  if (!binding) throw new Error("no binding");
  const map = controller.store.map;
  const tracked = controller.getSnapshot().ranges;
  return readThreads(map).map(({ tid }) => {
    const anchors = map.get(anchorKey(tid)) as Anchors | undefined;
    const fresh = anchors
      ? resolveAnchors(COMMENTS_DEPS, binding, anchors)
      : null;
    return { tid, fresh, tracked: tracked.get(tid) ?? null };
  });
}

const opened: Client[][] = [];
afterAll(() => {
  for (const clients of opened) {
    for (const { controller, fixture } of clients) {
      controller.destroy();
      fixture.destroy();
    }
  }
});

describe("comment convergence through the controller", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}: every controller matches Yjs, and all agree`, () => {
      const { rng, clients, act, settle } = network(seed);
      opened.push(clients);
      const steps = randInt(rng, 25, 50);
      for (let step = 0; step < steps; step++) act();
      settle();
      const docs = clients.map(({ fixture }) =>
        fixture.editor.state.doc.toJSON(),
      );
      const views = clients.map(freshView);
      for (const view of views) {
        for (const { tid, fresh, tracked } of view) {
          expect({ tid, range: tracked }).toEqual({ tid, range: fresh });
        }
      }
      for (let index = 1; index < clients.length; index++) {
        expect(docs[index]).toEqual(docs[0]);
        expect(views[index].map(({ tid, fresh }) => ({ tid, fresh }))).toEqual(
          views[0].map(({ tid, fresh }) => ({ tid, fresh })),
        );
      }
    });
  }
});
