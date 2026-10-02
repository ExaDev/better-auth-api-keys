import {
  API_KEYS_CONTRACT_VERSION,
  type ApiKeyOwner,
  type ApiKeyStore,
  type StoredApiKey,
} from "../contract/index.ts";
import { isLastUsedStale, settleUnlessAborted } from "../core/index.ts";

/** Whether two owners are the same owner: the same kind and the same id, since a person and a system principal with the same id are different owners. */
function isSameOwner(a: Readonly<ApiKeyOwner>, b: Readonly<ApiKeyOwner>) {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * An {@link ApiKeyStore} held in memory, for tests of code that uses the service. It keeps every guarantee the port states (unique hashes, unique names per owner and kind of owner, the conditional last-used write, abort signals honoured before any change), so a test against it exercises the same outcomes a database-backed store gives. Records are copied in and out, so a caller mutating a result cannot change what is stored.
 */
export function createInMemoryApiKeyStore(): ApiKeyStore {
  const keys = new Map<string, StoredApiKey>();

  return {
    version: API_KEYS_CONTRACT_VERSION,

    async insert(key, options) {
      return settleUnlessAborted(options, () => {
        const stored = [...keys.values()];
        if (
          stored.some(
            (existing) =>
              isSameOwner(existing.owner, key.owner) &&
              existing.name === key.name,
          )
        ) {
          return { outcome: "name-taken" };
        }
        if (
          stored.some(
            (existing) =>
              existing.id === key.id || existing.keyHash === key.keyHash,
          )
        ) {
          throw new Error("An API key with this id or hash is already stored");
        }
        keys.set(key.id, structuredClone(key));

        return { outcome: "inserted" };
      });
    },

    async findByHash(keyHash, options) {
      return settleUnlessAborted(options, () => {
        const key = [...keys.values()].find(
          (candidate) => candidate.keyHash === keyHash,
        );

        return key === undefined
          ? { outcome: "not-found" }
          : { outcome: "found", key: structuredClone(key) };
      });
    },

    async listByOwner(owner, options) {
      return settleUnlessAborted(options, () =>
        [...keys.values()]
          .filter((key) => isSameOwner(key.owner, owner))
          .map((key) => structuredClone(key)),
      );
    },

    async delete(target, options) {
      return settleUnlessAborted(options, () => {
        const key = keys.get(target.id);
        if (
          key === undefined ||
          (target.owner !== undefined && !isSameOwner(key.owner, target.owner))
        ) {
          return { outcome: "not-found" };
        }
        keys.delete(target.id);

        return { outcome: "deleted" };
      });
    },

    async deleteByOwner(owner, options) {
      return settleUnlessAborted(options, () => {
        const owned = [...keys.values()].filter((key) =>
          isSameOwner(key.owner, owner),
        );
        for (const key of owned) keys.delete(key.id);

        return { deleted: owned.length };
      });
    },

    async touchLastUsed(id, at, notSince, options) {
      return settleUnlessAborted(options, () => {
        const key = keys.get(id);
        if (key === undefined || !isLastUsedStale(key.lastUsedAt, notSince)) {
          return { outcome: "unchanged" };
        }
        keys.set(id, { ...key, lastUsedAt: new Date(at) });

        return { outcome: "touched" };
      });
    },
  };
}
