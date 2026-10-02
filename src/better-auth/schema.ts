import type {
  BetterAuthPluginDBSchema,
  DBFieldAttribute,
} from "@better-auth/core/db";
import { mergeSchema } from "better-auth/db";

/** The model name the plugin registers, and the name every adapter call uses. better-auth maps it to the host's table through `modelName`. */
export const API_KEY_MODEL = "apiKey";

/** The model's logical field names, which the adapter-backed store uses in every call and which a host may map to its own column names. */
export type ApiKeyField =
  | "ownerKind"
  | "ownerId"
  | "userId"
  | "name"
  | "keyHash"
  | "start"
  | "scopes"
  | "claims"
  | "createdAt"
  | "expiresAt"
  | "createdBy"
  | "lastUsedAt";

/** How a host renames the model's table and columns, passed through better-auth's own `mergeSchema`. */
export interface ApiKeySchemaOverrides {
  readonly apiKey?: {
    readonly modelName?: string;
    readonly fields?: Partial<Record<ApiKeyField, string>>;
  };
}

/**
 * The `apiKey` model's schema, built fresh on every call because better-auth's `mergeSchema` renames by mutating the object it is given.
 *
 * A key's owner is `ownerKind` (`"user"` or `"system"`) and `ownerId`, both required. A person's key also sets `userId` to the same id, referencing `user.id`, so deleting the person deletes their keys; a system principal's key leaves `userId` null, and its `ownerId` references nothing, so no deletion in better-auth's tables touches it. The owner is not simply a nullable `userId` beside a nullable `systemId` because better-auth refuses a unique index over a column that is not required (SQL Server and MongoDB treat nulls in a unique index as equal, so it would not behave the same everywhere), and a name must be unique per owner. better-auth's schema cannot express a check across columns either, so the adapter-backed store always writes a consistent row and refuses to read one whose `userId` disagrees with its owner, and a host's own migration may add the check as well (the README gives it).
 *
 * `keyHash` is unique, which is the index a verification's single lookup uses. `(ownerKind, ownerId, name)` is unique too, so a name is unique per owner, and a person and a principal with the same id are different owners; that compound index also serves every by-owner query. `userId` has an index of its own for the cascading delete, which would otherwise scan the table for each person deleted. `expiresAt` is null for a system key created with no expiry. `createdBy` is plain text naming who created the key, with no reference, so removing the creator changes nothing. `lastUsedAt` is deliberately not indexed: nothing queries by it, and an index would turn each throttled last-used write into two.
 */
export function apiKeySchema(
  overrides?: ApiKeySchemaOverrides,
): BetterAuthPluginDBSchema {
  return mergeSchema(
    {
      [API_KEY_MODEL]: {
        fields: {
          ownerKind: { type: "string", required: true },
          ownerId: { type: "string", required: true },
          userId: {
            type: "string",
            required: false,
            references: { model: "user", field: "id", onDelete: "cascade" },
          },
          name: { type: "string", required: true },
          keyHash: { type: "string", required: true, unique: true },
          start: { type: "string", required: true },
          scopes: { type: "json", required: true },
          claims: { type: "json", required: true },
          createdAt: { type: "date", required: true },
          expiresAt: { type: "date", required: false },
          createdBy: { type: "string", required: false },
          lastUsedAt: { type: "date", required: false },
        } satisfies Record<ApiKeyField, DBFieldAttribute>,
        indexes: [
          { fields: ["ownerKind", "ownerId", "name"], unique: true },
          { fields: ["userId"] },
        ],
      },
    },
    overrides === undefined
      ? undefined
      : {
          [API_KEY_MODEL]: {
            modelName: overrides.apiKey?.modelName,
            fields: overrides.apiKey?.fields,
          },
        },
  );
}
