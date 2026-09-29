import type { DBAdapter, Where } from "@better-auth/core/db/adapter";
import * as z from "zod/mini";
import {
  API_KEYS_CONTRACT_VERSION,
  storedApiKeySchema,
  type ApiKeyStore,
  type StoredApiKey,
} from "../contract/index.ts";
import { API_KEY_MODEL } from "./schema.ts";

/**
 * How many keys one `findMany` call reads while listing an owner's keys. better-auth's adapters cap an unbounded `findMany` at 100 rows by default, so the store passes the limit itself and pages until a short page, rather than silently listing only the first hundred.
 */
const LIST_PAGE_SIZE = 100;

/** A row as better-auth's adapter returns it: logical field names, dates as `Date`, JSON parsed, and `null` for an unset nullable column. */
const apiKeyRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  keyHash: z.string(),
  start: z.string(),
  scopes: z.unknown(),
  claims: z.unknown(),
  createdAt: z.date(),
  expiresAt: z.date(),
  lastUsedAt: z.nullish(z.date()),
});

/** Turns an adapter row into a stored key, throwing if the row does not have the model's shape: a malformed row is a broken database, never a key to guess at. */
function storedKeyOf(row: unknown): StoredApiKey {
  const parsed = z.parse(apiKeyRowSchema, row);
  return z.parse(storedApiKeySchema, {
    id: parsed.id,
    ownerId: parsed.userId,
    name: parsed.name,
    keyHash: parsed.keyHash,
    start: parsed.start,
    scopes: parsed.scopes,
    claims: parsed.claims,
    createdAt: parsed.createdAt,
    expiresAt: parsed.expiresAt,
    lastUsedAt: parsed.lastUsedAt === null ? undefined : parsed.lastUsedAt,
  });
}

function byOwnerAndName(ownerId: string, name: string): Where[] {
  return [
    { field: "userId", value: ownerId },
    { field: "name", value: name },
  ];
}

/** The part of better-auth's database adapter the store uses. Narrower than `DBAdapter` itself, whose `transaction` ties it to one auth instance's options type, so any instance's adapter fits. */
export type ApiKeyDatabaseAdapter = Pick<
  DBAdapter,
  "create" | "findOne" | "findMany" | "deleteMany" | "updateMany"
>;

/**
 * An {@link ApiKeyStore} over better-auth's database adapter, so keys live in whatever database the host's better-auth instance uses, under the plugin's schema (and any renames the host made through it). `adapterOf` is read on every call, so the store always uses the adapter better-auth holds at that moment.
 *
 * better-auth's adapters take no abort signal, so the store honours one by checking it before each statement it sends.
 *
 * The conditional last-used write is two statements, each a plain conjunction (`id = ? AND lastUsedAt < ?`, then `id = ? AND lastUsedAt IS NULL`), rather than one `where` mixing `AND` and `OR`: better-auth's adapters disagree on how a mixed list groups (the Drizzle adapter reads it as `(all ANDs) AND (any OR)`, the memory adapter folds it left to right), so a mixed list is not portable. Each statement is atomic on its own, and a key matches at most one of them, so two racing writes with the same cut-off still write once.
 */
export function createAdapterApiKeyStore(
  adapterOf: () => ApiKeyDatabaseAdapter,
): ApiKeyStore {
  return {
    version: API_KEYS_CONTRACT_VERSION,

    async insert(key, options) {
      options?.signal?.throwIfAborted();
      const where = byOwnerAndName(key.ownerId, key.name);
      const adapter = adapterOf();
      if ((await adapter.findOne({ model: API_KEY_MODEL, where })) !== null) {
        return { outcome: "name-taken" };
      }
      options?.signal?.throwIfAborted();
      const row = {
        id: key.id,
        userId: key.ownerId,
        name: key.name,
        keyHash: key.keyHash,
        start: key.start,
        scopes: key.scopes,
        claims: key.claims,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        lastUsedAt: key.lastUsedAt ?? null,
      };
      try {
        await adapter.create({
          model: API_KEY_MODEL,
          data: row,
          forceAllowId: true,
        });
      } catch (error) {
        // A concurrent insert of the same owner and name loses on the unique (userId, name) index. Adapters report that as their own driver error, so the store recognises it by the row that now exists rather than by any error's wording.
        if ((await adapter.findOne({ model: API_KEY_MODEL, where })) !== null) {
          return { outcome: "name-taken" };
        }
        throw error;
      }
      return { outcome: "inserted" };
    },

    async findByHash(keyHash, options) {
      options?.signal?.throwIfAborted();
      const row = await adapterOf().findOne({
        model: API_KEY_MODEL,
        where: [{ field: "keyHash", value: keyHash }],
      });
      return row === null
        ? { outcome: "not-found" }
        : { outcome: "found", key: storedKeyOf(row) };
    },

    async listByOwner(ownerId, options) {
      const keys: StoredApiKey[] = [];
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        options?.signal?.throwIfAborted();
        const page = await adapterOf().findMany({
          model: API_KEY_MODEL,
          where: [{ field: "userId", value: ownerId }],
          sortBy: { field: "id", direction: "asc" },
          limit: LIST_PAGE_SIZE,
          offset,
        });
        keys.push(...page.map(storedKeyOf));
        if (page.length < LIST_PAGE_SIZE) return keys;
      }
    },

    async delete(target, options) {
      options?.signal?.throwIfAborted();
      const where: Where[] = [{ field: "id", value: target.id }];
      if (target.ownerId !== undefined) {
        where.push({ field: "userId", value: target.ownerId });
      }
      const deleted = await adapterOf().deleteMany({
        model: API_KEY_MODEL,
        where,
      });
      return deleted > 0 ? { outcome: "deleted" } : { outcome: "not-found" };
    },

    async deleteByOwner(ownerId, options) {
      options?.signal?.throwIfAborted();
      const deleted = await adapterOf().deleteMany({
        model: API_KEY_MODEL,
        where: [{ field: "userId", value: ownerId }],
      });
      return { deleted };
    },

    async touchLastUsed(id, at, notSince, options) {
      options?.signal?.throwIfAborted();
      const adapter = adapterOf();
      const update = { lastUsedAt: at };
      const stale = await adapter.updateMany({
        model: API_KEY_MODEL,
        where: [
          { field: "id", value: id },
          { field: "lastUsedAt", operator: "lt", value: notSince },
        ],
        update,
      });
      if (stale > 0) return { outcome: "touched" };
      options?.signal?.throwIfAborted();
      const neverUsed = await adapter.updateMany({
        model: API_KEY_MODEL,
        where: [
          { field: "id", value: id },
          { field: "lastUsedAt", value: null },
        ],
        update,
      });
      return neverUsed > 0 ? { outcome: "touched" } : { outcome: "unchanged" };
    },
  };
}
