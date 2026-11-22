/**
 * Reading the flat model back as threads (comments design §4.1). Messages
 * are grouped by the thread id in their key and sorted by `c`, then id. A
 * key whose `t:` head is missing (a reply that raced a delete) is an
 * orphan and is ignored; the server drops orphans when a document loads.
 */
import {
  type Anchors,
  type Id,
  type Message,
  parseKey,
  type Status,
  THREAD_VERSION,
  type ThreadHead,
} from "@/lib/comments/model";

export type ThreadMessage = Message & { mid: Id };

export interface Thread {
  tid: Id;
  head: ThreadHead;
  anchors: Anchors | null;
  status: Status | null;
  messages: ThreadMessage[];
  /** Made by a newer TinyDocy (`v` above ours): shown read-only. */
  newer: boolean;
}

/** Anything shaped like a `Y.Map` of comment values. */
export interface CommentMapLike {
  get(key: string): unknown;
  forEach(fn: (value: unknown, key: string) => void): void;
}

const byTimeThenId = (a: ThreadMessage, b: ThreadMessage) =>
  a.c - b.c || (a.mid < b.mid ? -1 : a.mid > b.mid ? 1 : 0);

function emptyThread(tid: Id, head: ThreadHead): Thread {
  return {
    tid,
    head,
    anchors: null,
    status: null,
    messages: [],
    newer: head.v > THREAD_VERSION,
  };
}

/** Every thread with a head, in creation order (`c`, then id). */
export function readThreads(map: CommentMapLike): Thread[] {
  const threads = new Map<Id, Thread>();
  const rest: [ReturnType<typeof parseKey>, unknown][] = [];
  map.forEach((value, key) => {
    const parsed = parseKey(key);
    if (parsed?.kind === "t") {
      threads.set(parsed.tid, emptyThread(parsed.tid, value as ThreadHead));
    } else if (parsed) rest.push([parsed, value]);
  });
  for (const [parsed, value] of rest) {
    const thread = parsed && threads.get(parsed.tid);
    if (!thread || !parsed) continue;
    if (parsed.kind === "a") thread.anchors = value as Anchors;
    else if (parsed.kind === "s") thread.status = value as Status;
    else if (parsed.kind === "m") {
      thread.messages.push({ ...(value as Message), mid: parsed.mid });
    }
  }
  const list = [...threads.values()];
  for (const thread of list) thread.messages.sort(byTimeThenId);
  return list.sort(
    (a, b) =>
      a.head.c - b.head.c || (a.tid < b.tid ? -1 : a.tid > b.tid ? 1 : 0),
  );
}

/** The thread ids a set of changed keys belongs to. */
export function threadIdsOf(keys: Iterable<string>): Set<Id> {
  const ids = new Set<Id>();
  for (const key of keys) {
    const parsed = parseKey(key);
    if (parsed) ids.add(parsed.tid);
  }
  return ids;
}

export const isOpen = (thread: Thread): boolean => !thread.status?.r;
