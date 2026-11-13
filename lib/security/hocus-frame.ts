import * as decoding from "lib0/decoding";

/** Hocuspocus `MessageType.Auth`: the frame that runs `onConnect`. */
export const HOCUS_MESSAGE_AUTH = 2;

/** Hocuspocus handles `Sync` (0) and `SyncReply` (4) frames identically. */
export const HOCUS_SYNC_MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 4]);

export type FrameHeader = { documentName: string; messageType: number };

/**
 * Decodes a Hocuspocus frame header exactly as `ClientConnection` does
 * (lib0: varString key, then varUint message type) and returns a decoder
 * positioned after it. Session-aware keys (`name\0sessionId`) yield the
 * plain document name. Throws on a frame that does not decode.
 */
export function decodeFrameHeader(
  frame: Uint8Array,
): FrameHeader & { decoder: decoding.Decoder } {
  const decoder = decoding.createDecoder(frame);
  const rawKey = decoding.readVarString(decoder);
  const separator = rawKey.indexOf("\0");
  const documentName =
    separator === -1 ? rawKey : rawKey.substring(0, separator);
  const messageType = decoding.readVarUint(decoder);
  return { documentName, messageType, decoder };
}

/** The frame's document name and message type, or null if it does not decode. */
export function readFrameHeader(frame: Uint8Array): FrameHeader | null {
  try {
    const { documentName, messageType } = decodeFrameHeader(frame);
    return { documentName, messageType };
  } catch {
    return null;
  }
}
