import { describe, expect, it } from "vitest";
import { seededRandomSource } from "../test-support/random-sources.ts";
import { BASE62_ALPHABET } from "./base62.ts";
import { crc32 } from "./crc32.ts";
import {
  KEY_CHECKSUM_LENGTH,
  KEY_RANDOM_LENGTH,
  KEY_START_RANDOM_LENGTH,
  generateKey,
  hasKeyFormat,
  keyStart,
} from "./key-format.ts";

const PREFIX = "exshow_";

/** Every substitute a mutation tries: the whole alphabet plus characters just outside it. */
const SUBSTITUTES = [...Array.from(BASE62_ALPHABET), "_", "-", " ", ".", "é"];

/** Enough generated keys that a checksum or sampling bug affecting a sizeable share of keys shows up, while checking every single-character mutation of each stays well inside a test's time on a loaded machine. That every mutation fails is structural (CRC-32 detects any change confined to one byte), so more samples would add time, not confidence. */
const PROPERTY_SAMPLES = 16;

/** The documented shape: 43 random characters (256 bits) and a 6-character checksum (a 32-bit CRC). */
const DOCUMENTED_RANDOM_LENGTH = 43;
const DOCUMENTED_CHECKSUM_LENGTH = 6;
const DOCUMENTED_START_RANDOM_LENGTH = 4;

/** One seed per test, so each test's keys are independent and replayable. */
const SEED = {
  shape: 1,
  checksum: 2,
  property: 3,
  lengths: 4,
  start: 5,
  distinct: 6,
} as const;

describe("key format", () => {
  it("is the prefix, 43 random characters and a 6-character checksum", async () => {
    expect(KEY_RANDOM_LENGTH).toBe(DOCUMENTED_RANDOM_LENGTH);
    expect(KEY_CHECKSUM_LENGTH).toBe(DOCUMENTED_CHECKSUM_LENGTH);
    const key = await generateKey(PREFIX, seededRandomSource(SEED.shape));
    expect(key).toMatch(/^exshow_[0-9A-Za-z]{49}$/u);
  });

  it("ends in the base62 CRC-32 of everything before the checksum", async () => {
    const key = await generateKey(PREFIX, seededRandomSource(SEED.checksum));
    const body = key.slice(0, -KEY_CHECKSUM_LENGTH);
    let value = 0;
    for (const character of key.slice(-KEY_CHECKSUM_LENGTH)) {
      value =
        value * BASE62_ALPHABET.length + BASE62_ALPHABET.indexOf(character);
    }
    expect(value).toBe(crc32(body));
  });

  it("passes the offline check for every generated key, and fails it after any single-character change", async () => {
    const random = seededRandomSource(SEED.property);
    const rejectedGenuine: string[] = [];
    const acceptedMutants: string[] = [];
    for (let sample = 0; sample < PROPERTY_SAMPLES; sample++) {
      const key = await generateKey(PREFIX, random);
      if (!hasKeyFormat(PREFIX, key)) rejectedGenuine.push(key);
      for (let position = 0; position < key.length; position++) {
        for (const substitute of SUBSTITUTES) {
          if (substitute === key[position]) continue;
          const mutated = `${key.slice(0, position)}${substitute}${key.slice(position + 1)}`;
          if (hasKeyFormat(PREFIX, mutated)) acceptedMutants.push(mutated);
        }
      }
    }
    expect(rejectedGenuine).toEqual([]);
    expect(acceptedMutants).toEqual([]);
  });

  it("fails the offline check for a wrong prefix or length", async () => {
    const key = await generateKey(PREFIX, seededRandomSource(SEED.lengths));
    expect(hasKeyFormat("other_", key)).toBe(false);
    expect(hasKeyFormat(PREFIX, key.slice(0, -1))).toBe(false);
    expect(hasKeyFormat(PREFIX, `${key}0`)).toBe(false);
    expect(hasKeyFormat(PREFIX, key.slice(PREFIX.length))).toBe(false);
    expect(hasKeyFormat(PREFIX, "")).toBe(false);
  });

  it("shows the prefix and the first characters of the secret part as the key's start", async () => {
    const key = await generateKey(PREFIX, seededRandomSource(SEED.start));
    expect(keyStart(PREFIX, key)).toBe(
      key.slice(0, PREFIX.length + KEY_START_RANDOM_LENGTH),
    );
    expect(keyStart(PREFIX, key)).toHaveLength(
      PREFIX.length + DOCUMENTED_START_RANDOM_LENGTH,
    );
  });

  it("gives different keys from different random bytes", async () => {
    const random = seededRandomSource(SEED.distinct);
    expect(await generateKey(PREFIX, random)).not.toBe(
      await generateKey(PREFIX, random),
    );
  });
});
