import type { PortCallOptions, RandomSource } from "../contract/index.ts";

/** Digits, then upper case, then lower case: letters and digits only, so a key survives being double-clicked, pasted into a URL or a shell, and matched by a secret scanner's word boundary. */
export const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** How many distinct values one random byte takes. */
const BYTE_VALUES = 256;

/**
 * The rejection-sampling bound: the largest multiple of the alphabet's size that fits in a byte (248, since 256 = 4 × 62 + 8). A byte below it maps to `byte % 62` with every character exactly equally likely; a byte at or above it is discarded, since keeping it would make the first eight characters slightly likelier than the rest.
 */
export const REJECTION_BOUND =
  BYTE_VALUES - (BYTE_VALUES % BASE62_ALPHABET.length);

/** How many base62 characters carry at least `bits` bits of entropy, which is also how many it takes to write every value below `2 ** bits`. */
export function base62LengthForBits(bits: number): number {
  return Math.ceil(bits / Math.log2(BASE62_ALPHABET.length));
}

/** Whether every character of `value` is in {@link BASE62_ALPHABET}. */
export function isBase62(value: string): boolean {
  for (const character of value) {
    if (!BASE62_ALPHABET.includes(character)) return false;
  }

  return true;
}

/**
 * Writes a non-negative integer as exactly `width` base62 characters, most significant first, padded with the alphabet's zero character. Throws if the value needs more than `width` characters, rather than silently truncating it.
 */
export function encodeBase62FixedWidth(value: number, width: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `Cannot write ${value} in base62: not a non-negative safe integer`,
    );
  }
  let remaining = value;
  let encoded = "";
  for (let position = 0; position < width; position++) {
    encoded = `${BASE62_ALPHABET.charAt(remaining % BASE62_ALPHABET.length)}${encoded}`;
    remaining = Math.floor(remaining / BASE62_ALPHABET.length);
  }
  if (remaining !== 0) {
    throw new RangeError(`${value} does not fit in ${width} base62 characters`);
  }

  return encoded;
}

/**
 * `length` characters drawn uniformly from {@link BASE62_ALPHABET}, by rejection sampling of random bytes below {@link REJECTION_BOUND}. Asks the random source for as many bytes as characters are still missing each round, so it usually takes one round and rarely more than two.
 */
export async function randomBase62(
  length: number,
  random: Readonly<RandomSource>,
  options?: PortCallOptions,
): Promise<string> {
  let result = "";
  const bytes = await random.bytes(length, options);
  for (const byte of bytes) {
    if (byte < REJECTION_BOUND && result.length < length) {
      result += BASE62_ALPHABET.charAt(byte % BASE62_ALPHABET.length);
    }
  }

  // Each round asks only for the characters the rejected bytes left missing, so the rounds run in turn rather than together.
  return result.length < length
    ? result + (await randomBase62(length - result.length, random, options))
    : result;
}
