import type { StoredApiKey } from "./schemas.ts";
import type { ApiKeysContractVersion } from "./version.ts";

/**
 * Options every port method takes. A port honours `signal` by refusing to start, and by abandoning what it can, once the signal has aborted, rejecting with the signal's reason.
 */
export interface PortCallOptions {
  readonly signal?: AbortSignal | undefined;
}

/** The current time, injected so the core never reads the platform clock. */
export interface Clock {
  readonly version: ApiKeysContractVersion;
  now: (options?: PortCallOptions) => Promise<Date>;
}

/** Cryptographically secure random bytes, injected so the core never reads the platform's random source. */
export interface RandomSource {
  readonly version: ApiKeysContractVersion;
  /** Exactly `length` bytes, each uniformly distributed. */
  bytes: (length: number, options?: PortCallOptions) => Promise<Uint8Array>;
}

/**
 * A keyed, deterministic hash of a presented key. The secret (a pepper) is bound when the hasher is constructed and never passes through the core, so a copy of the database alone cannot be used to test guesses. Deterministic, so a presented key is found by an equality match on its hash.
 */
export interface KeyHasher {
  readonly version: ApiKeysContractVersion;
  hash: (key: string, options?: PortCallOptions) => Promise<string>;
}

/** The result of {@link ApiKeyStore.insert}: the key was stored, or its owner already has a key with that name. */
export type ApiKeyInsertOutcome =
  { readonly outcome: "inserted" } | { readonly outcome: "name-taken" };

/** The result of {@link ApiKeyStore.findByHash}. */
export type ApiKeyFindOutcome =
  | { readonly outcome: "found"; readonly key: StoredApiKey }
  | { readonly outcome: "not-found" };

/** The result of {@link ApiKeyStore.delete}. */
export type ApiKeyDeleteOutcome =
  { readonly outcome: "deleted" } | { readonly outcome: "not-found" };

/** The result of {@link ApiKeyStore.touchLastUsed}: the last-used time was written, or the key was left unchanged because it was used since the cut-off or no longer exists. */
export type ApiKeyTouchOutcome =
  { readonly outcome: "touched" } | { readonly outcome: "unchanged" };

/**
 * Where keys live. Every method is one logical operation against the backing store; none of them validates scopes or claims, which the service does on every read.
 */
export interface ApiKeyStore {
  readonly version: ApiKeysContractVersion;
  /** Stores a new key, unless its owner already has a key with the same name, which is refused rather than overwritten. */
  insert: (
    key: StoredApiKey,
    options?: PortCallOptions,
  ) => Promise<ApiKeyInsertOutcome>;
  /** The key whose hash equals `keyHash`, found by one equality match on a unique column. */
  findByHash: (
    keyHash: string,
    options?: PortCallOptions,
  ) => Promise<ApiKeyFindOutcome>;
  /** Every key `ownerId` holds, in no particular order. */
  listByOwner: (
    ownerId: string,
    options?: PortCallOptions,
  ) => Promise<readonly StoredApiKey[]>;
  /** Deletes the key `id`; when `ownerId` is given, only if that owner holds it, in the same operation. */
  delete: (
    target: { readonly id: string; readonly ownerId?: string | undefined },
    options?: PortCallOptions,
  ) => Promise<ApiKeyDeleteOutcome>;
  /** Deletes every key `ownerId` holds. */
  deleteByOwner: (
    ownerId: string,
    options?: PortCallOptions,
  ) => Promise<{ readonly deleted: number }>;
  /**
   * Sets the key's last-used time to `at`, but only if it has never been used or was last used strictly before `notSince`, decided and written atomically. Two concurrent calls for the same key with the same cut-off therefore write once: the second finds the first's write, which is not before the cut-off.
   */
  touchLastUsed: (
    id: string,
    at: Date,
    notSince: Date,
    options?: PortCallOptions,
  ) => Promise<ApiKeyTouchOutcome>;
}

/** The decision a {@link ScopeAuthoriser} makes. */
export type AuthorisationDecision =
  { readonly outcome: "allowed" } | { readonly outcome: "denied" };

/**
 * The host's policy for whether a key's scopes permit a request. Pure and synchronous: it sees only the scopes the key was created with and the host's own description of the request, and reads nothing else.
 */
export interface ScopeAuthoriser<Scopes, Request> {
  readonly version: ApiKeysContractVersion;
  authorise: (scopes: Scopes, request: Request) => AuthorisationDecision;
}
