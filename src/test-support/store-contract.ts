import { beforeEach, describe, expect, it } from "vitest";
import type {
  ApiKeyOwner,
  ApiKeyStore,
  StoredApiKey,
} from "../contract/index.ts";

/** A store under test, plus a way to create a person it can hold keys for (a database store needs the person's row for its foreign key; a system principal needs no row). */
export interface StoreFixture {
  readonly store: ApiKeyStore;
  readonly addOwner: (ownerId: string) => Promise<void>;
}

/** More keys than better-auth's adapters return from one unbounded `findMany` (100 by default), so a store that forgets to page lists too few. */
const KEYS_BEYOND_ONE_PAGE = 101;

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const expiresAt = new Date("2026-04-01T00:00:00.000Z");

/** The person `id`, as an owner. */
export function user(id: string): ApiKeyOwner {
  return { kind: "user", id };
}

/** The system principal `id`, as an owner. */
export function system(id: string): ApiKeyOwner {
  return { kind: "system", id };
}

/** The keys `store` lists for `owner`, failing the test if any row is corrupt: no store under the contract suite holds one. */
export async function listedKeys(
  store: Readonly<ApiKeyStore>,
  owner: ApiKeyOwner,
): Promise<StoredApiKey[]> {
  return (await store.listByOwner(owner)).map((listing) => {
    if (listing.outcome !== "stored") {
      throw new Error(`Key ${listing.id} is corrupt`);
    }

    return listing.key;
  });
}

let sequence = 0;
/** A distinct, well-formed stored key for `owner` (a person's id, or any owner), with `overrides` applied. */
export function storedKey(
  owner: string | ApiKeyOwner,
  overrides: Partial<StoredApiKey> = {},
): StoredApiKey {
  sequence++;

  return {
    id: `key-${sequence}`,
    owner: typeof owner === "string" ? user(owner) : owner,
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
      expect(await listedKeys(store, user("owner-a"))).toEqual([first]);
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
      await Promise.all(owned.map(async (key) => store.insert(key)));
      await store.insert(storedKey("owner-b"));
      const listed = await listedKeys(store, user("owner-a"));
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
      expect(
        await store.delete({ id: key.id, owner: user("owner-b") }),
      ).toEqual({
        outcome: "not-found",
      });
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "found",
        key,
      });
      expect(
        await store.delete({ id: key.id, owner: user("owner-a") }),
      ).toEqual({
        outcome: "deleted",
      });
    });

    it("deletes every key of one owner and no other", async () => {
      await store.insert(storedKey("owner-a"));
      await store.insert(storedKey("owner-a"));
      const other = storedKey("owner-b");
      await store.insert(other);
      expect(await store.deleteByOwner(user("owner-a"))).toEqual({
        deleted: 2,
      });
      expect(await listedKeys(store, user("owner-a"))).toEqual([]);
      expect(await listedKeys(store, user("owner-b"))).toEqual([other]);
      expect(await store.deleteByOwner(user("owner-a"))).toEqual({
        deleted: 0,
      });
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

    it("finds a system principal's key with no expiry and its creator, every field intact", async () => {
      const key = storedKey(system("deployer"), {
        expiresAt: null,
        createdBy: "owner-a",
      });
      expect(await store.insert(key)).toEqual({ outcome: "inserted" });
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "found",
        key,
      });
      expect(await listedKeys(store, system("deployer"))).toEqual([key]);
    });

    it("keeps names unique per owner kind, so a person and a principal with the same id may share a name", async () => {
      const principals = storedKey(system("owner-a"), { name: "deploys" });
      expect(await store.insert(principals)).toEqual({ outcome: "inserted" });
      expect(
        await store.insert(storedKey(system("owner-a"), { name: "deploys" })),
      ).toEqual({ outcome: "name-taken" });
      const persons = storedKey("owner-a", { name: "deploys" });
      expect(await store.insert(persons)).toEqual({ outcome: "inserted" });
      expect(
        await store.insert(storedKey(system("other"), { name: "deploys" })),
      ).toEqual({ outcome: "inserted" });
      expect(await listedKeys(store, system("owner-a"))).toEqual([principals]);
      expect(await listedKeys(store, user("owner-a"))).toEqual([persons]);
    });

    it("deletes by id and owner only when the owner's kind matches as well as its id", async () => {
      const principals = storedKey(system("owner-a"));
      const persons = storedKey("owner-a");
      await store.insert(principals);
      await store.insert(persons);
      expect(
        await store.delete({ id: principals.id, owner: user("owner-a") }),
      ).toEqual({ outcome: "not-found" });
      expect(
        await store.delete({ id: persons.id, owner: system("owner-a") }),
      ).toEqual({ outcome: "not-found" });
      expect(
        await store.delete({ id: principals.id, owner: system("owner-b") }),
      ).toEqual({ outcome: "not-found" });
      expect(await store.findByHash(principals.keyHash)).toEqual({
        outcome: "found",
        key: principals,
      });
      expect(
        await store.delete({ id: principals.id, owner: system("owner-a") }),
      ).toEqual({ outcome: "deleted" });
      expect(await listedKeys(store, user("owner-a"))).toEqual([persons]);
    });

    it("deletes every key of one owner kind and no key of the other kind with the same id", async () => {
      const principals = storedKey(system("owner-a"));
      const persons = storedKey("owner-a");
      await store.insert(principals);
      await store.insert(persons);
      expect(await store.deleteByOwner(user("owner-a"))).toEqual({
        deleted: 1,
      });
      expect(await listedKeys(store, system("owner-a"))).toEqual([principals]);
      expect(await store.deleteByOwner(system("owner-a"))).toEqual({
        deleted: 1,
      });
      expect(await store.findByHash(principals.keyHash)).toEqual({
        outcome: "not-found",
      });
    });

    it("writes the last-used time of a system principal's key", async () => {
      const key = storedKey(system("deployer"), { expiresAt: null });
      await store.insert(key);
      const at = new Date("2026-02-01T12:00:00.000Z");
      expect(
        await store.touchLastUsed(key.id, at, new Date(at.getTime() - 1)),
      ).toEqual({ outcome: "touched" });
      expect(await store.findByHash(key.keyHash)).toEqual({
        outcome: "found",
        key: { ...key, lastUsedAt: at },
      });
    });

    it("refuses every call once its signal has aborted, changing nothing", async () => {
      const key = storedKey("owner-a");
      const signal = aborted();
      await expect(store.insert(key, { signal })).rejects.toThrow(
        "aborted by the test",
      );
      expect(await listedKeys(store, user("owner-a"))).toEqual([]);
      await store.insert(key);
      await expect(store.findByHash(key.keyHash, { signal })).rejects.toThrow(
        "aborted",
      );
      await expect(
        store.listByOwner(user("owner-a"), { signal }),
      ).rejects.toThrow("aborted");
      await expect(store.delete({ id: key.id }, { signal })).rejects.toThrow(
        "aborted",
      );
      await expect(
        store.deleteByOwner(user("owner-a"), { signal }),
      ).rejects.toThrow("aborted");
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
