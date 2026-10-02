import {
  API_KEYS_CONTRACT_VERSION,
  type ApiKeyStore,
  type StoredApiKey,
} from "../contract/index.ts";
import { isLastUsedStale, settleUnlessAborted } from "../core/index.ts";

/**
 * An {@link ApiKeyStore} held in memory, for tests of code that uses the service. It keeps every guarantee the port states (unique hashes, unique names per owner, the conditional last-used write, abort signals honoured before any change), so a test against it exercises the same outcomes a database-backed store gives. Records are copied in and out, so a caller mutating a result cannot change what is stored.
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
              existing.ownerId === key.ownerId && existing.name === key.name,
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

    async listByOwner(ownerId, options) {
      return settleUnlessAborted(options, () =>
        [...keys.values()]
          .filter((key) => key.ownerId === ownerId)
          .map((key) => structuredClone(key)),
      );
    },

    async delete(target, options) {
      return settleUnlessAborted(options, () => {
        const key = keys.get(target.id);
        if (
          key === undefined ||
          (target.ownerId !== undefined && key.ownerId !== target.ownerId)
        ) {
          return { outcome: "not-found" };
        }
        keys.delete(target.id);

        return { outcome: "deleted" };
      });
    },

    async deleteByOwner(ownerId, options) {
      return settleUnlessAborted(options, () => {
        const owned = [...keys.values()].filter(
          (key) => key.ownerId === ownerId,
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
