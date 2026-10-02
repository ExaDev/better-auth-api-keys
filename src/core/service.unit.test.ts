import { describe, expect, expectTypeOf, it } from "vitest";
import {
  API_KEY_NAME_MAX_LENGTH,
  type ApiKeySystemOwner,
  type ApiKeyUserOwner,
} from "../contract/index.ts";
import { KEY_START_RANDOM_LENGTH } from "./key-format.ts";
import {
  createInMemoryApiKeyStore,
  createManualClock,
} from "../testing/index.ts";
import { seededRandomSource } from "../test-support/random-sources.ts";
import {
  DAY_MS,
  TEST_LAST_USED_INTERVAL_MS,
  TEST_MAX_LIFETIME_MS,
  TEST_PREFIX,
  TEST_START,
  serviceFixture,
  testAuthoriser,
  testClaimsSchema,
  testScopesSchema,
  type TestClaims,
  type TestScopes,
} from "../test-support/service-fixture.ts";
import { storedKey, system, user } from "../test-support/store-contract.ts";
import { createWebCryptoKeyHasher } from "../web-crypto/index.ts";
import { createApiKeyService, type CreateApiKeyInput } from "./service.ts";

/** A typical key lifetime, and the default the host offers. */
const LIFETIME_DAYS = 90;
const LIFETIME_MS = LIFETIME_DAYS * DAY_MS;
const MINUTE_MS = 60_000;
/** How many last-used intervals the busy-key test runs across. */
const INTERVALS_OBSERVED = 3;
/** The id length 128 bits of entropy needs in base62. */
const KEY_ID_LENGTH = 22;

const alice = { id: "alice" };
const bob = { id: "bob" };
const deployer = { kind: "system", id: "deployer" } as const;
/** A system principal whose id is the same string as the person `alice`'s. */
const aliceSystem = { kind: "system", id: "alice" } as const;
/** Far enough past any lifetime the tests use that every key with an expiry has expired. */
const YEARS_LATER = 10;

function input(
  overrides: Partial<CreateApiKeyInput<TestScopes, TestClaims>> = {},
): CreateApiKeyInput<TestScopes, TestClaims> {
  return {
    owner: alice,
    name: "deploys",
    lifetimeMs: LIFETIME_MS,
    scopes: { access: "read" },
    claims: { provider: "google" },
    ...overrides,
  };
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort(new Error("aborted by the test"));

  return controller.signal;
}

describe("createApiKeyService", () => {
  it("refuses unusable settings when it is built", () => {
    const valid = {
      prefix: TEST_PREFIX,
      maxLifetimeMs: TEST_MAX_LIFETIME_MS,
      lastUsedIntervalMs: TEST_LAST_USED_INTERVAL_MS,
      store: createInMemoryApiKeyStore(),
      hasher: createWebCryptoKeyHasher("pepper"),
      random: seededRandomSource(1),
      clock: createManualClock(TEST_START),
      scopes: testScopesSchema,
      claims: testClaimsSchema,
      authoriser: testAuthoriser,
    };
    expect(() => createApiKeyService(valid)).not.toThrow();
    expect(() => createApiKeyService({ ...valid, prefix: "" })).toThrow();
    expect(() =>
      createApiKeyService({ ...valid, prefix: "has space_" }),
    ).toThrow();
    expect(() => createApiKeyService({ ...valid, maxLifetimeMs: 0 })).toThrow();
    expect(() =>
      createApiKeyService({ ...valid, maxLifetimeMs: 1.5 }),
    ).toThrow();
    expect(() =>
      createApiKeyService({ ...valid, lastUsedIntervalMs: 0 }),
    ).toThrow();
    expect(() =>
      createApiKeyService({
        ...valid,
        lastUsedIntervalMs: -TEST_LAST_USED_INTERVAL_MS,
      }),
    ).toThrow();
  });
});

describe("ApiKeyService.create", () => {
  it("returns the key once and stores only its hash", async () => {
    const { service, store } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(created.plaintext.startsWith(TEST_PREFIX)).toBe(true);
    expect(created.key).toEqual({
      id: created.key.id,
      owner: { kind: "user", id: "alice" },
      ownerId: "alice",
      name: "deploys",
      start: created.plaintext.slice(
        0,
        TEST_PREFIX.length + KEY_START_RANDOM_LENGTH,
      ),
      scopes: { access: "read" },
      claims: { provider: "google" },
      createdAt: TEST_START,
      expiresAt: new Date(TEST_START.getTime() + LIFETIME_MS),
      createdBy: undefined,
      lastUsedAt: undefined,
    });
    expect(created.key.id).toMatch(
      new RegExp(`^[0-9A-Za-z]{${KEY_ID_LENGTH}}$`, "u"),
    );
    const [stored] = await store.listByOwner(user("alice"));
    expect(stored?.keyHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(
      created.plaintext.slice(TEST_PREFIX.length),
    );
  });

  it("gives each key a distinct id and secret", async () => {
    const { service } = serviceFixture();
    const first = await service.create(input({ name: "one" }));
    const second = await service.create(input({ name: "two" }));
    if (first.outcome !== "created" || second.outcome !== "created")
      throw new Error("not created");
    expect(first.key.id).not.toBe(second.key.id);
    expect(first.plaintext).not.toBe(second.plaintext);
  });

  it.each([
    ["an empty owner id", input({ owner: { id: "" } }), "owner"],
    ["an empty name", input({ name: "" }), "name"],
    ["a name with surrounding whitespace", input({ name: " deploys" }), "name"],
    [
      "an over-long name",
      input({ name: "x".repeat(API_KEY_NAME_MAX_LENGTH + 1) }),
      "name",
    ],
    ["a zero lifetime", input({ lifetimeMs: 0 }), "lifetime"],
    ["a fractional lifetime", input({ lifetimeMs: 1.5 }), "lifetime"],
    [
      "a lifetime past the maximum",
      input({ lifetimeMs: TEST_MAX_LIFETIME_MS + 1 }),
      "lifetime",
    ],
    [
      "scopes failing their schema",
      // @ts-expect-error scopes the host's schema does not allow, as an untyped caller could pass
      input({ scopes: { access: "everything" } }),
      "scopes",
    ],
    [
      "claims failing their schema",
      // @ts-expect-error claims the host's schema does not allow
      input({ claims: { provider: "github" } }),
      "claims",
    ],
  ])("refuses %s", async (_, refused, field) => {
    const { service, store } = serviceFixture();
    expect(await service.create(refused)).toEqual({
      outcome: "invalid",
      field,
    });
    expect(await store.listByOwner(user("alice"))).toEqual([]);
  });

  it("accepts a name of the maximum length and a lifetime of exactly the maximum", async () => {
    const { service } = serviceFixture();
    const created = await service.create(
      input({
        name: "x".repeat(API_KEY_NAME_MAX_LENGTH),
        lifetimeMs: TEST_MAX_LIFETIME_MS,
      }),
    );
    expect(created.outcome).toBe("created");
  });

  it("refuses a name the owner already uses, but not one another owner uses", async () => {
    const { service } = serviceFixture();
    await service.create(input());
    expect(await service.create(input())).toEqual({ outcome: "name-taken" });
    expect((await service.create(input({ owner: bob }))).outcome).toBe(
      "created",
    );
  });
});

describe("ApiKeyService.verify", () => {
  it("accepts a key it created, with its scopes and claims", async () => {
    const { service } = serviceFixture();
    const created = await service.create(
      input({ scopes: { access: "write", toolsets: ["artifacts"] } }),
    );
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "valid",
      key: created.key,
    });
  });

  it("refuses a malformed key offline, before any hash or read", async () => {
    const { service, calls } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    calls.length = 0;
    const lastCharacter = created.plaintext.at(-1) === "0" ? "1" : "0";
    for (const presented of [
      "",
      "not a key",
      `${created.plaintext.slice(0, -1)}${lastCharacter}`,
      created.plaintext.replace(TEST_PREFIX, "other_"),
    ]) {
      expect(await service.verify(presented)).toEqual({
        outcome: "malformed",
      });
    }
    expect(calls).toEqual([]);
  });

  it("refuses a well-formed key nobody created as unknown, after one hash and one read", async () => {
    const { service, calls } = serviceFixture();
    const other = serviceFixture();
    const created = await other.service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "unknown",
    });
    expect(calls.map((call) => `${call.port}.${call.method}`)).toEqual([
      "hasher.hash",
      "store.findByHash",
    ]);
  });

  it("counts a stored key whose scopes or claims fail their schema as unknown", async () => {
    const store = createInMemoryApiKeyStore();
    const { service } = serviceFixture({ store });
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    const [stored] = await store.listByOwner(user("alice"));
    if (stored === undefined) throw new Error("not stored");
    const hasher = createWebCryptoKeyHasher("test pepper");

    await store.delete({ id: stored.id });
    await store.insert({ ...stored, scopes: { access: "everything" } });
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "unknown",
    });

    await store.delete({ id: stored.id });
    await store.insert({ ...stored, claims: "not an object" });
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "unknown",
    });

    expect(await hasher.hash(created.plaintext)).toBe(stored.keyHash);
  });

  it("accepts a key until its expiry instant and refuses it from then on, naming it, its owner and its creation", async () => {
    const { service, clock } = serviceFixture();
    const created = await service.create(input({ lifetimeMs: DAY_MS }));
    if (created.outcome !== "created") throw new Error(created.outcome);
    clock.advance(DAY_MS - 1);
    expect((await service.verify(created.plaintext)).outcome).toBe("valid");
    clock.advance(1);
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "expired",
      id: created.key.id,
      owner: { kind: "user", id: "alice" },
      ownerId: "alice",
      createdAt: created.key.createdAt,
    });
  });

  it("never writes the last-used time itself, so a key the host refuses doesn't look used", async () => {
    const { service, store, calls } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect((await service.verify(created.plaintext)).outcome).toBe("valid");
    expect(calls.some((call) => call.method === "touchLastUsed")).toBe(false);
    expect(
      (await store.listByOwner(user("alice")))[0]?.lastUsedAt,
    ).toBeUndefined();
  });
});

describe("ApiKeyService.recordUse", () => {
  /** Verifies a key and records its use when it's valid, as a host that accepts every valid key does. */
  async function useKey(
    service: ReturnType<typeof serviceFixture>["service"],
    plaintext: string,
    defer: (task: Readonly<Promise<unknown>>) => void,
  ) {
    const verified = await service.verify(plaintext);
    if (verified.outcome === "valid") {
      await service.recordUse(verified.key, { defer });
    }

    return verified;
  }

  it("writes the last-used time on first use, then not again until it is more than an interval old", async () => {
    const { service, store, clock, deferred, defer } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    const lastUsed = async () =>
      (await store.listByOwner(user("alice")))[0]?.lastUsedAt;

    await useKey(service, created.plaintext, defer);
    expect(deferred).toHaveLength(1);
    expect(await deferred[0]).toEqual({ outcome: "touched" });
    expect(await lastUsed()).toEqual(TEST_START);

    await useKey(service, created.plaintext, defer);
    clock.advance(TEST_LAST_USED_INTERVAL_MS);
    const atInterval = await useKey(service, created.plaintext, defer);
    expect(deferred).toHaveLength(1);
    expect(atInterval).toEqual({
      outcome: "valid",
      key: { ...created.key, lastUsedAt: TEST_START },
    });

    clock.advance(1);
    await useKey(service, created.plaintext, defer);
    expect(deferred).toHaveLength(2);
    expect(await deferred[1]).toEqual({ outcome: "touched" });
    expect(await lastUsed()).toEqual(
      new Date(TEST_START.getTime() + TEST_LAST_USED_INTERVAL_MS + 1),
    );
  });

  it("writes at most once per interval however often a key is used", async () => {
    const { service, clock, deferred, defer } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    const minutes =
      (INTERVALS_OBSERVED * TEST_LAST_USED_INTERVAL_MS) / MINUTE_MS;
    const outcomes: string[] = [];
    for (let elapsed = 0; elapsed < minutes; elapsed++) {
      await useKey(service, created.plaintext, defer);
      for (const task of deferred.splice(0)) {
        const result = await task;
        if (
          typeof result === "object" &&
          result !== null &&
          "outcome" in result
        ) {
          outcomes.push(String(result.outcome));
        }
      }
      clock.advance(MINUTE_MS);
    }
    expect(outcomes).toEqual(["touched", "touched", "touched"]);
  });

  it("hands two racing verifications' writes to the store's conditional write, which writes once", async () => {
    const { service, deferred, defer } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    await Promise.all([
      useKey(service, created.plaintext, defer),
      useKey(service, created.plaintext, defer),
    ]);
    const results = await Promise.all(deferred);
    expect(results).toContainEqual({ outcome: "touched" });
    expect(
      results.filter(
        (result) => JSON.stringify(result) === '{"outcome":"touched"}',
      ),
    ).toHaveLength(1);
  });
});

describe("ApiKeyService.list", () => {
  it("lists the owner's keys newest first, and no one else's", async () => {
    const { service, clock } = serviceFixture();
    await service.create(input({ name: "first" }));
    clock.advance(1);
    await service.create(input({ name: "second" }));
    await service.create(input({ owner: bob, name: "bob's" }));
    const listed = await service.list(alice);
    expect(listed.map((entry) => [entry.status, entry.key.name])).toEqual([
      ["valid", "second"],
      ["valid", "first"],
    ]);
  });

  it("lists a key whose stored scopes fail their schema as unreadable, without its scopes, so it can still be revoked", async () => {
    const store = createInMemoryApiKeyStore();
    const { service } = serviceFixture({ store });
    const unreadable = storedKey("alice", { scopes: { access: "everything" } });
    await store.insert(unreadable);
    expect(await service.list(alice)).toEqual([
      {
        status: "unreadable",
        key: {
          id: unreadable.id,
          owner: { kind: "user", id: "alice" },
          ownerId: "alice",
          name: unreadable.name,
          start: unreadable.start,
          createdAt: unreadable.createdAt,
          expiresAt: unreadable.expiresAt,
          lastUsedAt: undefined,
        },
      },
    ]);
    expect(await service.revoke({ id: unreadable.id, owner: alice })).toEqual({
      outcome: "revoked",
    });
  });
});

describe("ApiKeyService.revoke and revokeAllForOwner", () => {
  it("revokes a key so it no longer verifies", async () => {
    const { service } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(await service.revoke({ id: created.key.id })).toEqual({
      outcome: "revoked",
    });
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "unknown",
    });
    expect(await service.revoke({ id: created.key.id })).toEqual({
      outcome: "not-found",
    });
  });

  it("refuses to revoke another owner's key when an owner is named", async () => {
    const { service } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(await service.revoke({ id: created.key.id, owner: bob })).toEqual({
      outcome: "not-found",
    });
    expect((await service.verify(created.plaintext)).outcome).toBe("valid");
  });

  it("revokes every key of one owner and leaves others working", async () => {
    const { service } = serviceFixture();
    const first = await service.create(input({ name: "one" }));
    const second = await service.create(input({ name: "two" }));
    const bobs = await service.create(input({ owner: bob }));
    if (
      first.outcome !== "created" ||
      second.outcome !== "created" ||
      bobs.outcome !== "created"
    ) {
      throw new Error("not created");
    }
    expect(await service.revokeAllForOwner(alice)).toEqual({ revoked: 2 });
    expect((await service.verify(first.plaintext)).outcome).toBe("unknown");
    expect((await service.verify(second.plaintext)).outcome).toBe("unknown");
    expect((await service.verify(bobs.plaintext)).outcome).toBe("valid");
    expect(await service.revokeAllForOwner(alice)).toEqual({ revoked: 0 });
  });
});

describe("ApiKeyService.authorise", () => {
  it("decides by the injected authoriser over the key's scopes", async () => {
    const { service } = serviceFixture();
    const reader = await service.create(input({ name: "reader" }));
    const writer = await service.create(
      input({ name: "writer", scopes: { access: "write" } }),
    );
    if (reader.outcome !== "created" || writer.outcome !== "created")
      throw new Error("not created");
    expect(service.authorise(reader.key, { writes: false })).toEqual({
      outcome: "allowed",
    });
    expect(service.authorise(reader.key, { writes: true })).toEqual({
      outcome: "denied",
    });
    expect(service.authorise(writer.key, { writes: true })).toEqual({
      outcome: "allowed",
    });
  });
});

describe("abort signals", () => {
  it("refuses every operation once its signal has aborted, before touching a port", async () => {
    const { service, calls } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    calls.length = 0;
    const signal = abortedSignal();
    await expect(
      service.create(input({ name: "other" }), { signal }),
    ).rejects.toThrow("aborted by the test");
    await expect(service.verify(created.plaintext, { signal })).rejects.toThrow(
      "aborted",
    );
    await expect(service.list(alice, { signal })).rejects.toThrow("aborted");
    await expect(
      service.revoke({ id: created.key.id }, { signal }),
    ).rejects.toThrow("aborted");
    await expect(service.revokeAllForOwner(alice, { signal })).rejects.toThrow(
      "aborted",
    );
    expect(calls).toEqual([]);
  });

  it("passes the caller's signal to every port it calls", async () => {
    const { service, calls } = serviceFixture();
    const signal = new AbortController().signal;
    const created = await service.create(input(), { signal });
    if (created.outcome !== "created") throw new Error(created.outcome);
    await service.verify(created.plaintext, { signal });
    await service.list(alice, { signal });
    await service.revoke({ id: "missing" }, { signal });
    await service.revokeAllForOwner(bob, { signal });
    const unsignalled = calls.filter(
      (call) => call.signal !== signal && call.method !== "touchLastUsed",
    );
    expect(unsignalled).toEqual([]);
    expect(new Set(calls.map((call) => call.port))).toEqual(
      new Set(["store", "hasher", "random", "clock"]),
    );
  });

  it("does not tie the deferred last-used write to the request's signal", async () => {
    const { service, calls, deferred, defer } = serviceFixture();
    const created = await service.create(input());
    if (created.outcome !== "created") throw new Error(created.outcome);
    const controller = new AbortController();
    const verified = await service.verify(created.plaintext, {
      signal: controller.signal,
    });
    if (verified.outcome !== "valid") throw new Error(verified.outcome);
    expect(
      await service.recordUse(verified.key, {
        defer,
        signal: controller.signal,
      }),
    ).toEqual({ outcome: "scheduled" });
    controller.abort();
    expect(await deferred[0]).toEqual({ outcome: "touched" });
    const touch = calls.find((call) => call.method === "touchLastUsed");
    expect(touch).toEqual({
      port: "store",
      method: "touchLastUsed",
      signal: undefined,
    });
  });
});

describe("system principals' keys", () => {
  it("creates a key owned by a system principal, recording who created it, and verifies it with its owner's kind", async () => {
    const { service, store } = serviceFixture();
    const created = await service.create(
      input({ owner: deployer, createdBy: "alice" }),
    );
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(created.key).toMatchObject({
      owner: { kind: "system", id: "deployer" },
      ownerId: "deployer",
      createdBy: "alice",
      expiresAt: new Date(TEST_START.getTime() + LIFETIME_MS),
    });
    expect(await store.listByOwner(system("deployer"))).toHaveLength(1);
    expect(await store.listByOwner(user("deployer"))).toEqual([]);
    const verified = await service.verify(created.plaintext);
    expect(verified).toEqual({ outcome: "valid", key: created.key });
  });

  it("reads an owner named without a kind as a person, exactly as before system principals existed", async () => {
    const { service } = serviceFixture();
    const created = await service.create(input({ owner: { id: "alice" } }));
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(created.key.owner).toEqual({ kind: "user", id: "alice" });
    expect(await service.list({ kind: "user", id: "alice" })).toHaveLength(1);
    expect(await service.list(aliceSystem)).toEqual([]);
  });

  it("distinguishes the owner's kind in the verify result's type, without a cast", async () => {
    const { service } = serviceFixture();
    const created = await service.create(input({ owner: deployer }));
    if (created.outcome !== "created") throw new Error(created.outcome);
    const verified = await service.verify(created.plaintext);
    if (verified.outcome !== "valid") throw new Error(verified.outcome);
    const { owner } = verified.key;
    if (owner.kind === "user") throw new Error("a person's key");
    expectTypeOf(owner).toEqualTypeOf<ApiKeySystemOwner>();
    expect(owner).toEqual(deployer);
    if (verified.key.owner.kind === "user") {
      expectTypeOf(verified.key.owner).toEqualTypeOf<ApiKeyUserOwner>();
    }
  });

  it.each([
    ["an empty principal id", { kind: "system", id: "" }],
    [
      "a kind that is neither a person nor a principal",
      { kind: "robot", id: "x" },
    ],
    ["a misspelt kind", { kind: "System", id: "deployer" }],
  ])("refuses %s, and never reads it as a person", async (_, owner) => {
    const { service, store } = serviceFixture();
    expect(
      // @ts-expect-error an owner the schema refuses, as an untyped caller could pass
      await service.create(input({ owner })),
    ).toEqual({ outcome: "invalid", field: "owner" });
    expect(await store.listByOwner(user(owner.id))).toEqual([]);
    // @ts-expect-error as above
    await expect(service.list(owner)).rejects.toThrow();
    // @ts-expect-error as above
    await expect(service.revoke({ id: "any", owner })).rejects.toThrow();
    // @ts-expect-error as above
    await expect(service.revokeAllForOwner(owner)).rejects.toThrow();
  });

  it("refuses an empty creator", async () => {
    const { service } = serviceFixture();
    expect(await service.create(input({ createdBy: "" }))).toEqual({
      outcome: "invalid",
      field: "createdBy",
    });
  });

  it("keeps names unique per owner: a person and a principal with the same id may each use a name once", async () => {
    const { service } = serviceFixture();
    expect((await service.create(input({ owner: alice }))).outcome).toBe(
      "created",
    );
    expect((await service.create(input({ owner: aliceSystem }))).outcome).toBe(
      "created",
    );
    expect(await service.create(input({ owner: aliceSystem }))).toEqual({
      outcome: "name-taken",
    });
    expect(await service.create(input({ owner: alice }))).toEqual({
      outcome: "name-taken",
    });
    expect((await service.create(input({ owner: deployer }))).outcome).toBe(
      "created",
    );
  });

  it("revokes a principal's key only when the named owner matches in kind as well as id", async () => {
    const { service } = serviceFixture();
    const created = await service.create(input({ owner: aliceSystem }));
    if (created.outcome !== "created") throw new Error(created.outcome);
    for (const owner of [
      alice,
      { kind: "user", id: "alice" } as const,
      deployer,
    ]) {
      expect(await service.revoke({ id: created.key.id, owner })).toEqual({
        outcome: "not-found",
      });
    }
    expect((await service.verify(created.plaintext)).outcome).toBe("valid");
    expect(
      await service.revoke({ id: created.key.id, owner: aliceSystem }),
    ).toEqual({ outcome: "revoked" });
  });

  it("revokes every key of one owner, leaving the other kind's keys with the same id working", async () => {
    const { service } = serviceFixture();
    const persons = await service.create(input({ owner: alice }));
    const principals = await service.create(input({ owner: aliceSystem }));
    if (persons.outcome !== "created" || principals.outcome !== "created") {
      throw new Error("not created");
    }
    expect(await service.revokeAllForOwner(alice)).toEqual({ revoked: 1 });
    expect((await service.verify(principals.plaintext)).outcome).toBe("valid");
    expect(await service.revokeAllForOwner(aliceSystem)).toEqual({
      revoked: 1,
    });
    expect((await service.verify(principals.plaintext)).outcome).toBe(
      "unknown",
    );
  });

  it("applies the usual expiry rules to a principal's key created with a lifetime", async () => {
    const { service, clock } = serviceFixture({
      allowNonExpiringSystemKeys: true,
    });
    expect(
      await service.create(
        input({ owner: deployer, lifetimeMs: TEST_MAX_LIFETIME_MS + 1 }),
      ),
    ).toEqual({ outcome: "invalid", field: "lifetime" });
    expect(
      await service.create(input({ owner: deployer, lifetimeMs: 0 })),
    ).toEqual({ outcome: "invalid", field: "lifetime" });
    const created = await service.create(
      input({ owner: deployer, lifetimeMs: DAY_MS }),
    );
    if (created.outcome !== "created") throw new Error(created.outcome);
    clock.advance(DAY_MS - 1);
    expect((await service.verify(created.plaintext)).outcome).toBe("valid");
    clock.advance(1);
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "expired",
      id: created.key.id,
      owner: deployer,
      ownerId: "deployer",
      createdAt: created.key.createdAt,
    });
  });

  it("refuses a key with no expiry for a person, even when the host allows principals' keys to have none", async () => {
    const { service, store } = serviceFixture({
      allowNonExpiringSystemKeys: true,
    });
    for (const owner of [alice, { kind: "user", id: "alice" } as const]) {
      expect(await service.create(input({ owner, lifetimeMs: null }))).toEqual({
        outcome: "invalid",
        field: "lifetime",
      });
    }
    expect(await store.listByOwner(user("alice"))).toEqual([]);
  });

  it.each([
    ["by default", {}],
    ["when the host turns it off", { allowNonExpiringSystemKeys: false }],
  ])("refuses a principal's key with no expiry %s", async (_, options) => {
    const { service, store } = serviceFixture(options);
    expect(
      await service.create(input({ owner: deployer, lifetimeMs: null })),
    ).toEqual({ outcome: "invalid", field: "lifetime" });
    expect(await store.listByOwner(system("deployer"))).toEqual([]);
  });

  it("creates a principal's key with no expiry when the host allows it, which never expires", async () => {
    const { service, clock } = serviceFixture({
      allowNonExpiringSystemKeys: true,
    });
    const created = await service.create(
      input({ owner: deployer, lifetimeMs: null }),
    );
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(created.key.expiresAt).toBeNull();
    clock.advance(YEARS_LATER * TEST_MAX_LIFETIME_MS);
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "valid",
      key: created.key,
    });
    expect(await service.list(deployer)).toEqual([
      { status: "valid", key: created.key },
    ]);
  });

  it("refuses a stored key with no expiry unless it is a principal's and the host allows it, listing it as unreadable so it can be revoked", async () => {
    const store = createInMemoryApiKeyStore();
    const allowing = serviceFixture({
      store,
      allowNonExpiringSystemKeys: true,
    });
    const principals = await allowing.service.create(
      input({ owner: deployer, lifetimeMs: null }),
    );
    const persons = await allowing.service.create(input());
    if (principals.outcome !== "created" || persons.outcome !== "created") {
      throw new Error("not created");
    }
    const [storedPersons] = await store.listByOwner(user("alice"));
    if (storedPersons === undefined) throw new Error("not stored");
    await store.delete({ id: storedPersons.id });
    await store.insert({ ...storedPersons, expiresAt: null });
    expect(await allowing.service.verify(persons.plaintext)).toEqual({
      outcome: "unknown",
    });
    expect(await allowing.service.list(alice)).toMatchObject([
      { status: "unreadable", key: { expiresAt: null } },
    ]);

    const { service } = serviceFixture({ store });
    expect(await service.verify(principals.plaintext)).toEqual({
      outcome: "unknown",
    });
    expect(await service.list(deployer)).toMatchObject([
      { status: "unreadable", key: { id: principals.key.id } },
    ]);
    expect(
      await service.revoke({ id: principals.key.id, owner: deployer }),
    ).toEqual({ outcome: "revoked" });
  });

  it("throttles the last-used write of a principal's key as it does a person's", async () => {
    const { service, store, clock, deferred, defer } = serviceFixture({
      allowNonExpiringSystemKeys: true,
    });
    const created = await service.create(
      input({ owner: deployer, lifetimeMs: null }),
    );
    if (created.outcome !== "created") throw new Error(created.outcome);
    const use = async () => {
      const verified = await service.verify(created.plaintext);
      if (verified.outcome !== "valid") throw new Error(verified.outcome);

      return service.recordUse(verified.key, { defer });
    };
    expect(await use()).toEqual({ outcome: "scheduled" });
    expect(await deferred[0]).toEqual({ outcome: "touched" });
    clock.advance(TEST_LAST_USED_INTERVAL_MS);
    expect(await use()).toEqual({ outcome: "not-due" });
    clock.advance(1);
    expect(await use()).toEqual({ outcome: "scheduled" });
    expect(await deferred[1]).toEqual({ outcome: "touched" });
    expect(
      (await store.listByOwner(system("deployer")))[0]?.lastUsedAt,
    ).toEqual(new Date(TEST_START.getTime() + TEST_LAST_USED_INTERVAL_MS + 1));
  });
});
