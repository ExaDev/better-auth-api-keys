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
  /** Starts every key, so a leaked key is recognisable: a short, distinctive string the host chooses, such as `exshow_`. */
  prefix: z.string().check(z.regex(KEY_PREFIX_PATTERN)),
  /** The longest lifetime a key may be created with. Every key expires, unless `allowNonExpiringSystemKeys` lets a system principal's key be created with none. */
  maxLifetimeMs: z.number().check(z.int(), z.positive()),
  /** How stale a key's last-used time may get before a verification writes it again, which bounds the writes verification costs to one per key per interval. */
  lastUsedIntervalMs: z.number().check(z.int(), z.positive()),
  /** Whether a system principal's key may have no expiry (`lifetimeMs: null`). Off unless the host turns it on; a person's key always expires whatever this says. Checked on every read as well as on creation, so turning it off disables every key created with no expiry. */
  allowNonExpiringSystemKeys: z.optional(z.boolean()),
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

/**
 * What {@link ApiKeyService.create} needs. `lifetimeMs` is from the moment of creation, positive and at most the service's `maxLifetimeMs`; `null` creates a key that never expires, which is refused unless the owner is a system principal and the service's `allowNonExpiringSystemKeys` is on. `createdBy` names who created the key, as plain text the package stores and never resolves.
 */
export interface CreateApiKeyInput<Scopes, Claims> {
  readonly owner: ApiKeyOwner;
  readonly name: string;
  readonly lifetimeMs: number | null;
  readonly scopes: Scopes;
  readonly claims: Claims;
  readonly createdBy?: string | undefined;
}

/** Which part of a {@link CreateApiKeyInput} was refused. */
export type InvalidApiKeyField =
  "owner" | "name" | "lifetime" | "scopes" | "claims" | "createdBy";

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
 * The result of {@link ApiKeyService.verify}. `malformed` means the presented string failed the offline check, so nothing was hashed or read; `unknown` means no stored key matches it, or the stored key's scopes or claims no longer pass the host's schemas, or it has no expiry and is not a system principal's key while the host allows those; `expired` names the key, its owner and when it was created, so the host can say which key it was and still apply its own refusals that outrank expiry (a disabled owner, or a key older than the owner's last sign-out everywhere). In both `valid` and `expired`, `owner.kind` tells a person's key from a system principal's, and narrows `owner` to that kind.
 */
export type VerifyApiKeyResult<Scopes, Claims> =
  | { readonly outcome: "valid"; readonly key: ApiKey<Scopes, Claims> }
  | { readonly outcome: "malformed" }
  | { readonly outcome: "unknown" }
  | {
      readonly outcome: "expired";
      readonly id: string;
      readonly owner: ApiKeyOwner;
      /** Repeats `owner.id`, as {@link ApiKeySummary.ownerId} does. */
      readonly ownerId: string;
      readonly createdAt: Date;
    };

/**
 * Options for {@link ApiKeyService.recordUse}. `defer` receives the last-used write, when one is due, so the host can let it finish after the response (a Worker's `ctx.waitUntil`). The write deliberately does not take `signal`: it belongs to no single request and must not be cut short when the request that triggered it ends.
 */
export interface RecordApiKeyUseOptions extends PortCallOptions {
  readonly defer: (task: Readonly<Promise<unknown>>) => void;
}

/** The result of {@link ApiKeyService.recordUse}: the last-used write was handed to `defer`, or the recorded time is recent enough that none is due. */
export type RecordApiKeyUseResult =
  { readonly outcome: "scheduled" } | { readonly outcome: "not-due" };

/** One entry of {@link ApiKeyService.list}. A key whose stored scopes or claims no longer pass the host's schemas, or that has no expiry the service would let it have, is listed as `unreadable` rather than hidden, so its owner can still see and revoke it. */
export type ListedApiKey<Scopes, Claims> =
  | { readonly status: "valid"; readonly key: ApiKey<Scopes, Claims> }
  | { readonly status: "unreadable"; readonly key: ApiKeySummary };

/** The result of {@link ApiKeyService.revoke}. */
export type RevokeApiKeyResult =
  { readonly outcome: "revoked" } | { readonly outcome: "not-found" };

/** Creates, lists, revokes, verifies and authorises API keys against the injected ports. */
export interface ApiKeyService<Scopes, Claims, Request> {
  /** Creates a key for `input.owner`. Refuses invalid input and a name the owner (the same kind and id) already uses; never overwrites a key. */
  create: (
    input: CreateApiKeyInput<Scopes, Claims>,
    options?: PortCallOptions,
  ) => Promise<CreateApiKeyResult<Scopes, Claims>>;
  /** Every key `owner` holds, newest first. Throws if `owner` is not an owner {@link apiKeyOwnerSchema} accepts. */
  list: (
    owner: Readonly<ApiKeyOwner>,
    options?: PortCallOptions,
  ) => Promise<readonly ListedApiKey<Scopes, Claims>[]>;
  /** Deletes the key `id`; when `owner` is given, only if that owner (the same kind and id) holds it. Throws if `owner` is given and is not an owner {@link apiKeyOwnerSchema} accepts. */
  revoke: (
    target: {
      readonly id: string;
      readonly owner?: ApiKeyOwner | undefined;
    },
    options?: PortCallOptions,
  ) => Promise<RevokeApiKeyResult>;
  /** Deletes every key `owner` holds, for "sign out everywhere", disabling and deleting a person, and deleting a system principal: nothing references a principal, so its keys outlive it unless the host calls this when it removes one. Throws if `owner` is not an owner {@link apiKeyOwnerSchema} accepts. */
  revokeAllForOwner: (
    owner: Readonly<ApiKeyOwner>,
    options?: PortCallOptions,
  ) => Promise<{ readonly revoked: number }>;
  /**
   * Checks a presented key: the offline format check first, and only then one hash and one lookup, the stored scopes and claims against the host's schemas, and expiry. Reads only: a key the host goes on to refuse for its own reasons (its owner disabled, say) must not look used, so recording the use is the host's separate call, {@link ApiKeyService.recordUse}, once it accepts the key.
   */
  verify: (
    presented: string,
    options?: PortCallOptions,
  ) => Promise<VerifyApiKeyResult<Scopes, Claims>>;
  /**
   * Records that the host accepted a verified key: hands a last-used write to `options.defer` only when the key's recorded last use is older than the last-used interval, so a busy key costs one write per interval, not one per request. The write is conditional in the store as well, so two racing uses write once.
   * @param key - The key as {@link ApiKeyService.verify} returned it.
   */
  recordUse: (
    key: Readonly<Pick<ApiKeySummary, "id" | "lastUsedAt">>,
    options: RecordApiKeyUseOptions,
  ) => Promise<RecordApiKeyUseResult>;
  /** Whether `key`'s scopes permit `request`, by the injected authoriser. */
  authorise: (
    key: ApiKey<Scopes, Claims>,
    request: Request,
  ) => AuthorisationDecision;
}

function summaryOf(stored: StoredApiKey): ApiKeySummary {
  return {
    id: stored.id,
    owner: stored.owner,
    ownerId: stored.owner.id,
    name: stored.name,
    start: stored.start,
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    createdBy: stored.createdBy,
    lastUsedAt: stored.lastUsedAt,
  };
}

/** The owner a caller named, checked at run time as well as by type, since an untyped caller could name any object. Throws on anything {@link apiKeyOwnerSchema} refuses: a missing or misspelt kind is never read as a person. */
function ownerOf(owner: Readonly<ApiKeyOwner>): ApiKeyOwner {
  return z.parse(apiKeyOwnerSchema, owner);
}

/** Who created a key, when the host says: any non-empty text, never resolved against a table. */
const createdBySchema = z.optional(z.string().check(z.minLength(1)));

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
  const {
    prefix,
    maxLifetimeMs,
    lastUsedIntervalMs,
    allowNonExpiringSystemKeys,
  } = parseApiKeyServiceConfig({
    prefix: options.prefix,
    maxLifetimeMs: options.maxLifetimeMs,
    lastUsedIntervalMs: options.lastUsedIntervalMs,
    allowNonExpiringSystemKeys: options.allowNonExpiringSystemKeys,
  });
  const { store, hasher, random, clock, authoriser } = options;
  const lifetimeSchema = z
    .number()
    .check(z.int(), z.positive(), z.lte(maxLifetimeMs));

  /** Whether a key of `owner`'s may have no expiry: only a system principal's, and only while the host allows it. Applied on creation and on every read, so turning the setting off disables the keys it let through. */
  function mayNeverExpire(owner: Readonly<ApiKeyOwner>): boolean {
    return owner.kind === "system" && allowNonExpiringSystemKeys === true;
  }

  /** The lifetime a key for `owner` may be created with: `lifetimeMs` itself when the service accepts it, or `undefined` when it is refused. */
  function acceptedLifetime(
    owner: ApiKeyOwner,
    lifetimeMs: number | null,
  ): { readonly ms: number | null } | undefined {
    if (lifetimeMs === null) {
      return mayNeverExpire(owner) ? { ms: null } : undefined;
    }
    const lifetime = z.safeParse(lifetimeSchema, lifetimeMs);

    return lifetime.success ? { ms: lifetime.data } : undefined;
  }

  /** The stored key typed by the host's schemas, or `undefined` when its scopes or claims no longer pass them or it has no expiry it may not have. */
  function readable(stored: StoredApiKey): ApiKey<Scopes, Claims> | undefined {
    if (stored.expiresAt === null && !mayNeverExpire(stored.owner)) {
      return undefined;
    }
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
      const lifetime = acceptedLifetime(owner.data, input.lifetimeMs);
      if (lifetime === undefined) {
        return { outcome: "invalid", field: "lifetime" };
      }
      const scopes = z.safeParse(options.scopes, input.scopes);
      if (!scopes.success) return { outcome: "invalid", field: "scopes" };
      const claims = z.safeParse(options.claims, input.claims);
      if (!claims.success) return { outcome: "invalid", field: "claims" };
      const createdBy = z.safeParse(createdBySchema, input.createdBy);
      if (!createdBy.success) return { outcome: "invalid", field: "createdBy" };

      const now = await clock.now(callOptions);
      const plaintext = await generateKey(prefix, random, callOptions);
      const stored: StoredApiKey = {
        id: await randomBase62(KEY_ID_LENGTH, random, callOptions),
        owner: owner.data,
        name: name.data,
        keyHash: await hasher.hash(plaintext, callOptions),
        start: keyStart(prefix, plaintext),
        scopes: scopes.data,
        claims: claims.data,
        createdAt: now,
        expiresAt:
          lifetime.ms === null ? null : new Date(now.getTime() + lifetime.ms),
        createdBy: createdBy.data,
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
      const stored = await store.listByOwner(ownerOf(owner), callOptions);

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
        {
          id: target.id,
          owner: target.owner === undefined ? undefined : ownerOf(target.owner),
        },
        callOptions,
      );

      return deleted.outcome === "deleted"
        ? { outcome: "revoked" }
        : { outcome: "not-found" };
    },

    async revokeAllForOwner(owner, callOptions) {
      callOptions?.signal?.throwIfAborted();
      const { deleted } = await store.deleteByOwner(
        ownerOf(owner),
        callOptions,
      );

      return { revoked: deleted };
    },

    async verify(presented, verifyOptions) {
      const signal = verifyOptions?.signal;
      signal?.throwIfAborted();
      if (!hasKeyFormat(prefix, presented)) return { outcome: "malformed" };
      const found = await store.findByHash(
        await hasher.hash(presented, { signal }),
        { signal },
      );
      if (found.outcome === "not-found") return { outcome: "unknown" };
      const key = readable(found.key);
      if (key === undefined) return { outcome: "unknown" };
      const now = await clock.now({ signal });
      if (isExpired(key.expiresAt, now)) {
        return {
          outcome: "expired",
          id: key.id,
          owner: key.owner,
          ownerId: key.ownerId,
          createdAt: key.createdAt,
        };
      }

      return { outcome: "valid", key };
    },

    async recordUse(key, useOptions) {
      const { defer, signal } = useOptions;
      signal?.throwIfAborted();
      const now = await clock.now({ signal });
      const notSince = lastUsedCutOff(now, lastUsedIntervalMs);
      if (!isLastUsedStale(key.lastUsedAt, notSince)) {
        return { outcome: "not-due" };
      }
      defer(store.touchLastUsed(key.id, now, notSince));

      return { outcome: "scheduled" };
    },

    authorise(key, request) {
      return authoriser.authorise(key.scopes, request);
    },
  };
}
