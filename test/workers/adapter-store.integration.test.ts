import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  apiKeys,
  apiKeysOf,
  createAdapterApiKeyStore,
} from "../../src/better-auth/index.ts";
import { generateKey, keyStart } from "../../src/core/index.ts";
import { seededRandomSource } from "../../src/test-support/random-sources.ts";
import {
  DAY_MS,
  TEST_PREFIX,
  TEST_START,
} from "../../src/test-support/service-fixture.ts";
import {
  describeApiKeyStoreContract,
  listedKeys,
  storedKey,
  user,
} from "../../src/test-support/store-contract.ts";
import {
  TEST_PEPPER,
  testPlugin,
  testPluginOptions,
} from "../../src/test-support/plugin-fixture.ts";
import { createWebCryptoKeyHasher } from "../../src/web-crypto/index.ts";
import {
  addUser,
  d1Auth,
  describeApiKeyTable,
  migrateFromV0_1_0,
  resetDatabase,
  resetToV0_1_0,
} from "./d1-fixture.ts";
import { readmeMigration, statementsOf } from "./readme-migration.ts";

const LIFETIME_DAYS = 30;
const LIFETIME_MS = LIFETIME_DAYS * DAY_MS;

// The adapter-backed store against the genuine D1 engine through better-auth's Drizzle adapter, the same path a host on Workers takes: the port's guarantees, the database's own constraints, and the plugin schema passing better-auth's production schema check.
describeApiKeyStoreContract(
  "the adapter store over Drizzle on D1",
  async () => {
    await resetDatabase();
    const context = await d1Auth(testPlugin()).$context;

    return {
      store: createAdapterApiKeyStore(() => context.adapter),
      addOwner: addUser,
    };
  },
);

describe("the plugin on D1", () => {
  beforeEach(async () => {
    await resetDatabase();
    await addUser("alice");
  });

  it("passes better-auth's schema check against a Drizzle table declared from the plugin schema", async () => {
    const context = await d1Auth(testPlugin()).$context;
    if (context.checkSchema === undefined)
      throw new Error("The Drizzle adapter registers a schema check");
    await expect(context.checkSchema()).resolves.toBeUndefined();
  });

  it("stores scopes and claims as JSON text, encoded once", async () => {
    const context = await d1Auth(testPlugin()).$context;
    const store = createAdapterApiKeyStore(() => context.adapter);
    const key = storedKey("alice", {
      scopes: { access: "write", toolsets: ["artifacts"] },
      claims: { provider: "google" },
    });
    await store.insert(key);
    const row = await env.DATABASE.prepare(
      "SELECT scopes, claims FROM api_key WHERE id = ?",
    )
      .bind(key.id)
      .first();
    expect(row).toEqual({
      scopes: JSON.stringify({ access: "write", toolsets: ["artifacts"] }),
      claims: JSON.stringify({ provider: "google" }),
    });
  });

  it("refuses a duplicate hash at the database, and reports it as an error rather than a taken name", async () => {
    const context = await d1Auth(testPlugin()).$context;
    const store = createAdapterApiKeyStore(() => context.adapter);
    const key = storedKey("alice");
    await store.insert(key);
    await expect(
      store.insert({ ...key, id: "another-id", name: "another name" }),
    ).rejects.toThrow();
  });

  it("reports the loser of two racing inserts with the same owner and name as a taken name", async () => {
    const context = await d1Auth(testPlugin()).$context;
    const store = createAdapterApiKeyStore(() => context.adapter);
    const outcomes = await Promise.all([
      store.insert(storedKey("alice", { name: "deploys" })),
      store.insert(storedKey("alice", { name: "deploys" })),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "inserted",
      "name-taken",
    ]);
    expect(await listedKeys(store, user("alice"))).toHaveLength(1);
  });

  it("deletes a person's keys with the person", async () => {
    const context = await d1Auth(testPlugin()).$context;
    const store = createAdapterApiKeyStore(() => context.adapter);
    await store.insert(storedKey("alice"));
    await env.DATABASE.prepare("DELETE FROM user WHERE id = ?")
      .bind("alice")
      .run();
    expect(await listedKeys(store, user("alice"))).toEqual([]);
  });

  it("deletes only the person's keys with the person: a system principal's keys, even one sharing the person's id, survive and still verify", async () => {
    const plugin = apiKeys({
      ...testPluginOptions(),
      allowNonExpiringSystemKeys: true,
    });
    const context = await d1Auth(plugin).$context;
    const service = apiKeysOf(context, plugin);
    const common = {
      scopes: { access: "read" },
      claims: { provider: "otp" },
    } as const;
    const persons = await service.create({
      ...common,
      owner: { kind: "user", id: "alice" },
      name: "laptop",
      lifetimeMs: LIFETIME_MS,
    });
    const principals = await service.create({
      ...common,
      owner: { kind: "system", id: "deployer" },
      name: "deploys",
      lifetimeMs: null,
      createdBy: "alice",
    });
    const sameId = await service.create({
      ...common,
      owner: { kind: "system", id: "alice" },
      name: "laptop",
      lifetimeMs: LIFETIME_MS,
    });
    if (
      persons.outcome !== "created" ||
      principals.outcome !== "created" ||
      sameId.outcome !== "created"
    ) {
      throw new Error("not created");
    }

    await env.DATABASE.prepare("DELETE FROM user WHERE id = ?")
      .bind("alice")
      .run();

    expect(await service.verify(persons.plaintext)).toEqual({
      outcome: "unknown",
    });
    expect(await service.list({ kind: "user", id: "alice" })).toEqual([]);
    expect(await service.verify(principals.plaintext)).toEqual({
      outcome: "valid",
      key: principals.key,
    });
    expect(principals.key).toMatchObject({
      owner: { kind: "system", id: "deployer" },
      expiresAt: null,
      createdBy: "alice",
    });
    expect(await service.verify(sameId.plaintext)).toEqual({
      outcome: "valid",
      key: sameId.key,
    });
  });

  it("refuses a row whose user reference disagrees with its owner, or a person's key with no expiry, at the database, by the check the README recommends", async () => {
    await addUser("bob");
    const insert = env.DATABASE.prepare(
      "INSERT INTO api_key (id, owner_kind, owner_id, user_id, name, key_hash, start, scopes, claims, created_at, expires_at) VALUES (?, ?, ?, ?, 'n', ?, 's', '{}', '{}', 0, ?)",
    );
    for (const [kind, ownerId, userId, expiresAt] of [
      ["system", "bob", "bob", 1],
      ["user", "bob", null, 1],
      ["user", "alice", "bob", 1],
      ["user", "bob", "bob", null],
      ["robot", "bob", null, 1],
    ] as const) {
      const id = `${kind}-${ownerId}-${userId}-${expiresAt}`;
      await expect(
        insert.bind(id, kind, ownerId, userId, id, expiresAt).run(),
      ).rejects.toThrow("CHECK constraint failed");
    }
    await insert.bind("person", "user", "bob", "bob", "hash-person", 1).run();
    await insert
      .bind("principal", "system", "bob", null, "hash-principal", null)
      .run();
  });

  it("creates, verifies with one throttled write, and revokes a key end to end", async () => {
    const plugin = testPlugin();
    const context = await d1Auth(plugin).$context;
    const service = apiKeysOf(context, plugin);
    const created = await service.create({
      owner: { kind: "user", id: "alice" },
      name: "deploys",
      lifetimeMs: LIFETIME_MS,
      scopes: { access: "read" },
      claims: { provider: "otp" },
    });
    if (created.outcome !== "created") throw new Error(created.outcome);

    const deferred: Promise<unknown>[] = [];
    const defer = (task: Readonly<Promise<unknown>>) => {
      deferred.push(task);
    };
    const verified = await service.verify(created.plaintext);
    if (verified.outcome !== "valid") throw new Error(verified.outcome);
    await service.recordUse(verified.key, { defer });
    expect(await Promise.all(deferred.splice(0))).toEqual([
      { outcome: "touched" },
    ]);
    const lastUsed = await env.DATABASE.prepare(
      "SELECT last_used_at FROM api_key WHERE id = ?",
    )
      .bind(created.key.id)
      .first("last_used_at");
    expect(lastUsed).toBe(created.key.createdAt.getTime());

    const again = await service.verify(created.plaintext);
    if (again.outcome !== "valid") throw new Error(again.outcome);
    expect(await service.recordUse(again.key, { defer })).toEqual({
      outcome: "not-due",
    });
    expect(deferred).toEqual([]);

    expect(
      await service.revoke({
        id: created.key.id,
        owner: { kind: "user", id: "alice" },
      }),
    ).toEqual({
      outcome: "revoked",
    });
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "unknown",
    });
  });

  it("creates, verifies, records the use of, lists and revokes a system principal's key end to end", async () => {
    const plugin = testPlugin();
    const context = await d1Auth(plugin).$context;
    const service = apiKeysOf(context, plugin);
    const deployer = { kind: "system", id: "deployer" } as const;
    const created = await service.create({
      owner: deployer,
      name: "deploys",
      lifetimeMs: LIFETIME_MS,
      scopes: { access: "write" },
      claims: { provider: "google" },
    });
    if (created.outcome !== "created") throw new Error(created.outcome);
    const row = await env.DATABASE.prepare(
      "SELECT owner_kind, owner_id, user_id FROM api_key WHERE id = ?",
    )
      .bind(created.key.id)
      .first();
    expect(row).toEqual({
      owner_kind: "system",
      owner_id: "deployer",
      user_id: null,
    });

    const verified = await service.verify(created.plaintext);
    if (verified.outcome !== "valid") throw new Error(verified.outcome);
    expect(verified.key.owner).toEqual(deployer);
    const deferred: Promise<unknown>[] = [];
    await service.recordUse(verified.key, {
      defer: (task) => {
        deferred.push(task);
      },
    });
    expect(await Promise.all(deferred)).toEqual([{ outcome: "touched" }]);
    expect(await service.list(deployer)).toEqual([
      {
        status: "valid",
        key: { ...created.key, lastUsedAt: created.key.createdAt },
      },
    ]);
    expect(await service.list({ kind: "user", id: "deployer" })).toEqual([]);
    expect(
      await service.revoke({
        id: created.key.id,
        owner: { kind: "user", id: "deployer" },
      }),
    ).toEqual({ outcome: "not-found" });
    expect(await service.revokeAllForOwner(deployer)).toEqual({ revoked: 1 });
    expect(await service.verify(created.plaintext)).toEqual({
      outcome: "unknown",
    });
  });
});

describe("upgrading a 0.1.0 database", () => {
  /** A 0.1.0 key of `userId`'s, last used at `TEST_START`, with its plaintext. */
  async function insertV0_1_0Key(id: string, userId: string, seed: number) {
    const plaintext = await generateKey(TEST_PREFIX, seededRandomSource(seed));
    const keyHash = await createWebCryptoKeyHasher(TEST_PEPPER).hash(plaintext);
    const expiresAt = TEST_START.getTime() + LIFETIME_MS;
    await env.DATABASE.prepare(
      "INSERT INTO api_key (id, user_id, name, key_hash, start, scopes, claims, created_at, expires_at, last_used_at) VALUES (?, ?, 'laptop', ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        userId,
        keyHash,
        keyStart(TEST_PREFIX, plaintext),
        JSON.stringify({ access: "read" }),
        JSON.stringify({ provider: "google" }),
        TEST_START.getTime(),
        expiresAt,
        TEST_START.getTime(),
      )
      .run();

    return { plaintext, expiresAt };
  }

  it("gives the plain SQLite migration exactly the D1 file's statements, inside one transaction", () => {
    const { d1, sqlite } = readmeMigration();
    expect(statementsOf(d1).length).toBeGreaterThan(0);
    expect(sqlite).toBe(`BEGIN;\n${d1}COMMIT;\n`);
  });

  it("keeps a person's key, with its last use, verifying after the README's migration, builds the declared table, and then accepts system keys", async () => {
    await resetDatabase();
    const declared = await describeApiKeyTable();
    await resetToV0_1_0();
    await addUser("alice");
    const { plaintext, expiresAt } = await insertV0_1_0Key(
      "old-key",
      "alice",
      1,
    );

    await migrateFromV0_1_0();

    // better-auth's Drizzle schema check compares the plugin's schema with the Drizzle declaration, never the database, so it cannot tell whether the migration ran; the database's own description of the table can.
    expect(await describeApiKeyTable()).toEqual(declared);
    const plugin = testPlugin();
    const context = await d1Auth(plugin).$context;
    const service = apiKeysOf(context, plugin);
    const verified = await service.verify(plaintext);
    expect(verified).toMatchObject({
      outcome: "valid",
      key: {
        id: "old-key",
        owner: { kind: "user", id: "alice" },
        expiresAt: new Date(expiresAt),
        lastUsedAt: TEST_START,
      },
    });
    const created = await service.create({
      owner: { kind: "system", id: "deployer" },
      name: "laptop",
      lifetimeMs: LIFETIME_MS,
      scopes: { access: "read" },
      claims: { provider: "google" },
    });
    expect(created.outcome).toBe("created");
  });

  it("enforces the owner check, the unique name per owner and the cascading delete on the migrated table", async () => {
    await resetToV0_1_0();
    await addUser("alice");
    const { plaintext } = await insertV0_1_0Key("old-key", "alice", 1);
    await migrateFromV0_1_0();

    const insert = env.DATABASE.prepare(
      "INSERT INTO api_key (id, owner_kind, owner_id, user_id, name, key_hash, start, scopes, claims, created_at, expires_at) VALUES (?, ?, 'alice', ?, 'laptop', ?, 's', '{}', '{}', 0, 1)",
    );
    await expect(
      insert.bind("same-name", "user", "alice", "hash-same-name").run(),
    ).rejects.toThrow("UNIQUE constraint failed");
    await expect(
      insert.bind("disagreeing", "system", "alice", "hash-disagreeing").run(),
    ).rejects.toThrow("CHECK constraint failed");
    await insert.bind("principals", "system", null, "hash-principals").run();

    await env.DATABASE.prepare("DELETE FROM user WHERE id = ?")
      .bind("alice")
      .run();
    const plugin = testPlugin();
    const service = apiKeysOf(await d1Auth(plugin).$context, plugin);
    expect(await service.verify(plaintext)).toEqual({ outcome: "unknown" });
    const remaining = await env.DATABASE.prepare(
      "SELECT id FROM api_key",
    ).all();
    expect(remaining.results).toEqual([{ id: "principals" }]);
  });

  it("changes nothing when a key whose person is gone makes the copy fail", async () => {
    await resetToV0_1_0({ foreignKeys: false });
    await addUser("alice");
    await insertV0_1_0Key("kept", "alice", 1);
    await insertV0_1_0Key("orphaned", "nobody", 2);

    await expect(migrateFromV0_1_0()).rejects.toThrow(
      "FOREIGN KEY constraint failed",
    );

    const kept = await env.DATABASE.prepare(
      "SELECT id FROM api_key ORDER BY id",
    ).all();
    expect(kept.results).toEqual([{ id: "kept" }, { id: "orphaned" }]);
    const tables = await env.DATABASE.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'api_key%'",
    ).all();
    expect(tables.results).toEqual([{ name: "api_key" }]);
  });
});
