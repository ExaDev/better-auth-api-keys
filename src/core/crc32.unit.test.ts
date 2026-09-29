import { describe, expect, it } from "vitest";
import { crc32 } from "./crc32.ts";

/** U+00E9, one UTF-16 code unit but two UTF-8 bytes. */
const E_ACUTE = 0xe9;

describe("crc32", () => {
  it.each([
    { input: "123456789", crc: 0xcbf43926, source: "the standard check value" },
    { input: "", crc: 0, source: "the empty input" },
    { input: "a", crc: 0xe8b7be43, source: "a single byte" },
    {
      input: "The quick brown fox jumps over the lazy dog",
      crc: 0x414fa339,
      source: "a well-known pangram",
    },
  ])("matches the standard CRC-32 of $source", ({ input, crc }) => {
    expect(crc32(input)).toBe(crc);
  });

  it.each([
    { encoding: "UTF-8 bytes (C3 A9)", crc: 0x0e048d3e, matches: true },
    { encoding: "a single Latin-1 byte (E9)", crc: 0x0bd4b551, matches: false },
  ])(
    "hashes e-acute as its UTF-8 bytes, so its CRC matches $encoding: $matches",
    ({ crc, matches }) => {
      expect(crc32(String.fromCodePoint(E_ACUTE)) === crc).toBe(matches);
    },
  );
});
