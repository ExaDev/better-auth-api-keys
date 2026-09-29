import { apiKeys, type ApiKeySchemaOverrides } from "../better-auth/index.ts";
import { createManualClock } from "../testing/index.ts";
import { createWebCryptoKeyHasher } from "../web-crypto/index.ts";
import { seededRandomSource } from "./random-sources.ts";
import {
  TEST_LAST_USED_INTERVAL_MS,
  TEST_MAX_LIFETIME_MS,
  TEST_PREFIX,
  TEST_START,
  testAuthoriser,
  testClaimsSchema,
  testScopesSchema,
} from "./service-fixture.ts";

/** The seed every test plugin's random source starts from, so a failing run replays exactly. */
const PLUGIN_RANDOM_SEED = 7;

/** The plugin's options, configured as the service fixture configures the service, with an optional schema rename. */
export function testPluginOptions(schema?: ApiKeySchemaOverrides) {
  return {
    prefix: TEST_PREFIX,
    maxLifetimeMs: TEST_MAX_LIFETIME_MS,
    lastUsedIntervalMs: TEST_LAST_USED_INTERVAL_MS,
    hasher: createWebCryptoKeyHasher("test pepper"),
    random: seededRandomSource(PLUGIN_RANDOM_SEED),
    clock: createManualClock(TEST_START),
    scopes: testScopesSchema,
    claims: testClaimsSchema,
    authoriser: testAuthoriser,
    ...(schema === undefined ? {} : { schema }),
  };
}

/** The plugin built from {@link testPluginOptions}. */
export function testPlugin(schema?: ApiKeySchemaOverrides) {
  return apiKeys(testPluginOptions(schema));
}

export type TestPlugin = ReturnType<typeof testPlugin>;

/** A secret long enough for better-auth's own length check; test-only. */
export const TEST_AUTH_SECRET =
  "a test secret long enough for better-auth's check";
export const TEST_BASE_URL = "http://localhost:3000";
