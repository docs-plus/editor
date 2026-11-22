import { describe, expect, it } from "bun:test";

import { isValidWsDocumentName } from "@/lib/security/doc-id-validator";
import {
  isReservedSyncName,
  isShareId,
  mintShareId,
  shareDocumentName,
  shareIdFromDocumentName,
} from "@/lib/sharing/share-name";
import {
  decodeBase64url,
  hashTokenBytes,
  parseShareHash,
  readBearerToken,
  tokenMatchesHash,
} from "@/lib/sharing/share-token";

describe("share names", () => {
  it("accepts only server-minted lowercase UUID v4 ids", () => {
    const id = mintShareId();
    expect(isShareId(id)).toBe(true);
    expect(isShareId(id.toUpperCase())).toBe(false);
    expect(isShareId("00000000-0000-1000-8000-000000000000")).toBe(false);
    expect(isShareId(`${id}x`)).toBe(false);
    expect(isShareId("playground")).toBe(false);
  });

  it("reads the id from share:<id> and nothing else", () => {
    const id = mintShareId();
    expect(shareIdFromDocumentName(shareDocumentName(id))).toBe(id);
    expect(shareIdFromDocumentName(id)).toBeNull();
    expect(shareIdFromDocumentName(`share:${id}/x`)).toBeNull();
    expect(shareIdFromDocumentName(`sync:${id}`)).toBeNull();
  });

  it("reserves sync: and never accepts it as a share or sandbox name (S6b)", () => {
    const name = `sync:${mintShareId()}`;
    expect(isReservedSyncName(name)).toBe(true);
    expect(shareIdFromDocumentName(name)).toBeNull();
    expect(isValidWsDocumentName(name)).toBe(false);
  });

  it("keeps share: names out of the sandbox validator", () => {
    expect(isValidWsDocumentName(shareDocumentName(mintShareId()))).toBe(false);
  });
});

describe("share token wire format (frozen for P4.4 and W10)", () => {
  // Test vector: bytes 0x00..0x1f, hashed as bytes, both base64url.
  const TOKEN = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
  const TOKEN_HASH = "Yw3NKWbEM2aRElRIu7JbT_QSpJxzLbLIq8G4WBvXEN0";
  // Owner secret vector: bytes 0xff..0xf0 (16 bytes).
  const OWNER = "__79_Pv6-fj39vX08_Lx8A";
  const OWNER_HASH = "GA9_pzn9NORFwzaqP6o7StIvSb3gc7B9oRnAT75UdjA";

  it("hashes the decoded bytes of a 32-byte token", () => {
    const bytes = decodeBase64url(TOKEN, 32);
    expect(bytes).not.toBeNull();
    expect(hashTokenBytes(bytes as Buffer).toString("base64url")).toBe(
      TOKEN_HASH,
    );
    expect(tokenMatchesHash(bytes, parseShareHash(TOKEN_HASH))).toBe(true);
  });

  it("hashes the decoded bytes of a 16-byte owner secret", () => {
    const bytes = decodeBase64url(OWNER, 16);
    expect(tokenMatchesHash(bytes, parseShareHash(OWNER_HASH))).toBe(true);
  });

  it("refuses padding, standard base64, wrong lengths and stray bits", () => {
    expect(decodeBase64url(`${TOKEN}=`, 32)).toBeNull();
    expect(decodeBase64url(OWNER.replace("_", "/"), 16)).toBeNull();
    expect(decodeBase64url(TOKEN.slice(1), 32)).toBeNull();
    expect(decodeBase64url(TOKEN, 16)).toBeNull();
    // Same length, but the last character carries bits past 32 bytes.
    expect(decodeBase64url(`${TOKEN.slice(0, -1)}9`, 32)).toBeNull();
    expect(decodeBase64url(42, 32)).toBeNull();
    expect(parseShareHash(TOKEN_HASH.slice(0, 42))).toBeNull();
  });

  it("does not match a wrong token or a missing hash", () => {
    const other = decodeBase64url(OWNER, 16);
    expect(tokenMatchesHash(other, parseShareHash(TOKEN_HASH))).toBe(false);
    expect(tokenMatchesHash(null, parseShareHash(TOKEN_HASH))).toBe(false);
    expect(tokenMatchesHash(decodeBase64url(TOKEN, 32), null)).toBe(false);
  });

  it("reads a bearer token from the Authorization header only", () => {
    expect(
      readBearerToken(new Headers({ authorization: `Bearer ${TOKEN}` })),
    ).toBe(TOKEN);
    expect(readBearerToken(new Headers({ authorization: TOKEN }))).toBeNull();
    expect(
      readBearerToken(new Headers({ authorization: "Bearer a b" })),
    ).toBeNull();
    expect(readBearerToken(new Headers())).toBeNull();
  });
});
