import type { AuthContext } from "@better-auth/core";
import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";
import type * as z from "zod/mini";
import type {
  ApiKey,
  Clock,
  KeyHasher,
  RandomSource,
  ScopeAuthoriser,
} from "../contract/index.ts";
import {
  createApiKeyService,
  parseApiKeyServiceConfig,
  type ApiKeyService,
  type ApiKeyServiceConfig,
  type JsonObjectSchema,
} from "../core/index.ts";
import { createAdapterApiKeyStore } from "./adapter-store.ts";
import { API_KEY_ERROR_CODES } from "./error-codes.ts";
import { apiKeySchema, type ApiKeySchemaOverrides } from "./schema.ts";

/** The plugin's id: distinct from the stock `@better-auth/api-key` plugin's `"api-key"`, so the two can never be mistaken for each other in a host's plugin list. */
export const API_KEYS_PLUGIN_ID = "exadev-api-keys";

/** Where `init` places the service on better-auth's context. better-auth copies the context's own properties into each request's context, so the service is reachable from both. */
const SERVICE_CONTEXT_KEY = "exadevApiKeys";

/** Looks up the service this plugin instance created for a better-auth context; reached only through {@link apiKeysOf}. */
const resolveService: unique symbol = Symbol("exadev-api-keys.resolveService");

/** Everything the plugin needs apart from storage, which is always the host's better-auth database. */
export interface ApiKeysPluginOptions<
  ScopesSchema extends JsonObjectSchema,
  ClaimsSchema extends JsonObjectSchema,
  Request,
> extends ApiKeyServiceConfig {
  readonly hasher: KeyHasher;
  readonly random: RandomSource;
  readonly clock: Clock;
  readonly scopes: ScopesSchema;
  readonly claims: ClaimsSchema;
  readonly authoriser: ScopeAuthoriser<z.output<ScopesSchema>, Request>;
  /** Renames the `apiKey` table or its columns, as better-auth's own plugins allow. */
  readonly schema?: ApiKeySchemaOverrides;
}

/**
 * The plugin object {@link apiKeys} returns. It contributes a schema, error codes, inferred types and an `init`, and nothing else: no endpoints, no hooks, no rate-limit rules and no session hook, so a key authenticates only where the host verifies one itself, never at better-auth's own endpoints.
 */
export interface ApiKeysPlugin<Scopes, Claims, Request> {
  readonly id: typeof API_KEYS_PLUGIN_ID;
  readonly schema: BetterAuthPluginDBSchema;
  readonly $ERROR_CODES: typeof API_KEY_ERROR_CODES;
  readonly $Infer: { readonly ApiKey: ApiKey<Scopes, Claims> };
  readonly init: (context: AuthContext) => {
    context: Record<
      typeof SERVICE_CONTEXT_KEY,
      ApiKeyService<Scopes, Claims, Request>
    >;
  };
  readonly [resolveService]: (
    context: object,
  ) => ApiKeyService<Scopes, Claims, Request> | undefined;
}

/**
 * The better-auth plugin for API keys. Register it in `betterAuth({ plugins })`, then reach the service with {@link apiKeysOf}. Its settings are validated here, so a misconfigured host fails when it builds its auth instance. `init` binds the service to better-auth's own database adapter.
 */
export function apiKeys<
  ScopesSchema extends JsonObjectSchema,
  ClaimsSchema extends JsonObjectSchema,
  Request,
>(
  options: ApiKeysPluginOptions<ScopesSchema, ClaimsSchema, Request>,
): ApiKeysPlugin<z.output<ScopesSchema>, z.output<ClaimsSchema>, Request> {
  type Service = ApiKeyService<
    z.output<ScopesSchema>,
    z.output<ClaimsSchema>,
    Request
  >;
  const config = parseApiKeyServiceConfig({
    prefix: options.prefix,
    maxLifetimeMs: options.maxLifetimeMs,
    lastUsedIntervalMs: options.lastUsedIntervalMs,
  });
  // Every service this instance created, keyed by itself: a service found on a context is trusted only if it is one of these, which is also what gives it back its scope, claim and request types without a cast.
  const created = new WeakMap<object, Service>();
  /**
   * better-auth's `$Infer` carries types, not values: nothing reads it at runtime, and better-auth's own plugins set it to an empty object. This class gives that empty object the key's type without a type assertion: a `declare` field is a type-only member, so an instance has the property in its type and nothing at runtime.
   */
  class InferredTypes {
    declare readonly ApiKey: ApiKey<
      z.output<ScopesSchema>,
      z.output<ClaimsSchema>
    >;
  }

  return {
    id: API_KEYS_PLUGIN_ID,
    schema: apiKeySchema(options.schema),
    $ERROR_CODES: API_KEY_ERROR_CODES,
    $Infer: new InferredTypes(),
    init(context) {
      const service = createApiKeyService({
        ...config,
        store: createAdapterApiKeyStore(() => context.adapter),
        hasher: options.hasher,
        random: options.random,
        clock: options.clock,
        scopes: options.scopes,
        claims: options.claims,
        authoriser: options.authoriser,
      });
      created.set(service, service);
      return { context: { [SERVICE_CONTEXT_KEY]: service } };
    },
    [resolveService](context) {
      if (!(SERVICE_CONTEXT_KEY in context)) return undefined;
      const candidate = context[SERVICE_CONTEXT_KEY];
      if (typeof candidate !== "object" || candidate === null) return undefined;
      return created.get(candidate);
    },
  };
}

/**
 * The API-key service `plugin` bound to a better-auth instance, from that instance's context (`await auth.$context`, or a request's context). The host calls the service directly, never through `auth.api`, so key management stays behind the host's own authorisation and audit. Throws if `plugin` was not registered on that instance.
 */
export function apiKeysOf<Scopes, Claims, Request>(
  context: object,
  plugin: ApiKeysPlugin<Scopes, Claims, Request>,
): ApiKeyService<Scopes, Claims, Request> {
  const service = plugin[resolveService](context);
  if (service === undefined) {
    throw new Error(
      `The ${API_KEYS_PLUGIN_ID} plugin is not registered on this better-auth instance`,
    );
  }
  return service;
}
