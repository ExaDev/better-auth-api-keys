import { describe, expect, it } from "vitest";
import { isExpired, isLastUsedStale, lastUsedCutOff } from "./key-times.ts";

const at = new Date("2026-03-01T00:00:00.000Z");
const INTERVAL_MS = 1000;

describe("key times", () => {
  it("puts the last-used cut-off one interval before now", () => {
    expect(lastUsedCutOff(at, INTERVAL_MS)).toEqual(
      new Date(at.getTime() - INTERVAL_MS),
    );
  });

  it("counts a never-used key, or one used strictly before the cut-off, as stale", () => {
    expect(isLastUsedStale(undefined, at)).toBe(true);
    expect(isLastUsedStale(new Date(at.getTime() - 1), at)).toBe(true);
    expect(isLastUsedStale(at, at)).toBe(false);
    expect(isLastUsedStale(new Date(at.getTime() + 1), at)).toBe(false);
  });

  it("treats a key as valid up to, but not at, its expiry", () => {
    expect(isExpired(at, new Date(at.getTime() - 1))).toBe(false);
    expect(isExpired(at, at)).toBe(true);
    expect(isExpired(at, new Date(at.getTime() + 1))).toBe(true);
  });

  it("never treats a key with no expiry as expired", () => {
    expect(isExpired(null, at)).toBe(false);
    expect(isExpired(null, new Date("9999-12-31T23:59:59.999Z"))).toBe(false);
  });
});
