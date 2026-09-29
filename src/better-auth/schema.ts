import type {
  BetterAuthPluginDBSchema,
  DBFieldAttribute,
} from "@better-auth/core/db";
import { mergeSchema } from "better-auth/db";

/** The model name the plugin registers, and the name every adapter call uses. better-auth maps it to the host's table through `modelName`. */
export const API_KEY_MODEL = "apiKey";

/** The model's logical field names, which the adapter-backed store uses in every call and which a host may map to its own column names. */
export type ApiKeyField =
  | "userId"
  | "name"
  | "keyHash"
  | "start"
  | "scopes"
  | "claims"
  | "createdAt"
  | "expiresAt"
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
 * `keyHash` is unique, which is the index a verification's single lookup uses. `(userId, name)` is unique too, and that compound index also serves every by-owner query (its leading column is `userId`), so `userId` has no index of its own. `lastUsedAt` is deliberately not indexed: nothing queries by it, and an index would turn each throttled last-used write into two. Deleting the owner deletes their keys.
 */
export function apiKeySchema(
  overrides?: ApiKeySchemaOverrides,
): BetterAuthPluginDBSchema {
  return mergeSchema(
    {
      [API_KEY_MODEL]: {
        fields: {
          userId: {
            type: "string",
            required: true,
            references: { model: "user", field: "id", onDelete: "cascade" },
          },
          name: { type: "string", required: true },
          keyHash: { type: "string", required: true, unique: true },
          start: { type: "string", required: true },
          scopes: { type: "json", required: true },
          claims: { type: "json", required: true },
          createdAt: { type: "date", required: true },
          expiresAt: { type: "date", required: true },
          lastUsedAt: { type: "date", required: false },
        } satisfies Record<ApiKeyField, DBFieldAttribute>,
        indexes: [{ fields: ["userId", "name"], unique: true }],
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
