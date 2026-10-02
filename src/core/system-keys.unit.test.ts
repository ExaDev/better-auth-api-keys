import { describe, expect, expectTypeOf, it } from "vitest";
import {
  API_KEY_CREATED_BY_MAX_LENGTH,
  type ApiKeySystemOwner,
  type ApiKeyUserOwner,
} from "../contract/index.ts";
import { createInMemoryApiKeyStore } from "../testing/index.ts";
import {
  DAY_MS,
  TEST_LAST_USED_INTERVAL_MS,
  TEST_MAX_LIFETIME_MS,
  TEST_START,
  serviceFixture,
} from "../test-support/service-fixture.ts";
import {
  LIFETIME_MS,
  YEARS_LATER,
  alice,
  aliceSystem,
  deployer,
  input,
} from "../test-support/service-inputs.ts";
import { listedKeys, system, user } from "../test-support/store-contract.ts";

describe("system principals' keys", () => {
  it("creates a key owned by a system principal, recording who created it, and verifies it with its owner's kind", async () => {
    const { service, store } = serviceFixture();
    const created = await service.create(
      input({ owner: deployer, createdBy: "alice" }),
    );
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(created.key).toMatchObject({
      owner: { kind: "system", id: "deployer" },
      createdBy: "alice",
      expiresAt: new Date(TEST_START.getTime() + LIFETIME_MS),
    });
    expect(await listedKeys(store, system("deployer"))).toHaveLength(1);
    expect(await listedKeys(store, user("deployer"))).toEqual([]);
    const verified = await service.verify(created.plaintext);
    expect(verified).toEqual({ outcome: "valid", key: created.key });
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
    // The owner's id is reachable only through owner, so no caller can take it without seeing its kind.
    expectTypeOf(verified.key).not.toHaveProperty("ownerId");
    expect(verified.key).not.toHaveProperty("ownerId");
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
    ["an owner with no kind", { id: "alice" }],
  ])(
    "refuses %s on every method, and never reads it as a person",
    async (_, owner) => {
      const { service, store } = serviceFixture();
      expect(
        // @ts-expect-error an owner the schema refuses, as an untyped caller could pass
        await service.create(input({ owner })),
      ).toEqual({ outcome: "invalid", field: "owner" });
      expect(await store.listByOwner(user(owner.id))).toEqual([]);
      expect(await store.listByOwner(system(owner.id))).toEqual([]);
      // @ts-expect-error as above
      await expect(service.list(owner)).rejects.toThrow();
      // @ts-expect-error as above
      await expect(service.revoke({ id: "any", owner })).rejects.toThrow();
      // @ts-expect-error as above
      await expect(service.revokeAllForOwner(owner)).rejects.toThrow();
    },
  );

  it("never revokes a person's keys for a principal named without a kind", async () => {
    const { service } = serviceFixture();
    const persons = await service.create(input({ owner: alice }));
    const principals = await service.create(input({ owner: aliceSystem }));
    if (persons.outcome !== "created" || principals.outcome !== "created") {
      throw new Error("not created");
    }
    await expect(
      // @ts-expect-error a principal named without its kind
      service.revokeAllForOwner({ id: aliceSystem.id }),
    ).rejects.toThrow();
    expect((await service.verify(persons.plaintext)).outcome).toBe("valid");
    expect((await service.verify(principals.plaintext)).outcome).toBe("valid");
  });

  it("refuses an empty or over-long creator, and accepts one of the maximum length", async () => {
    const { service } = serviceFixture();
    for (const createdBy of [
      "",
      "x".repeat(API_KEY_CREATED_BY_MAX_LENGTH + 1),
    ]) {
      expect(await service.create(input({ createdBy }))).toEqual({
        outcome: "invalid",
        field: "createdBy",
      });
    }
    const created = await service.create(
      input({ createdBy: "x".repeat(API_KEY_CREATED_BY_MAX_LENGTH) }),
    );
    expect(created.outcome).toBe("created");
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
    expect(await listedKeys(store, user("alice"))).toEqual([]);
  });

  it.each([
    ["by default", {}],
    ["when the host turns it off", { allowNonExpiringSystemKeys: false }],
  ])("refuses a principal's key with no expiry %s", async (_, options) => {
    const { service, store } = serviceFixture(options);
    expect(
      await service.create(input({ owner: deployer, lifetimeMs: null })),
    ).toEqual({ outcome: "invalid", field: "lifetime" });
    expect(await listedKeys(store, system("deployer"))).toEqual([]);
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
    const [storedPersons] = await listedKeys(store, user("alice"));
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
      (await listedKeys(store, system("deployer")))[0]?.lastUsedAt,
    ).toEqual(new Date(TEST_START.getTime() + TEST_LAST_USED_INTERVAL_MS + 1));
  });
});
