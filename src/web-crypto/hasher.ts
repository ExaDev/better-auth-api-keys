import {
  API_KEYS_CONTRACT_VERSION,
  type KeyHasher,
} from "../contract/index.ts";

const textEncoder = new TextEncoder();

const HEX_RADIX = 16;
/** A byte is two hex digits, so every digest has the same length. */
const HEX_DIGITS_PER_BYTE = 2;

/** Hex, not base64: the digest is only ever compared for equality in a unique column, and hex needs no alphabet agreement between writers. */
function toHex(bytes: Readonly<ArrayBuffer>): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0"),
  ).join("");
}

/**
 * A {@link KeyHasher} computing `HMAC-SHA256(pepper, key)` with Web Crypto, as lowercase hex. The pepper is a server secret kept out of the database, so a copy of the database alone gives nothing to test guesses against; the keys themselves carry 256 bits of entropy, so no slow hash is needed on top.
 *
 * The imported `CryptoKey` is cached on the instance: importing a key costs more than the HMAC itself, and the pepper never changes for the instance's lifetime, so construct one hasher per process (per isolate), not per request. Throws for an empty pepper, so a missing secret fails at start-up rather than hashing with no secret at all.
 */
export function createWebCryptoKeyHasher(pepper: string): KeyHasher {
  if (pepper.length === 0) {
    throw new Error("An API key pepper must not be empty");
  }
  let cryptoKey: Promise<CryptoKey> | undefined;
  return {
    version: API_KEYS_CONTRACT_VERSION,
    async hash(key, options) {
      options?.signal?.throwIfAborted();
      cryptoKey ??= crypto.subtle.importKey(
        "raw",
        textEncoder.encode(pepper),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const digest = await crypto.subtle.sign(
        "HMAC",
        await cryptoKey,
        textEncoder.encode(key),
      );
      options?.signal?.throwIfAborted();
      return toHex(digest);
    },
  };
}
