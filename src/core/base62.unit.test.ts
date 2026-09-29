import { describe, expect, it } from "vitest";
import { scriptedRandomSource } from "../test-support/random-sources.ts";
import {
  BASE62_ALPHABET,
  REJECTION_BOUND,
  base62LengthForBits,
  encodeBase62FixedWidth,
  isBase62,
  randomBase62,
} from "./base62.ts";

const ALPHABET_SIZE = 62;
/** 256 = 4 × 62 + 8, so the largest multiple of 62 below 256 is 248. */
const LARGEST_MULTIPLE_BELOW_A_BYTE = 248;
const WIDTH = 3;
const LAST_DIGIT = 61;
const LAST_BYTE = 255;
const LAST_ACCEPTED = LARGEST_MULTIPLE_BELOW_A_BYTE - 1;
const THIRD_DIGIT = 3;
const MAX_UINT32 = 0xffffffff;
const UINT32_WIDTH = 6;

describe("base62", () => {
  it("uses the 62 letters and digits, each once", () => {
    expect(new Set(BASE62_ALPHABET).size).toBe(ALPHABET_SIZE);
    expect(isBase62(BASE62_ALPHABET)).toBe(true);
  });

  it("rejects bytes from 248, the largest multiple of 62 that fits in a byte", () => {
    expect(REJECTION_BOUND).toBe(LARGEST_MULTIPLE_BELOW_A_BYTE);
  });

  it.each([
    { bits: 256, characters: 43 },
    { bits: 128, characters: 22 },
    { bits: 32, characters: 6 },
  ])("carries $bits bits in $characters characters", ({ bits, characters }) => {
    expect(base62LengthForBits(bits)).toBe(characters);
  });

  it.each([
    { value: "", base62: true },
    { value: "abcXYZ019", base62: true },
    { value: "abc_", base62: false },
    { value: "abc-", base62: false },
    { value: "ab c", base62: false },
    { value: "é", base62: false },
  ])("recognises $value as base62: $base62", ({ value, base62 }) => {
    expect(isBase62(value)).toBe(base62);
  });

  it.each([
    { value: 0, width: WIDTH, encoded: "000" },
    { value: 61, width: WIDTH, encoded: "00z" },
    { value: 62, width: WIDTH, encoded: "010" },
    { value: ALPHABET_SIZE ** WIDTH - 1, width: WIDTH, encoded: "zzz" },
    { value: MAX_UINT32, width: UINT32_WIDTH, encoded: "4gfFC3" },
  ])(
    "writes $value as $encoded, most significant character first",
    ({ value, width, encoded }) => {
      expect(encodeBase62FixedWidth(value, width)).toBe(encoded);
    },
  );

  it.each([
    { value: ALPHABET_SIZE ** WIDTH, reason: "too large for the width" },
    { value: -1, reason: "negative" },
    { value: 1.5, reason: "fractional" },
  ])("refuses a number that is $reason", ({ value }) => {
    expect(() => encodeBase62FixedWidth(value, WIDTH)).toThrow(RangeError);
  });

  it("maps each byte below the bound to its remainder and discards the rest", async () => {
    const random = scriptedRandomSource([
      0,
      LARGEST_MULTIPLE_BELOW_A_BYTE,
      LAST_DIGIT,
      LAST_BYTE,
      ALPHABET_SIZE,
      LAST_ACCEPTED,
    ]);
    const wanted = "0z0z";
    expect(await randomBase62(wanted.length, random)).toBe(wanted);
  });

  it("asks only for as many bytes as characters are still missing", async () => {
    const random = scriptedRandomSource([
      LAST_BYTE,
      1,
      LAST_BYTE,
      LAST_BYTE,
      2,
      LAST_BYTE,
      THIRD_DIGIT,
    ]);
    const wanted = "123";
    expect(await randomBase62(wanted.length, random)).toBe(wanted);
    expect(random.requests).toEqual([WIDTH, 2, 1, 1]);
  });
});
