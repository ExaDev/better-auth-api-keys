import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import {
  TEST_AUTH_SECRET,
  TEST_BASE_URL,
  testPlugin,
  testPluginOptions,
  type TestPlugin,
} from "../test-support/plugin-fixture.ts";
import { DAY_MS } from "../test-support/service-fixture.ts";
import {
  describeApiKeyStoreContract,
  system,
  user,
} from "../test-support/store-contract.ts";
import {
  createAdapterApiKeyStore,
  type ApiKeyDatabaseAdapter,
} from "./adapter-store.ts";
import { API_KEYS_PLUGIN_ID, apiKeys, apiKeysOf } from "./plugin.ts";
import { API_KEY_MODEL, apiKeySchema } from "./schema.ts";

type MemoryDatabase = Record<string, Record<string, unknown>[]>;

function memoryDatabase(): MemoryDatabase {
  return {
    user: [],
    session: [],
    account: [],
    verification: [],
    [API_KEY_MODEL]: [],
  };
}

function authWith({
  plugins = [],
  database = memoryDatabase(),
}: {
  readonly plugins?: readonly TestPlugin[];
  readonly database?: MemoryDatabase;
} = {}) {
  return betterAuth({
    secret: TEST_AUTH_SECRET,
    baseURL: TEST_BASE_URL,
    database: memoryAdapter(database),
    plugins: [...plugins],
  });
}

/** Adds a person through better-auth's own adapter, as a sign-up would. */
async function addUser(
  adapter: Readonly<ApiKeyDatabaseAdapter>,
  id: string,
): Promise<void> {
  await adapter.create({
    model: "user",
    data: { id, name: id, email: `${id}@example.com`, emailVerified: true },
    forceAllowId: true,
  });
}

const createInput = {
  owner: { id: "alice" },
  name: "deploys",
  lifetimeMs: DAY_MS,
  scopes: { access: "read" },
  claims: { provider: "google" },
} as const;

describe("the apiKeys plugin", () => {
  it("contributes no endpoints, hooks, middlewares, request handlers or rate limits", () => {
    const plugin = testPlugin();
    expect(Object.keys(plugin).sort()).toEqual([
      "$ERROR_CODES",
      "$Infer",
      "id",
      "init",
      "schema",
    ]);
    expect(Object.keys(authWith({ plugins: [plugin] }).api).sort()).toEqual(
      Object.keys(authWith().api).sort(),
    );
  });

  it("is identified distinctly from the stock api-key plugin", () => {
    expect(testPlugin().id).toBe(API_KEYS_PLUGIN_ID);
    expect(API_KEYS_PLUGIN_ID).not.toBe("api-key");
  });

  it("registers its error codes with better-auth", () => {
    expect(authWith({ plugins: [testPlugin()] }).$ERROR_CODES).toMatchObject({
      INVALID_API_KEY: { code: "INVALID_API_KEY" },
      API_KEY_EXPIRED: { code: "API_KEY_EXPIRED" },
    });
  });

  it("refuses unusable settings when it is built, before any auth instance exists", () => {
    expect(() => apiKeys({ ...testPluginOptions(), prefix: "" })).toThrow();
    expect(() =>
      apiKeys({ ...testPluginOptions(), maxLifetimeMs: 0 }),
    ).toThrow();
    expect(() =>
      apiKeys({ ...testPluginOptions(), lastUsedIntervalMs: 0 }),
    ).toThrow();
  });

  it("gives a working service bound to better-auth's own adapter", async () => {
    const plugin = testPlugin();
    const context = await authWith({ plugins: [plugin] }).$context;
    await addUser(context.adapter, "alice");
    const service = apiKeysOf(context, plugin);
    const created = await service.create(createInput);
    if (created.outcome !== "created") throw new Error(created.outcome);
    const deferred: Promise<unknown>[] = [];
    const verified = await service.verify(created.plaintext);
    expect(verified).toEqual({ outcome: "valid", key: created.key });
    await service.recordUse(created.key, {
      defer: (task) => {
        deferred.push(task);
      },
    });
    expect(await Promise.all(deferred)).toEqual([{ outcome: "touched" }]);
    expect(
      await context.adapter.findMany({ model: API_KEY_MODEL }),
    ).toHaveLength(1);
  });

  it("finds the service through a copy of the context, as better-auth makes for each request", async () => {
    const plugin = testPlugin();
    const context = await authWith({ plugins: [plugin] }).$context;
    const requestContext = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(context),
    );
    expect(apiKeysOf(requestContext, plugin)).toBe(apiKeysOf(context, plugin));
  });

  it("refuses to hand out a service for an instance the plugin is not registered on", async () => {
    const plugin = testPlugin();
    const context = await authWith({ plugins: [plugin] }).$context;
    const withoutPlugin = await authWith().$context;
    expect(() => apiKeysOf(context, testPlugin())).toThrow("not registered");
    expect(() => apiKeysOf(withoutPlugin, plugin)).toThrow("not registered");
    expect(() => apiKeysOf({ exadevApiKeys: {} }, plugin)).toThrow(
      "not registered",
    );
  });
});

describe("the adapter store's owner invariant", () => {
  /** A row in the model's shape, owned as `owner` says, written straight through the adapter as a broken database or a hand-written migration could. */
  async function insertRow(
    adapter: Readonly<ApiKeyDatabaseAdapter>,
    owner: Readonly<{
      ownerKind: string;
      ownerId: string;
      userId: string | null;
    }>,
  ): Promise<string> {
    const keyHash = `hash-${owner.ownerKind}-${owner.ownerId}-${owner.userId}`;
    await adapter.create({
      model: API_KEY_MODEL,
      data: {
        id: keyHash,
        ...owner,
        name: keyHash,
        keyHash,
        start: "test_abcd",
        scopes: { access: "read" },
        claims: { provider: "google" },
        createdAt: new Date(0),
        expiresAt: null,
        createdBy: null,
        lastUsedAt: null,
      },
      forceAllowId: true,
    });

    return keyHash;
  }

  it.each([
    [
      "a person's key referencing no one",
      { ownerKind: "user", ownerId: "alice", userId: null },
      user("alice"),
    ],
    [
      "a person's key referencing someone else",
      { ownerKind: "user", ownerId: "alice", userId: "bob" },
      user("alice"),
    ],
    [
      "a principal's key referencing a person",
      { ownerKind: "system", ownerId: "alice", userId: "alice" },
      system("alice"),
    ],
    // No owner can be named with an unknown kind, so such a row is only ever found by its hash.
    [
      "a key of an unknown kind",
      { ownerKind: "robot", ownerId: "alice", userId: null },
      undefined,
    ],
  ])("refuses to read %s", async (_, row, listedBy) => {
    const context = await authWith({ plugins: [testPlugin()] }).$context;
    const store = createAdapterApiKeyStore(() => context.adapter);
    const keyHash = await insertRow(context.adapter, row);
    await expect(store.findByHash(keyHash)).rejects.toThrow(
      "must be a person's key referencing that person",
    );
    if (listedBy !== undefined) {
      await expect(store.listByOwner(listedBy)).rejects.toThrow(
        "must be a person's key referencing that person",
      );
    }
  });

  it("reads a consistent row of either kind", async () => {
    const context = await authWith({ plugins: [testPlugin()] }).$context;
    const store = createAdapterApiKeyStore(() => context.adapter);
    const persons = await insertRow(context.adapter, {
      ownerKind: "user",
      ownerId: "alice",
      userId: "alice",
    });
    const principals = await insertRow(context.adapter, {
      ownerKind: "system",
      ownerId: "alice",
      userId: null,
    });
    expect(await store.findByHash(persons)).toMatchObject({
      outcome: "found",
      key: { owner: user("alice"), expiresAt: null },
    });
    expect(await store.findByHash(principals)).toMatchObject({
      outcome: "found",
      key: { owner: system("alice") },
    });
  });

  it("writes a principal's key with no user reference, and a person's with one matching its owner", async () => {
    const plugin = apiKeys({
      ...testPluginOptions(),
      allowNonExpiringSystemKeys: true,
    });
    const context = await authWith({ plugins: [plugin] }).$context;
    await addUser(context.adapter, "alice");
    const service = apiKeysOf(context, plugin);
    const principals = await service.create({
      ...createInput,
      owner: { kind: "system", id: "alice" },
      lifetimeMs: null,
      createdBy: "alice",
    });
    const persons = await service.create(createInput);
    if (principals.outcome !== "created" || persons.outcome !== "created") {
      throw new Error("not created");
    }
    const rows = await context.adapter.findMany({ model: API_KEY_MODEL });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: principals.key.id,
          ownerKind: "system",
          ownerId: "alice",
          userId: null,
          expiresAt: null,
          createdBy: "alice",
        }),
        expect.objectContaining({
          id: persons.key.id,
          ownerKind: "user",
          ownerId: "alice",
          userId: "alice",
          createdBy: null,
        }),
      ]),
    );
  });

  it("refuses a principal's key with no expiry unless the plugin is configured to allow one", async () => {
    const plugin = testPlugin();
    const context = await authWith({ plugins: [plugin] }).$context;
    expect(
      await apiKeysOf(context, plugin).create({
        ...createInput,
        owner: { kind: "system", id: "deployer" },
        lifetimeMs: null,
      }),
    ).toEqual({ outcome: "invalid", field: "lifetime" });
  });
});

describe("apiKeySchema", () => {
  it("declares the apiKey model with a unique hash, a unique name per owner, a user reference only a person's key sets, and an unindexed last-used time", () => {
    expect(apiKeySchema()).toEqual({
      apiKey: {
        fields: {
          ownerKind: { type: "string", required: true },
          ownerId: { type: "string", required: true },
          userId: {
            type: "string",
            required: false,
            references: { model: "user", field: "id", onDelete: "cascade" },
          },
          name: { type: "string", required: true },
          keyHash: { type: "string", required: true, unique: true },
          start: { type: "string", required: true },
          scopes: { type: "json", required: true },
          claims: { type: "json", required: true },
          createdAt: { type: "date", required: true },
          expiresAt: { type: "date", required: false },
          createdBy: { type: "string", required: false },
          lastUsedAt: { type: "date", required: false },
        },
        indexes: [
          { fields: ["ownerKind", "ownerId", "name"], unique: true },
          { fields: ["userId"] },
        ],
      },
    });
  });

  it("renames the table and columns through better-auth's mergeSchema, without changing another call's schema", () => {
    const renamed = apiKeySchema({
      apiKey: {
        modelName: "api_keys",
        fields: { keyHash: "token_hmac", userId: "owner_id" },
      },
    });
    expect(renamed.apiKey?.modelName).toBe("api_keys");
    expect(renamed.apiKey?.fields.keyHash?.fieldName).toBe("token_hmac");
    expect(renamed.apiKey?.fields.userId?.fieldName).toBe("owner_id");
    const fresh = apiKeySchema();
    expect(fresh.apiKey?.modelName).toBeUndefined();
    expect(fresh.apiKey?.fields.keyHash?.fieldName).toBeUndefined();
  });

  it("serves a renamed model through the adapter-backed store", async () => {
    const plugin = testPlugin({
      apiKey: { modelName: "renamedKeys", fields: { keyHash: "digest" } },
    });
    const database = memoryDatabase();
    database.renamedKeys = [];
    const context = await authWith({ plugins: [plugin], database }).$context;
    const created = await apiKeysOf(context, plugin).create(createInput);
    expect(created.outcome).toBe("created");
    const [row] = database.renamedKeys;
    expect(row).toHaveProperty("digest");
    expect(row).not.toHaveProperty("keyHash");
  });
});

describeApiKeyStoreContract(
  "the adapter store over better-auth's memory adapter",
  async () => {
    const context = await authWith({ plugins: [testPlugin()] }).$context;

    return {
      store: createAdapterApiKeyStore(() => context.adapter),
      addOwner: async (ownerId) => {
        await addUser(context.adapter, ownerId);
      },
    };
  },
);
