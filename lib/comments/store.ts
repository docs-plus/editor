/**
 * The comment store (comments design §4–§6, §9.1): every write to the
 * `comments` map goes through here. Each write is one `transact` with
 * `COMMENT_ORIGIN`, outside the editor's undo stack, and runs
 * `canComment()` and the client limits BEFORE it: an update that exists
 * must never be dropped (details rule 1), and an honest client never
 * produces one the server rejects (§4.2).
 */
import type * as Y from "yjs";

import { cleanBody } from "@/lib/comments/clean";
import {
  CLIENT_LIMITS,
  CLIENT_RATES,
  type CommentLimits,
} from "@/lib/comments/limits";
import { countComments, entryBytes } from "@/lib/comments/measure";
import {
  type Anchors,
  type Author,
  anchorKey,
  COMMENT_ORIGIN,
  COMMENTS_ROOT,
  type CommentValue,
  type Id,
  isDeletedMessage,
  type Message,
  messageKey,
  newId,
  parseKey,
  type Status,
  statusKey,
  THREAD_VERSION,
  type ThreadHead,
  threadKey,
} from "@/lib/comments/model";

export type CommentRefusal =
  /** `canComment()` is false: view link, kind, feature switch, read-only. */
  | "not-allowed"
  | "empty"
  | "too-long"
  | "threads-full"
  | "replies-full"
  | "messages-full"
  | "storage-full"
  | "rate"
  | "missing"
  /** Someone else's message, and this window may not manage all. */
  | "not-own"
  /** A thread from a newer TinyDocy: read-only here. */
  | "newer";

export type CommentResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: CommentRefusal };

/** A thread's keys and values, kept in memory for the Undo pill (§9.1). */
export type RemovedEntries = readonly (readonly [string, CommentValue])[];

export interface CommentStoreOptions {
  doc: Y.Doc;
  /** Read before every write; pass a function over a ref. */
  canComment: () => boolean;
  /**
   * The sharer, or the owner of a Local or library document: may delete
   * any message or thread (§6.1). Defaults to never.
   */
  canManageAll?: () => boolean;
  /** This window's author, already cleaned (`cleanAuthorName`). */
  author: () => Author;
  now?: () => number;
  limits?: CommentLimits;
  rates?: { threads: number; messages: number };
}

export interface CommentStore {
  readonly map: Y.Map<CommentValue>;
  create(input: {
    anchors: Pick<Anchors, "s" | "e">;
    quote: string;
    body: string;
  }): CommentResult<{ tid: Id }>;
  reply(tid: Id, body: string): CommentResult<{ mid: Id }>;
  edit(tid: Id, mid: Id, body: string): CommentResult;
  /** The opening message deletes the thread (the head needs it). */
  deleteMessage(tid: Id, mid: Id): CommentResult;
  deleteThread(tid: Id): CommentResult<{ removed: RemovedEntries }>;
  /** Undo of a delete: re-sets the keys missing now, never overwrites. */
  restore(removed: RemovedEntries): CommentResult;
  setResolved(tid: Id, resolved: boolean): CommentResult;
  /**
   * Writes `{ s, e }` and a fallback pair `ps`/`pe` (§5.2). Never capped
   * (§7.3).
   * - `"reanchor"` (after a structural edit) keeps the pair the thread had
   *   before its FIRST re-anchor: undo restores that text (Yjs
   *   `followRedone`), and after two structural edits the pair before the
   *   second is gone too. Measured by the anchor fuzz: keeping the latest
   *   pair failed 321 of 31,584 threads after undoing everything; keeping
   *   the first fails 5 untrimmed ones (comments design §5.3, amended).
   * - `"reattach"` (Re-attach to selection) keeps the current pair: the
   *   person moved the thread on purpose.
   */
  setAnchors(
    tid: Id,
    next: Pick<Anchors, "s" | "e">,
    mode: "reanchor" | "reattach",
  ): CommentResult;
}

const refuse = (reason: CommentRefusal) => ({ ok: false, reason }) as const;

export function createCommentStore({
  doc,
  canComment,
  canManageAll = () => false,
  author,
  now = Date.now,
  limits = CLIENT_LIMITS,
  rates = CLIENT_RATES,
}: CommentStoreOptions): CommentStore {
  const map = doc.getMap<CommentValue>(COMMENTS_ROOT);
  const recentThreads: number[] = [];
  const recentMessages: number[] = [];

  /** Whether one more write fits the per-minute rate (callers record it). */
  function withinRate(log: number[], max: number, at: number): boolean {
    while (log.length && log[0] <= at - 60_000) log.shift();
    return log.length < max;
  }

  function checkBody(raw: string): CommentResult<{ body: string }> {
    const body = cleanBody(raw);
    if (!body) return refuse("empty");
    if (body.length > limits.body) return refuse("too-long");
    return { ok: true, body };
  }

  const head = (tid: Id) => map.get(threadKey(tid)) as ThreadHead | undefined;

  function messagesIn(tid: Id): number {
    let count = 0;
    for (const key of map.keys()) {
      if (key.startsWith(`m:${tid}:`)) count++;
    }
    return count;
  }

  /** Refuses a write that would cross a cap (net live counts after it). */
  function capRefusal(
    entries: readonly (readonly [string, CommentValue])[],
    newThread: boolean,
    tid: Id,
  ): CommentRefusal | null {
    const counts = countComments(map);
    if (newThread && counts.threads >= limits.threads) return "threads-full";
    const added = entries.filter(([key]) => !map.has(key));
    const newMessages = added.filter(([key]) => key.startsWith("m:")).length;
    if (counts.messages + newMessages > limits.messages) return "messages-full";
    if (messagesIn(tid) + newMessages > limits.messagesPerThread) {
      return "replies-full";
    }
    let bytes = counts.bytes;
    for (const [key, value] of entries) {
      const old = map.get(key);
      if (old !== undefined) bytes -= entryBytes(key, old);
      bytes += entryBytes(key, value);
    }
    return bytes > limits.bytes ? "storage-full" : null;
  }

  function write(fn: () => void): void {
    doc.transact(fn, COMMENT_ORIGIN);
  }

  /** The thread a write targets: present, and not from a newer version. */
  function writable(tid: Id): CommentRefusal | null {
    if (!canComment()) return "not-allowed";
    const thread = head(tid);
    if (!thread) return "missing";
    return thread.v > THREAD_VERSION ? "newer" : null;
  }

  function messageOf(tid: Id, mid: Id): Message | undefined {
    return map.get(messageKey(tid, mid)) as Message | undefined;
  }

  function deleteThread(tid: Id): CommentResult<{ removed: RemovedEntries }> {
    if (!canComment()) return refuse("not-allowed");
    const thread = head(tid);
    if (!thread) return refuse("missing");
    if (thread.au.id !== author().id && !canManageAll()) {
      return refuse("not-own");
    }
    const removed: (readonly [string, CommentValue])[] = [];
    for (const [key, value] of map.entries()) {
      if (parseKey(key)?.tid === tid) removed.push([key, value]);
    }
    write(() => {
      for (const [key] of removed) map.delete(key);
    });
    return { ok: true, removed };
  }

  return {
    map,

    create({ anchors, quote, body: raw }) {
      if (!canComment()) return refuse("not-allowed");
      const checked = checkBody(raw);
      if (!checked.ok) return checked;
      if (!quote) return refuse("empty");
      const at = now();
      if (
        !withinRate(recentThreads, rates.threads, at) ||
        !withinRate(recentMessages, rates.messages, at)
      ) {
        return refuse("rate");
      }
      const tid = newId();
      const au = author();
      const entries = [
        [
          threadKey(tid),
          { v: THREAD_VERSION, q: quote, c: at, au } satisfies ThreadHead,
        ],
        [anchorKey(tid), { s: anchors.s, e: anchors.e } satisfies Anchors],
        [
          messageKey(tid, tid),
          { au, b: checked.body, c: at } satisfies Message,
        ],
      ] as const;
      const capped = capRefusal(entries, true, tid);
      if (capped) return refuse(capped);
      recentThreads.push(at);
      recentMessages.push(at);
      write(() => {
        for (const [key, value] of entries) map.set(key, value);
      });
      return { ok: true, tid };
    },

    reply(tid, raw) {
      const blocked = writable(tid);
      if (blocked) return refuse(blocked);
      const checked = checkBody(raw);
      if (!checked.ok) return checked;
      const at = now();
      if (!withinRate(recentMessages, rates.messages, at))
        return refuse("rate");
      const mid = newId();
      const entry = [
        messageKey(tid, mid),
        { au: author(), b: checked.body, c: at } satisfies Message,
      ] as const;
      const capped = capRefusal([entry], false, tid);
      if (capped) return refuse(capped);
      recentMessages.push(at);
      write(() => map.set(...entry));
      return { ok: true, mid };
    },

    edit(tid, mid, raw) {
      const blocked = writable(tid);
      if (blocked) return refuse(blocked);
      const message = messageOf(tid, mid);
      if (!message || isDeletedMessage(message)) return refuse("missing");
      if (message.au.id !== author().id) return refuse("not-own");
      const checked = checkBody(raw);
      if (!checked.ok) return checked;
      const at = now();
      if (!withinRate(recentMessages, rates.messages, at))
        return refuse("rate");
      // The original author and time stay: the server checks both.
      const entry = [
        messageKey(tid, mid),
        { au: message.au, b: checked.body, c: message.c, ed: at },
      ] as const;
      const capped = capRefusal([entry], false, tid);
      if (capped) return refuse(capped);
      recentMessages.push(at);
      write(() => map.set(...entry));
      return { ok: true };
    },

    deleteMessage(tid, mid) {
      if (mid === tid) {
        const result = deleteThread(tid);
        return result.ok ? { ok: true } : result;
      }
      if (!canComment()) return refuse("not-allowed");
      const message = messageOf(tid, mid);
      if (!message || isDeletedMessage(message)) return refuse("missing");
      if (message.au.id !== author().id && !canManageAll()) {
        return refuse("not-own");
      }
      // The marker keeps the original `au` and `c` (same-author check).
      const marker: Message = { au: message.au, c: message.c, del: true };
      write(() => map.set(messageKey(tid, mid), marker));
      return { ok: true };
    },

    deleteThread,

    restore(removed) {
      if (!canComment()) return refuse("not-allowed");
      const missing = removed.filter(([key]) => !map.has(key));
      if (!missing.length) return { ok: true };
      const first = parseKey(missing[0][0]);
      const tid = first?.tid ?? "";
      const capped = capRefusal(
        missing,
        missing.some(([key]) => key.startsWith("t:")),
        tid,
      );
      if (capped) return refuse(capped);
      write(() => {
        for (const [key, value] of missing) map.set(key, value);
      });
      return { ok: true };
    },

    setResolved(tid, resolved) {
      const blocked = writable(tid);
      if (blocked) return refuse(blocked);
      const status = map.get(statusKey(tid)) as Status | undefined;
      if ((status?.r ?? false) === resolved) return { ok: true };
      const next: Status = { r: resolved, at: now(), by: author() };
      write(() => map.set(statusKey(tid), next));
      return { ok: true };
    },

    setAnchors(tid, { s, e }, mode) {
      const blocked = writable(tid);
      if (blocked) return refuse(blocked);
      const old = map.get(anchorKey(tid)) as Anchors | undefined;
      const keep = mode === "reanchor" && old?.ps && old.pe;
      const next: Anchors = !old
        ? { s, e }
        : keep
          ? { s, e, ps: old.ps, pe: old.pe }
          : { s, e, ps: old.s, pe: old.e };
      write(() => map.set(anchorKey(tid), next));
      return { ok: true };
    },
  };
}
