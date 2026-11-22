/**
 * The desktop dev bridge's wire format (architecture §11, P2.4b): the
 * renderer under `next dev` talks to `desktop/dev/storage-host.ts` over a
 * loopback WebSocket, as the packaged renderer talks to main.
 *
 * The ops are P2.6's `DocStoreCalls` (`lib/platform/desktop/rpc-doc-store.ts`
 * on #125): same names, same argument shapes, no `owner` (the host assigns
 * one per connection, as main does per window). `create` is dev only: it
 * stands in for `DocumentIndex.create`, because the engine refuses to load
 * a document nothing created (`not_found`).
 *
 * A frame is binary: a 4-byte big-endian header length, the header as JSON
 * with each `Uint8Array` replaced by `{ "$bytes": n }`, then each blob as a
 * 4-byte length and its bytes. Replies never throw: they carry a `Result`.
 *
 * No imports: the host (Bun, `desktop/dev/`) and the renderer (browser) both
 * load it. It lives in `lib/` because `lib/` may import only types from
 * `desktop/` (architecture §3.3).
 */

export const DEV_BRIDGE_OPS = [
  "create",
  "load",
  "append",
  "compact",
  "close",
  "flush",
] as const;
export type DevBridgeOp = (typeof DEV_BRIDGE_OPS)[number];

/**
 * In the bridge's error messages, so it survives minification: the desktop
 * export check fails if a release renderer contains it (architecture §11).
 */
export const DEV_BRIDGE_MARKER = "tinydocy-dev-bridge-renderer";

/** The WebSocket subprotocol; the token follows the dot. */
export const DEV_BRIDGE_PROTOCOL = "tinydocy-dev-bridge";

/** Largest frame either side accepts (a document plus headroom). */
export const DEV_BRIDGE_MAX_FRAME_BYTES = 64 * 1024 * 1024;

export type DevBridgeRequest = { id: number; op: DevBridgeOp; args: unknown };

/** As the real IPC's envelope (architecture §7): no message crosses. */
export type DevBridgeError = { code: string; retryable: boolean };

export type DevBridgeReply = {
  id: number;
  result: { ok: true; value: unknown } | { ok: false; error: DevBridgeError };
};

const BYTES_KEY = "$bytes";

export function encodeFrame(
  message: DevBridgeRequest | DevBridgeReply,
): Uint8Array<ArrayBuffer> {
  const blobs: Uint8Array[] = [];
  const header = new TextEncoder().encode(
    JSON.stringify(
      message,
      function (this: Record<string, unknown>, key, value) {
        // The holder's own value: a Buffer has already become its toJSON().
        const original = this[key];
        if (original instanceof Uint8Array) {
          blobs.push(original);
          return { [BYTES_KEY]: blobs.length - 1 };
        }
        return value;
      },
    ),
  );
  let size = 4 + header.byteLength;
  for (const blob of blobs) size += 4 + blob.byteLength;
  if (size > DEV_BRIDGE_MAX_FRAME_BYTES) {
    throw new RangeError(`frame of ${size} bytes is over the cap`);
  }
  const frame = new Uint8Array(size);
  const view = new DataView(frame.buffer);
  view.setUint32(0, header.byteLength);
  frame.set(header, 4);
  let at = 4 + header.byteLength;
  for (const blob of blobs) {
    view.setUint32(at, blob.byteLength);
    frame.set(blob, at + 4);
    at += 4 + blob.byteLength;
  }
  return frame;
}

/** Throws on a malformed or oversized frame. */
export function decodeFrame(data: ArrayBuffer | Uint8Array): unknown {
  // A plain view, so slices are Uint8Arrays even when `data` is a Buffer.
  const frame =
    data instanceof Uint8Array
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
  if (frame.byteLength > DEV_BRIDGE_MAX_FRAME_BYTES) {
    throw new RangeError("frame over the cap");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const headerLength = view.getUint32(0);
  let at = 4 + headerLength;
  if (at > frame.byteLength) throw new RangeError("truncated header");
  const header = new TextDecoder().decode(frame.subarray(4, at));
  const blobs: Uint8Array[] = [];
  while (at < frame.byteLength) {
    const length = view.getUint32(at);
    const end = at + 4 + length;
    if (end > frame.byteLength) throw new RangeError("truncated blob");
    blobs.push(frame.slice(at + 4, end));
    at = end;
  }
  return JSON.parse(header, (_key, value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      Object.keys(value).length === 1 &&
      typeof value[BYTES_KEY] === "number"
    ) {
      const blob = blobs[value[BYTES_KEY]];
      if (!blob) throw new RangeError("missing blob");
      return blob;
    }
    return value;
  });
}
