import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  apiKeysOf,
  createAdapterApiKeyStore,
} from "../../src/better-auth/index.ts";
import { DAY_MS } from "../../src/test-support/service-fixture.ts";
import {
  describeApiKeyStoreContract,
  storedKey,
} from "../../src/test-support/store-contract.ts";
import { testPlugin } from "../../src/test-support/plugin-fixture.ts";
import { addUser, d1Auth, resetDatabase } from "./d1-fixture.ts";

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
    expect(await store.listByOwner("alice")).toHaveLength(1);
  });

  it("deletes a person's keys with the person", async () => {
    const context = await d1Auth(testPlugin()).$context;
    const store = createAdapterApiKeyStore(() => context.adapter);
    await store.insert(storedKey("alice"));
    await env.DATABASE.prepare("DELETE FROM user WHERE id = ?")
      .bind("alice")
      .run();
    expect(await store.listByOwner("alice")).toEqual([]);
  });

  it("creates, verifies with one throttled write, and revokes a key end to end", async () => {
    const plugin = testPlugin();
    const context = await d1Auth(plugin).$context;
    const service = apiKeysOf(context, plugin);
    const created = await service.create({
      owner: { id: "alice" },
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
    expect((await service.verify(created.plaintext, { defer })).outcome).toBe(
      "valid",
    );
    expect(await Promise.all(deferred.splice(0))).toEqual([
      { outcome: "touched" },
    ]);
    const lastUsed = await env.DATABASE.prepare(
      "SELECT last_used_at FROM api_key WHERE id = ?",
    )
      .bind(created.key.id)
      .first("last_used_at");
    expect(lastUsed).toBe(created.key.createdAt.getTime());

    expect((await service.verify(created.plaintext, { defer })).outcome).toBe(
      "valid",
    );
    expect(deferred).toEqual([]);

    expect(
      await service.revoke({ id: created.key.id, owner: { id: "alice" } }),
    ).toEqual({
      outcome: "revoked",
    });
    expect(await service.verify(created.plaintext, { defer })).toEqual({
      outcome: "unknown",
    });
  });
});
