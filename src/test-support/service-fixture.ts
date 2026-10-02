import * as z from "zod/mini";
import {
  API_KEYS_CONTRACT_VERSION,
  type ApiKeyStore,
  type Clock,
  type KeyHasher,
  type PortCallOptions,
  type RandomSource,
  type ScopeAuthoriser,
} from "../contract/index.ts";
import { createApiKeyService } from "../core/index.ts";
import {
  createInMemoryApiKeyStore,
  createManualClock,
} from "../testing/index.ts";
import { createWebCryptoKeyHasher } from "../web-crypto/index.ts";
import { seededRandomSource } from "./random-sources.ts";

export const TEST_PREFIX = "test_";
const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365;
export const TEST_MAX_LIFETIME_MS = DAYS_PER_YEAR * DAY_MS;
export const TEST_LAST_USED_INTERVAL_MS = HOUR_MS;
export const TEST_START = new Date("2026-03-01T09:00:00.000Z");

/** The seed the service fixture's random source starts from, so a failing run replays exactly. */
const SERVICE_RANDOM_SEED = 42;

/** A scope shape like one a host might use, to exercise the injected schema. */
export const testScopesSchema = z.object({
  access: z.enum(["read", "write", "all"]),
  toolsets: z.optional(z.array(z.string())),
});
export type TestScopes = z.output<typeof testScopesSchema>;

export const testClaimsSchema = z.object({
  provider: z.enum(["google", "otp"]),
});
export type TestClaims = z.output<typeof testClaimsSchema>;

/** What a request needs from a key in these tests: whether it changes anything. */
export interface TestRequest {
  readonly writes: boolean;
}

export const testAuthoriser: ScopeAuthoriser<TestScopes, TestRequest> = {
  version: API_KEYS_CONTRACT_VERSION,
  authorise: (scopes, request) =>
    request.writes && scopes.access === "read"
      ? { outcome: "denied" }
      : { outcome: "allowed" },
};

/** One call a spied port received, with the signal it was given. */
interface PortCall {
  readonly port: "store" | "hasher" | "random" | "clock";
  readonly method: string;
  readonly signal: AbortSignal | undefined;
}

type Recorder = (call: PortCall) => void;

function spiedStore(
  store: Readonly<ApiKeyStore>,
  record: Recorder,
): ApiKeyStore {
  const note = (method: string, options: PortCallOptions | undefined) => {
    record({ port: "store", method, signal: options?.signal });
  };

  return {
    version: store.version,
    insert: async (key, options) => {
      note("insert", options);

      return store.insert(key, options);
    },
    findByHash: async (keyHash, options) => {
      note("findByHash", options);

      return store.findByHash(keyHash, options);
    },
    listByOwner: async (ownerId, options) => {
      note("listByOwner", options);

      return store.listByOwner(ownerId, options);
    },
    delete: async (target, options) => {
      note("delete", options);

      return store.delete(target, options);
    },
    deleteByOwner: async (ownerId, options) => {
      note("deleteByOwner", options);

      return store.deleteByOwner(ownerId, options);
    },
    touchLastUsed: async (id, at, notSince, options) => {
      note("touchLastUsed", options);

      return store.touchLastUsed(id, at, notSince, options);
    },
  };
}

function spiedHasher(hasher: Readonly<KeyHasher>, record: Recorder): KeyHasher {
  return {
    version: hasher.version,
    hash: async (key, options) => {
      record({ port: "hasher", method: "hash", signal: options?.signal });

      return hasher.hash(key, options);
    },
  };
}

function spiedRandom(
  random: Readonly<RandomSource>,
  record: Recorder,
): RandomSource {
  return {
    version: random.version,
    bytes: async (length, options) => {
      record({ port: "random", method: "bytes", signal: options?.signal });

      return random.bytes(length, options);
    },
  };
}

function spiedClock(clock: Readonly<Clock>, record: Recorder): Clock {
  return {
    version: clock.version,
    now: async (options) => {
      record({ port: "clock", method: "now", signal: options?.signal });

      return clock.now(options);
    },
  };
}

/** A service over the in-memory store (or `store`), a manual clock, a seeded random source and a real Web Crypto hasher, with every port call recorded. */
export function serviceFixture(options: { readonly store?: ApiKeyStore } = {}) {
  const calls: PortCall[] = [];
  const record: Recorder = (call) => {
    calls.push(call);
  };
  const store = options.store ?? createInMemoryApiKeyStore();
  const clock = createManualClock(TEST_START);
  const deferred: Promise<unknown>[] = [];
  const service = createApiKeyService({
    prefix: TEST_PREFIX,
    maxLifetimeMs: TEST_MAX_LIFETIME_MS,
    lastUsedIntervalMs: TEST_LAST_USED_INTERVAL_MS,
    store: spiedStore(store, record),
    hasher: spiedHasher(createWebCryptoKeyHasher("test pepper"), record),
    random: spiedRandom(seededRandomSource(SERVICE_RANDOM_SEED), record),
    clock: spiedClock(clock, record),
    scopes: testScopesSchema,
    claims: testClaimsSchema,
    authoriser: testAuthoriser,
  });

  return {
    service,
    store,
    clock,
    calls,
    deferred,
    /** A `defer` that collects the tasks it is handed, for the test to await or count. */
    defer: (task: Readonly<Promise<unknown>>) => {
      deferred.push(task);
    },
  };
}
