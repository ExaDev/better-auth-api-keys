import * as z from "zod/mini";
import {
  apiKeyNameSchema,
  apiKeyOwnerSchema,
  type ApiKey,
  type ApiKeyOwner,
  type ApiKeyStore,
  type ApiKeySummary,
  type AuthorisationDecision,
  type Clock,
  type KeyHasher,
  type PortCallOptions,
  type RandomSource,
  type ScopeAuthoriser,
  type StoredApiKey,
} from "../contract/index.ts";
import { base62LengthForBits, randomBase62 } from "./base62.ts";
import { generateKey, hasKeyFormat, keyStart } from "./key-format.ts";
import { isExpired, isLastUsedStale, lastUsedCutOff } from "./key-times.ts";

/** A key's id carries 128 bits of entropy, the same as a random UUID, so ids generated independently never collide. */
const KEY_ID_ENTROPY_BITS = 128;
const KEY_ID_LENGTH = base62LengthForBits(KEY_ID_ENTROPY_BITS);

/** A prefix may use only characters that survive an `Authorization` header, a URL and a shell unquoted. */
const KEY_PREFIX_PATTERN = /^[A-Za-z0-9_-]+$/u;

/**
 * A Zod schema whose output is a JSON object. Scopes and claims are stored as JSON, so their schemas must describe plain JSON objects (no dates, maps or class instances) for what is read back to equal what was written.
 */
export type JsonObjectSchema = z.core.$ZodType<
  Readonly<Record<string, unknown>>
>;

/** The settings that shape keys and their lifecycle, validated by {@link apiKeyServiceConfigSchema}. */
export const apiKeyServiceConfigSchema = z.object({
  /** Starts every key, so a leaked key is recognisable (`exshow_` in this repository). */
  prefix: z.string().check(z.regex(KEY_PREFIX_PATTERN)),
  /** The longest lifetime a key may be created with. Every key expires. */
  maxLifetimeMs: z.number().check(z.int(), z.positive()),
  /** How stale a key's last-used time may get before a verification writes it again, which bounds the writes verification costs to one per key per interval. */
  lastUsedIntervalMs: z.number().check(z.int(), z.positive()),
});
export type ApiKeyServiceConfig = z.output<typeof apiKeyServiceConfigSchema>;

/**
 * Validates the service's settings, throwing on any that are unusable, so a misconfigured host fails when it starts rather than on its first key.
 */
export function parseApiKeyServiceConfig(
  config: Readonly<ApiKeyServiceConfig>,
): ApiKeyServiceConfig {
  return z.parse(apiKeyServiceConfigSchema, config);
}

/** Everything {@link createApiKeyService} needs: its settings, its ports, and the host's schemas and policy for scopes and claims. */
export interface ApiKeyServiceOptions<
  ScopesSchema extends JsonObjectSchema,
  ClaimsSchema extends JsonObjectSchema,
  Request,
> extends ApiKeyServiceConfig {
  readonly store: ApiKeyStore;
  readonly hasher: KeyHasher;
  readonly random: RandomSource;
  readonly clock: Clock;
  /** What a key may do, opaque to this package: validated on create and on every read, stored as JSON, and handed to `authoriser`. */
  readonly scopes: ScopesSchema;
  /** Server-owned facts recorded when a key is created (how its owner had signed in, for example) that the host uses for policy, opaque to this package and validated like `scopes`. */
  readonly claims: ClaimsSchema;
  readonly authoriser: ScopeAuthoriser<z.output<ScopesSchema>, Request>;
}

/** What {@link ApiKeyService.create} needs. `lifetimeMs` is from the moment of creation, positive and at most the service's `maxLifetimeMs`. */
export interface CreateApiKeyInput<Scopes, Claims> {
  readonly owner: ApiKeyOwner;
  readonly name: string;
  readonly lifetimeMs: number;
  readonly scopes: Scopes;
  readonly claims: Claims;
}

/** Which part of a {@link CreateApiKeyInput} was refused. */
export type InvalidApiKeyField =
  "owner" | "name" | "lifetime" | "scopes" | "claims";

/** The result of {@link ApiKeyService.create}. `plaintext` is the key itself, returned here once and never again: only its hash is stored. */
export type CreateApiKeyResult<Scopes, Claims> =
  | {
      readonly outcome: "created";
      readonly key: ApiKey<Scopes, Claims>;
      readonly plaintext: string;
    }
  | { readonly outcome: "invalid"; readonly field: InvalidApiKeyField }
  | { readonly outcome: "name-taken" };

/**
 * The result of {@link ApiKeyService.verify}. `malformed` means the presented string failed the offline check, so nothing was hashed or read; `unknown` means no stored key matches it, or the stored key's scopes or claims no longer pass the host's schemas; `expired` names the key so the host can say which one.
 */
export type VerifyApiKeyResult<Scopes, Claims> =
  | { readonly outcome: "valid"; readonly key: ApiKey<Scopes, Claims> }
  | { readonly outcome: "malformed" }
  | { readonly outcome: "unknown" }
  | {
      readonly outcome: "expired";
      readonly id: string;
      readonly ownerId: string;
    };

/**
 * Options for {@link ApiKeyService.verify}. `defer` receives the last-used write, when one is due, so the host can let it finish after the response (a Worker's `ctx.waitUntil`). The write deliberately does not take `signal`: it belongs to no single request and must not be cut short when the request that triggered it ends.
 */
export interface VerifyApiKeyOptions extends PortCallOptions {
  readonly defer: (task: Readonly<Promise<unknown>>) => void;
}

/** One entry of {@link ApiKeyService.list}. A key whose stored scopes or claims no longer pass the host's schemas is listed as `unreadable` rather than hidden, so its owner can still see and revoke it. */
export type ListedApiKey<Scopes, Claims> =
  | { readonly status: "valid"; readonly key: ApiKey<Scopes, Claims> }
  | { readonly status: "unreadable"; readonly key: ApiKeySummary };

/** The result of {@link ApiKeyService.revoke}. */
export type RevokeApiKeyResult =
  { readonly outcome: "revoked" } | { readonly outcome: "not-found" };

/** Creates, lists, revokes, verifies and authorises API keys against the injected ports. */
export interface ApiKeyService<Scopes, Claims, Request> {
  /** Creates a key for `input.owner`. Refuses invalid input and a name the owner already uses; never overwrites a key. */
  create: (
    input: CreateApiKeyInput<Scopes, Claims>,
    options?: PortCallOptions,
  ) => Promise<CreateApiKeyResult<Scopes, Claims>>;
  /** Every key `owner` holds, newest first. */
  list: (
    owner: Readonly<ApiKeyOwner>,
    options?: PortCallOptions,
  ) => Promise<readonly ListedApiKey<Scopes, Claims>[]>;
  /** Deletes the key `id`; when `owner` is given, only if that owner holds it. */
  revoke: (
    target: { readonly id: string; readonly owner?: ApiKeyOwner | undefined },
    options?: PortCallOptions,
  ) => Promise<RevokeApiKeyResult>;
  /** Deletes every key `owner` holds, for "sign out everywhere", disabling and deleting a person. */
  revokeAllForOwner: (
    owner: Readonly<ApiKeyOwner>,
    options?: PortCallOptions,
  ) => Promise<{ readonly revoked: number }>;
  /**
   * Checks a presented key: the offline format check first, and only then one hash and one lookup, the stored scopes and claims against the host's schemas, and expiry. Hands a last-used write to `options.defer` only when the stored time is older than the last-used interval, so a busy key costs one write per interval, not one per request.
   */
  verify: (
    presented: string,
    options: VerifyApiKeyOptions,
  ) => Promise<VerifyApiKeyResult<Scopes, Claims>>;
  /** Whether `key`'s scopes permit `request`, by the injected authoriser. */
  authorise: (
    key: ApiKey<Scopes, Claims>,
    request: Request,
  ) => AuthorisationDecision;
}

function summaryOf(stored: StoredApiKey): ApiKeySummary {
  return {
    id: stored.id,
    ownerId: stored.ownerId,
    name: stored.name,
    start: stored.start,
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    lastUsedAt: stored.lastUsedAt,
  };
}

/**
 * Builds the API-key service over its ports. Pure domain logic: it reads time only from `clock`, randomness only from `random` and hashes only through `hasher`, and passes each call's `signal` to every port it calls. Throws if the settings are unusable.
 */
export function createApiKeyService<
  ScopesSchema extends JsonObjectSchema,
  ClaimsSchema extends JsonObjectSchema,
  Request,
>(
  options: ApiKeyServiceOptions<ScopesSchema, ClaimsSchema, Request>,
): ApiKeyService<z.output<ScopesSchema>, z.output<ClaimsSchema>, Request> {
  type Scopes = z.output<ScopesSchema>;
  type Claims = z.output<ClaimsSchema>;
  const { prefix, maxLifetimeMs, lastUsedIntervalMs } =
    parseApiKeyServiceConfig({
      prefix: options.prefix,
      maxLifetimeMs: options.maxLifetimeMs,
      lastUsedIntervalMs: options.lastUsedIntervalMs,
    });
  const { store, hasher, random, clock, authoriser } = options;
  const lifetimeSchema = z
    .number()
    .check(z.int(), z.positive(), z.lte(maxLifetimeMs));

  function readable(stored: StoredApiKey): ApiKey<Scopes, Claims> | undefined {
    const scopes = z.safeParse(options.scopes, stored.scopes);
    const claims = z.safeParse(options.claims, stored.claims);
    if (!scopes.success || !claims.success) return undefined;
    return { ...summaryOf(stored), scopes: scopes.data, claims: claims.data };
  }

  return {
    async create(input, callOptions) {
      callOptions?.signal?.throwIfAborted();
      const owner = z.safeParse(apiKeyOwnerSchema, input.owner);
      if (!owner.success) return { outcome: "invalid", field: "owner" };
      const name = z.safeParse(apiKeyNameSchema, input.name);
      if (!name.success) return { outcome: "invalid", field: "name" };
      const lifetime = z.safeParse(lifetimeSchema, input.lifetimeMs);
      if (!lifetime.success) return { outcome: "invalid", field: "lifetime" };
      const scopes = z.safeParse(options.scopes, input.scopes);
      if (!scopes.success) return { outcome: "invalid", field: "scopes" };
      const claims = z.safeParse(options.claims, input.claims);
      if (!claims.success) return { outcome: "invalid", field: "claims" };

      const now = await clock.now(callOptions);
      const plaintext = await generateKey(prefix, random, callOptions);
      const stored: StoredApiKey = {
        id: await randomBase62(KEY_ID_LENGTH, random, callOptions),
        ownerId: owner.data.id,
        name: name.data,
        keyHash: await hasher.hash(plaintext, callOptions),
        start: keyStart(prefix, plaintext),
        scopes: scopes.data,
        claims: claims.data,
        createdAt: now,
        expiresAt: new Date(now.getTime() + lifetime.data),
        lastUsedAt: undefined,
      };
      const inserted = await store.insert(stored, callOptions);
      if (inserted.outcome === "name-taken") return { outcome: "name-taken" };
      return {
        outcome: "created",
        key: { ...summaryOf(stored), scopes: scopes.data, claims: claims.data },
        plaintext,
      };
    },

    async list(owner, callOptions) {
      callOptions?.signal?.throwIfAborted();
      const stored = await store.listByOwner(owner.id, callOptions);
      return [...stored]
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .map((entry): ListedApiKey<Scopes, Claims> => {
          const key = readable(entry);
          return key === undefined
            ? { status: "unreadable", key: summaryOf(entry) }
            : { status: "valid", key };
        });
    },

    async revoke(target, callOptions) {
      callOptions?.signal?.throwIfAborted();
      const deleted = await store.delete(
        { id: target.id, ownerId: target.owner?.id },
        callOptions,
      );
      return deleted.outcome === "deleted"
        ? { outcome: "revoked" }
        : { outcome: "not-found" };
    },

    async revokeAllForOwner(owner, callOptions) {
      callOptions?.signal?.throwIfAborted();
      const { deleted } = await store.deleteByOwner(owner.id, callOptions);
      return { revoked: deleted };
    },

    async verify(presented, verifyOptions) {
      const { defer, signal } = verifyOptions;
      signal?.throwIfAborted();
      if (!hasKeyFormat(prefix, presented)) return { outcome: "malformed" };
      const found = await store.findByHash(
        await hasher.hash(presented, { signal }),
        {
          signal,
        },
      );
      if (found.outcome === "not-found") return { outcome: "unknown" };
      const key = readable(found.key);
      if (key === undefined) return { outcome: "unknown" };
      const now = await clock.now({ signal });
      if (isExpired(key.expiresAt, now)) {
        return { outcome: "expired", id: key.id, ownerId: key.ownerId };
      }
      const notSince = lastUsedCutOff(now, lastUsedIntervalMs);
      if (isLastUsedStale(key.lastUsedAt, notSince)) {
        defer(store.touchLastUsed(key.id, now, notSince));
      }
      return { outcome: "valid", key };
    },

    authorise(key, request) {
      return authoriser.authorise(key.scopes, request);
    },
  };
}
