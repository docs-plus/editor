/**
 * Comment limits (comments design §4.2), the one constants module. The
 * client refuses first, below the server's hard limits, so an honest
 * client never produces an update the server rejects: a rejected update
 * stays pending, is resent, and reconnect loops get IPs banned (K4).
 */
export interface CommentLimits {
  /** UTF-16 units. */
  body: number;
  quote: number;
  suggestion: number;
  /** After cleaning. */
  name: number;
  anchorBytes: number;
  threads: number;
  messagesPerThread: number;
  messages: number;
  /** Encoded size of the live values (`measure.ts`). */
  bytes: number;
}

/** What the UI refuses. */
export const CLIENT_LIMITS: CommentLimits = {
  body: 2_000,
  quote: 280,
  suggestion: 2_000,
  name: 40,
  anchorBytes: 64,
  threads: 300,
  messagesPerThread: 100,
  messages: 3_000,
  bytes: 320 * 1024,
};

/** What the server rejects (P4.2f-2): slack over the client for races. */
export const SERVER_LIMITS: CommentLimits = {
  body: 2_000,
  quote: 300,
  suggestion: 2_000,
  name: 40,
  anchorBytes: 64,
  threads: 320,
  messagesPerThread: 120,
  messages: 3_200,
  bytes: 384 * 1024,
};

/** Honest-client rates per minute; the server's are 10 and 40 (§7.4). */
export const CLIENT_RATES = { threads: 6, messages: 20 } as const;

/** The earliest claimed time either side accepts: 2026-01-01T00:00:00Z. */
export const EARLIEST_TIME = Date.UTC(2026, 0, 1);
/** How far past the clock a claimed time may run. */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
