import { createDecipheriv, createHash } from "node:crypto";

const BLOCK_SIZE = 16;
const KEY_SIZE = 32;
const IV_SIZE = 16;
const SALT_SIZE = 8;

/**
 * Decrypts the SSO payload GHL hands to an embedded custom page.
 *
 * The payload is OpenSSL's "Salted__" envelope with an MD5-based EVP_BytesToKey derivation —
 * GHL's format, not a choice we get to make, which is why the key schedule is written out
 * by hand rather than pulled from a KDF library.
 */
export function decryptSsoPayload(encrypted: string, ssoKey: string): unknown {
  const raw = Buffer.from(encrypted, "base64");
  const salt = raw.subarray(SALT_SIZE, BLOCK_SIZE);
  const cipherText = raw.subarray(BLOCK_SIZE);

  let derived = Buffer.alloc(0);
  while (derived.length < KEY_SIZE + IV_SIZE) {
    const block = createHash("md5")
      .update(Buffer.concat([derived.subarray(-IV_SIZE), Buffer.from(ssoKey, "utf8"), salt]))
      .digest();
    derived = Buffer.concat([derived, block]);
  }

  const decipher = createDecipheriv(
    "aes-256-cbc",
    derived.subarray(0, KEY_SIZE),
    derived.subarray(KEY_SIZE, KEY_SIZE + IV_SIZE),
  );
  const plaintext = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
