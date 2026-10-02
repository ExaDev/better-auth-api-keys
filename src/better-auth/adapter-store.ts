import type { DBAdapter, Where } from "@better-auth/core/db/adapter";
import * as z from "zod/mini";
import {
  API_KEYS_CONTRACT_VERSION,
  storedApiKeySchema,
  type ApiKeyListing,
  type ApiKeyOwner,
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
  ownerKind: z.string(),
  ownerId: z.string(),
  userId: z.nullish(z.string()),
  name: z.string(),
  keyHash: z.string(),
  start: z.string(),
  scopes: z.unknown(),
  claims: z.unknown(),
  createdAt: z.date(),
  /** `null` for a key with no expiry, but never absent: a row missing the field is malformed, not a key that never expires. */
  expiresAt: z.nullable(z.date()),
  createdBy: z.nullish(z.string()),
  lastUsedAt: z.nullish(z.date()),
});

/** The row's owner, throwing unless its `userId` agrees with it: a person's key references that same person, and a system principal's key references no one. A row that breaks this is a broken database, never a key to attribute to a guess. */
function ownerOfRow(row: z.output<typeof apiKeyRowSchema>): ApiKeyOwner {
  const userId = row.userId ?? undefined;
  if (row.ownerKind === "user" && userId === row.ownerId) {
    return { kind: "user", id: row.ownerId };
  }
  if (row.ownerKind === "system" && userId === undefined) {
    return { kind: "system", id: row.ownerId };
  }
  throw new Error(
    "An API key row must be a person's key referencing that person, or a system principal's key referencing no one",
  );
}

/** Turns an adapter row into a stored key, throwing if the row does not have the model's shape: a malformed row is a broken database, never a key to guess at. */
function storedKeyOf(row: unknown): StoredApiKey {
  const parsed = z.parse(apiKeyRowSchema, row);

  return z.parse(storedApiKeySchema, {
    id: parsed.id,
    owner: ownerOfRow(parsed),
    name: parsed.name,
    keyHash: parsed.keyHash,
    start: parsed.start,
    scopes: parsed.scopes,
    claims: parsed.claims,
    createdAt: parsed.createdAt,
    expiresAt: parsed.expiresAt,
    createdBy: parsed.createdBy ?? undefined,
    lastUsedAt: parsed.lastUsedAt ?? undefined,
  });
}

/**
 * A row read while listing an owner's keys: the stored key, or, when the row cannot be read as one, its id, so the rest of the owner's keys still list and this one can be revoked. A row without even a string id is not a row of this model at all, so that still throws.
 */
function listingOf(row: unknown): ApiKeyListing {
  try {
    return { outcome: "stored", key: storedKeyOf(row) };
  } catch (error) {
    const identified = z.safeParse(z.object({ id: z.string() }), row);
    if (!identified.success) throw error;

    return { outcome: "malformed", id: identified.data.id };
  }
}

/** Matches `owner`'s keys, by kind and id, so a person and a principal with the same id never match each other's keys. */
function byOwner(owner: Readonly<ApiKeyOwner>): Where[] {
  return [
    { field: "ownerKind", value: owner.kind },
    { field: "ownerId", value: owner.id },
  ];
}

function byOwnerAndName(owner: Readonly<ApiKeyOwner>, name: string): Where[] {
  return [...byOwner(owner), { field: "name", value: name }];
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
      const where = byOwnerAndName(key.owner, key.name);
      const adapter = adapterOf();
      if ((await adapter.findOne({ model: API_KEY_MODEL, where })) !== null) {
        return { outcome: "name-taken" };
      }
      options?.signal?.throwIfAborted();
      const row = {
        id: key.id,
        ownerKind: key.owner.kind,
        ownerId: key.owner.id,
        userId: key.owner.kind === "user" ? key.owner.id : null,
        name: key.name,
        keyHash: key.keyHash,
        start: key.start,
        scopes: key.scopes,
        claims: key.claims,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        createdBy: key.createdBy ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
      };
      try {
        await adapter.create({
          model: API_KEY_MODEL,
          data: row,
          forceAllowId: true,
        });
      } catch (error) {
        // A concurrent insert of the same owner and name loses on the unique (ownerKind, ownerId, name) index. Adapters report that as their own driver error, so the store recognises it by the row that now exists rather than by any error's wording.
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

    async listByOwner(owner, options) {
      /** The owner's keys from `offset` on, one page per call: each page's offset depends on the previous page having been full, so the pages are read in turn. */
      const keysFrom = async (offset: number): Promise<ApiKeyListing[]> => {
        options?.signal?.throwIfAborted();
        const page = await adapterOf().findMany({
          model: API_KEY_MODEL,
          where: byOwner(owner),
          sortBy: { field: "id", direction: "asc" },
          limit: LIST_PAGE_SIZE,
          offset,
        });
        const keys = page.map(listingOf);

        return page.length < LIST_PAGE_SIZE
          ? keys
          : [...keys, ...(await keysFrom(offset + LIST_PAGE_SIZE))];
      };

      return keysFrom(0);
    },

    async delete(target, options) {
      options?.signal?.throwIfAborted();
      const where: Where[] = [{ field: "id", value: target.id }];
      if (target.owner !== undefined) where.push(...byOwner(target.owner));
      const deleted = await adapterOf().deleteMany({
        model: API_KEY_MODEL,
        where,
      });

      return deleted > 0 ? { outcome: "deleted" } : { outcome: "not-found" };
    },

    async deleteByOwner(owner, options) {
      options?.signal?.throwIfAborted();
      const deleted = await adapterOf().deleteMany({
        model: API_KEY_MODEL,
        where: byOwner(owner),
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
