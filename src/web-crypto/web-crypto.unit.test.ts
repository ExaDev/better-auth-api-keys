import { afterEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "./clock.ts";
import { createWebCryptoKeyHasher } from "./hasher.ts";
import { webCryptoRandomSource } from "./random.ts";

/** A key's worth of random bytes: 256 bits, where two equal draws are never going to happen. */
const KEY_BYTES = 32;

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort(new Error("aborted by the test"));

  return controller.signal;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebCryptoKeyHasher", () => {
  it("computes HMAC-SHA256 with the pepper as the key, as lowercase hex", async () => {
    // RFC 4231, test case 2.
    const hasher = createWebCryptoKeyHasher("Jefe");
    expect(await hasher.hash("what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("gives different digests under different peppers, and the same digest for the same input", async () => {
    const one = createWebCryptoKeyHasher("pepper one");
    const two = createWebCryptoKeyHasher("pepper two");
    expect(await one.hash("key")).toBe(await one.hash("key"));
    expect(await one.hash("key")).not.toBe(await two.hash("key"));
  });

  it("imports the pepper once per hasher, not once per hash", async () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey");
    const hasher = createWebCryptoKeyHasher("pepper");
    await Promise.all([hasher.hash("a"), hasher.hash("b")]);
    await hasher.hash("c");
    expect(importKey).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty pepper when it is built", () => {
    expect(() => createWebCryptoKeyHasher("")).toThrow("must not be empty");
  });

  it("refuses to hash once its signal has aborted", async () => {
    await expect(
      createWebCryptoKeyHasher("pepper").hash("key", {
        signal: abortedSignal(),
      }),
    ).rejects.toThrow("aborted by the test");
  });
});

describe("webCryptoRandomSource", () => {
  it("gives exactly the requested number of bytes, differing between calls", async () => {
    const first = await webCryptoRandomSource.bytes(KEY_BYTES);
    expect(first).toHaveLength(KEY_BYTES);
    expect(first).not.toEqual(await webCryptoRandomSource.bytes(KEY_BYTES));
  });

  it("refuses once its signal has aborted", async () => {
    await expect(
      webCryptoRandomSource.bytes(1, { signal: abortedSignal() }),
    ).rejects.toThrow("aborted by the test");
  });
});

describe("systemClock", () => {
  it("reads the platform clock", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-01T00:00:00.000Z") });
    try {
      expect(await systemClock.now()).toEqual(
        new Date("2026-05-01T00:00:00.000Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses once its signal has aborted", async () => {
    await expect(systemClock.now({ signal: abortedSignal() })).rejects.toThrow(
      "aborted by the test",
    );
  });
});
