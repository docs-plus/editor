import { createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * What a sharing client does before it talks to the server (plan §6 "Link
 * secrets", seam S1), for tests only: the real label registry lands with
 * P4.4 (`lib/crypto/labels.ts`, S1c). HKDF-SHA-256, empty salt, the label
 * as `info`, 32-byte output; hashes are SHA-256 of the decoded bytes.
 */
const LABEL_VIEW = "tinydocy/view/v1";
const LABEL_AUTH_EDIT = "tinydocy/auth/edit/v1";
const LABEL_AUTH_VIEW = "tinydocy/auth/view/v1";

function hkdf(input: Buffer, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", input, Buffer.alloc(0), label, 32));
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

export type ShareSecrets = {
  /** The 128-bit edit secret: lives in the link fragment only. */
  e: Buffer;
  /** The view secret derived from `e`: lives in the view link fragment only. */
  view: Buffer;
  /** The independent 128-bit owner secret. */
  owner: Buffer;
  authEdit: string;
  authView: string;
  ownerToken: string;
  hashes: { edit_hash: string; view_hash: string; owner_hash: string };
};

export function makeShareSecrets(): ShareSecrets {
  const e = randomBytes(16);
  const owner = randomBytes(16);
  const view = hkdf(e, LABEL_VIEW);
  const authEdit = hkdf(e, LABEL_AUTH_EDIT);
  const authView = hkdf(view, LABEL_AUTH_VIEW);
  return {
    e,
    view,
    owner,
    authEdit: authEdit.toString("base64url"),
    authView: authView.toString("base64url"),
    ownerToken: owner.toString("base64url"),
    hashes: {
      edit_hash: hash(authEdit),
      view_hash: hash(authView),
      owner_hash: hash(owner),
    },
  };
}

/** Every form a raw link secret could leak in (bytes as text encodings). */
export function rawSecretForms(secrets: ShareSecrets): string[] {
  return [secrets.e, secrets.view].flatMap((bytes) => [
    bytes.toString("base64url"),
    bytes.toString("base64"),
    bytes.toString("hex"),
  ]);
}
