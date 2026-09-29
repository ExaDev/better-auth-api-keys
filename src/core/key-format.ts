import type { PortCallOptions, RandomSource } from "../contract/index.ts";
import {
  base62LengthForBits,
  encodeBase62FixedWidth,
  isBase62,
  randomBase62,
} from "./base62.ts";
import { crc32 } from "./crc32.ts";

/** A key's secret part carries 256 bits of entropy: far beyond guessing, which is what lets verification skip a slow hash and a per-attempt limit. */
export const KEY_ENTROPY_BITS = 256;

/** How many base62 characters carry {@link KEY_ENTROPY_BITS}: 43, since 43 × log2(62) is just over 256. */
export const KEY_RANDOM_LENGTH = base62LengthForBits(KEY_ENTROPY_BITS);

/** The checksum is a CRC-32, a 32-bit value. */
const CHECKSUM_BITS = 32;

/** How many base62 characters write every 32-bit value: 6, since 62^5 is below 2^32 and 62^6 above it. */
export const KEY_CHECKSUM_LENGTH = base62LengthForBits(CHECKSUM_BITS);

/** How many characters of the secret part a key's `start` shows after the prefix: enough to tell a person's keys apart in a list, while leaving well over 200 bits unrevealed. */
export const KEY_START_RANDOM_LENGTH = 4;

/** The checksum of a key's prefix and secret part, as {@link KEY_CHECKSUM_LENGTH} base62 characters. */
function checksumOf(prefixAndRandom: string): string {
  return encodeBase62FixedWidth(crc32(prefixAndRandom), KEY_CHECKSUM_LENGTH);
}

/**
 * A fresh key: `prefix`, then {@link KEY_RANDOM_LENGTH} random base62 characters, then {@link KEY_CHECKSUM_LENGTH} base62 characters of CRC-32 over everything before them. The prefix makes a leaked key recognisable to a person or a secret scanner; the checksum lets {@link hasKeyFormat} reject a mistyped or made-up key without a hash or a database read.
 */
export async function generateKey(
  prefix: string,
  random: Readonly<RandomSource>,
  options?: PortCallOptions,
): Promise<string> {
  const prefixAndRandom = `${prefix}${await randomBase62(KEY_RANDOM_LENGTH, random, options)}`;
  return `${prefixAndRandom}${checksumOf(prefixAndRandom)}`;
}

/**
 * Whether `presented` has the exact shape {@link generateKey} produces for `prefix`, checked offline: the prefix, the exact length, only base62 after the prefix, and a matching checksum. Any single-character change to a genuine key fails it, because CRC-32 detects every change confined to one byte.
 */
export function hasKeyFormat(prefix: string, presented: string): boolean {
  if (!presented.startsWith(prefix)) return false;
  if (
    presented.length !==
    prefix.length + KEY_RANDOM_LENGTH + KEY_CHECKSUM_LENGTH
  ) {
    return false;
  }
  const body = presented.slice(prefix.length);
  if (!isBase62(body)) return false;
  const checksumStart = presented.length - KEY_CHECKSUM_LENGTH;
  return (
    checksumOf(presented.slice(0, checksumStart)) ===
    presented.slice(checksumStart)
  );
}

/** What a list shows of a key: its prefix and the first {@link KEY_START_RANDOM_LENGTH} characters of its secret part. */
export function keyStart(prefix: string, key: string): string {
  return key.slice(0, prefix.length + KEY_START_RANDOM_LENGTH);
}
