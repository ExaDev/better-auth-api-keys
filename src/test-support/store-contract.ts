import { beforeEach, describe, expect, it } from "vitest";
import type { ApiKeyStore, StoredApiKey } from "../contract/index.ts";

/** A store under test, plus a way to create an owner it can hold keys for (a database store needs the owner's row for its foreign key). */
export interface StoreFixture {
  readonly store: ApiKeyStore;
  readonly addOwner: (ownerId: string) => Promise<void>;
}

/** More keys than better-auth's adapters return from one unbounded `findMany` (100 by default), so a store that forgets to page lists too few. */
const KEYS_BEYOND_ONE_PAGE = 101;

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const expiresAt = new Date("2026-04-01T00:00:00.000Z");

let sequence = 0;
/** A distinct, well-formed stored key for `ownerId`, with `overrides` applied. */
export function storedKey(
  ownerId: string,
  overrides: Partial<StoredApiKey> = {},
): StoredApiKey {
  sequence++;
  return {
    id: `key-${sequence}`,
    ownerId,
    name: `key ${sequence}`,
    keyHash: `hash-${sequence}`,
    start: `test_${sequence}`,
    scopes: { access: "read" },
    claims: { provider: "google" },
    createdAt,
    expiresAt,
    lastUsedAt: undefined,
    ...overrides,
  };
}

function aborted(): AbortSignal {
  const controller = new AbortController();
  controller.abort(new Error("aborted by the test"));
  return controller.signal;
}

/**
 * The behaviour every {@link ApiKeyStore} must have, as one suite run against each implementation (the in-memory store, the better-auth adapter store over the memory adapter, and over Drizzle on D1), so they cannot drift apart.
 */
export function describeApiKeyStoreContract(
  name: string,
  makeFixture: () => Promise<StoreFixture>,
): void {
  describe(`${name} satisfies the ApiKeyStore contract`, () => {
    let store: ApiKeyStore;
    beforeEach(async () => {
      const fixture = await makeFixture();
      store = fixture.store;
      await fixture.addOwner("owner-a");
      await fixture.addOwner("owner-b");
    });

    it("finds an inserted key by its hash, with every field intact", async () => {
      const key = storedKey("owner-a", {
        scopes: { access: "write", toolsets: ["artifacts"] },
      });
      expect(await store.insert(key)).toEqual({ outcome: "inserted" });
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "found",
        key,
      });
    });

    it("reports an unknown hash as not found", async () => {
      await store.insert(storedKey("owner-a"));
      expect(await store.findByHash("no-such-hash")).toEqual({
        outcome: "not-found",
      });
    });

    it("refuses a second key with the same owner and name, and keeps the first", async () => {
      const first = storedKey("owner-a", { name: "deploys" });
      await store.insert(first);
      expect(
        await store.insert(storedKey("owner-a", { name: "deploys" })),
      ).toEqual({
        outcome: "name-taken",
      });
      expect(await store.listByOwner("owner-a")).toEqual([first]);
    });

    it("allows the same name for different owners", async () => {
      await store.insert(storedKey("owner-a", { name: "deploys" }));
      expect(
        await store.insert(storedKey("owner-b", { name: "deploys" })),
      ).toEqual({
        outcome: "inserted",
      });
    });

    it("lists exactly the owner's keys, however many there are", async () => {
      const owned = Array.from({ length: KEYS_BEYOND_ONE_PAGE }, () =>
        storedKey("owner-a"),
      );
      for (const key of owned) await store.insert(key);
      await store.insert(storedKey("owner-b"));
      const listed = await store.listByOwner("owner-a");
      expect(listed.map((key) => key.id).sort()).toEqual(
        owned.map((key) => key.id).sort(),
      );
    });

    it("deletes a key by id", async () => {
      const key = storedKey("owner-a");
      await store.insert(key);
      expect(await store.delete({ id: key.id })).toEqual({
        outcome: "deleted",
      });
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "not-found",
      });
      expect(await store.delete({ id: key.id })).toEqual({
        outcome: "not-found",
      });
    });

    it("deletes by id and owner only when that owner holds the key", async () => {
      const key = storedKey("owner-a");
      await store.insert(key);
      expect(await store.delete({ id: key.id, ownerId: "owner-b" })).toEqual({
        outcome: "not-found",
      });
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "found",
        key,
      });
      expect(await store.delete({ id: key.id, ownerId: "owner-a" })).toEqual({
        outcome: "deleted",
      });
    });

    it("deletes every key of one owner and no other", async () => {
      await store.insert(storedKey("owner-a"));
      await store.insert(storedKey("owner-a"));
      const other = storedKey("owner-b");
      await store.insert(other);
      expect(await store.deleteByOwner("owner-a")).toEqual({ deleted: 2 });
      expect(await store.listByOwner("owner-a")).toEqual([]);
      expect(await store.listByOwner("owner-b")).toEqual([other]);
      expect(await store.deleteByOwner("owner-a")).toEqual({ deleted: 0 });
    });

    it("writes the last-used time of a never-used key", async () => {
      const key = storedKey("owner-a");
      await store.insert(key);
      const at = new Date("2026-02-01T12:00:00.000Z");
      expect(
        await store.touchLastUsed(key.id, at, new Date(at.getTime() - 1)),
      ).toEqual({
        outcome: "touched",
      });
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "found",
        key: { ...key, lastUsedAt: at },
      });
    });

    it("rewrites a last-used time strictly before the cut-off, and leaves one at or after it", async () => {
      const lastUsedAt = new Date("2026-02-01T12:00:00.000Z");
      const key = storedKey("owner-a", { lastUsedAt });
      await store.insert(key);
      const later = new Date("2026-02-01T13:00:00.000Z");
      expect(await store.touchLastUsed(key.id, later, lastUsedAt)).toEqual({
        outcome: "unchanged",
      });
      expect(
        await store.touchLastUsed(
          key.id,
          later,
          new Date(lastUsedAt.getTime() + 1),
        ),
      ).toEqual({ outcome: "touched" });
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "found",
        key: { ...key, lastUsedAt: later },
      });
    });

    it("writes once when two last-used writes with the same cut-off race", async () => {
      const key = storedKey("owner-a");
      await store.insert(key);
      const at = new Date("2026-02-01T12:00:00.000Z");
      const notSince = new Date(at.getTime() - 1);
      const outcomes = await Promise.all([
        store.touchLastUsed(key.id, at, notSince),
        store.touchLastUsed(key.id, at, notSince),
      ]);
      expect(outcomes.map((result) => result.outcome).sort()).toEqual([
        "touched",
        "unchanged",
      ]);
    });

    it("leaves an unknown key unchanged", async () => {
      const at = new Date("2026-02-01T12:00:00.000Z");
      expect(await store.touchLastUsed("no-such-key", at, at)).toEqual({
        outcome: "unchanged",
      });
    });

    it("refuses every call once its signal has aborted, changing nothing", async () => {
      const key = storedKey("owner-a");
      const signal = aborted();
      await expect(store.insert(key, { signal })).rejects.toThrow(
        "aborted by the test",
      );
      expect(await store.listByOwner("owner-a")).toEqual([]);
      await store.insert(key);
      await expect(store.findByHash(key.keyHash, { signal })).rejects.toThrow(
        "aborted",
      );
      await expect(store.listByOwner("owner-a", { signal })).rejects.toThrow(
        "aborted",
      );
      await expect(store.delete({ id: key.id }, { signal })).rejects.toThrow(
        "aborted",
      );
      await expect(store.deleteByOwner("owner-a", { signal })).rejects.toThrow(
        "aborted",
      );
      await expect(
        store.touchLastUsed(key.id, createdAt, createdAt, { signal }),
      ).rejects.toThrow("aborted");
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "found",
        key,
      });
    });
  });
}
