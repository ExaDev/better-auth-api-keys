import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  TEST_AUTH_SECRET,
  TEST_BASE_URL,
  type TestPlugin,
} from "../../src/test-support/plugin-fixture.ts";
import { readmeSchemaSql, statementsOf } from "./readme-schema.ts";
import { V0_1_0_TO_V0_2_0_D1_MIGRATION } from "./v0.1.0-migration.ts";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

// better-auth's core tables, declared as a host using Drizzle on SQLite would declare them, so better-auth's own schema check sees a complete database.
const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text(),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

const session = sqliteTable("session", {
  id: text().primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text().notNull().unique(),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

const account = sqliteTable("account", {
  id: text().primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text(),
  password: text(),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

const verification = sqliteTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * The plugin's `apiKey` model as a host would declare it in Drizzle, as the README declares it, with the check the README's SQL adds: `userId` agrees with the owner, and a person's key always expires. `scopes` and `claims` are plain `text()`, not `text({ mode: "json" })`: better-auth's SQLite adapter already serialises `json` fields to a string, so a JSON-mode column would encode them twice.
 */
const apiKey = sqliteTable(
  "api_key",
  {
    id: text().primaryKey(),
    ownerKind: text("owner_kind").notNull(),
    ownerId: text("owner_id").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    keyHash: text("key_hash").notNull().unique(),
    start: text().notNull(),
    scopes: text().notNull(),
    claims: text().notNull(),
    createdAt: timestamp("created_at").notNull(),
    expiresAt: timestamp("expires_at"),
    createdBy: text("created_by"),
    lastUsedAt: timestamp("last_used_at"),
  },
  (table) => [
    uniqueIndex("api_key_owner_name").on(
      table.ownerKind,
      table.ownerId,
      table.name,
    ),
    index("api_key_user_id").on(table.userId),
    check(
      "api_key_owner",
      sql`(${table.ownerKind} = 'user' AND ${table.userId} IS NOT NULL AND ${table.userId} = ${table.ownerId} AND ${table.expiresAt} IS NOT NULL) OR (${table.ownerKind} = 'system' AND ${table.userId} IS NULL)`,
    ),
  ],
);

/** better-auth's core tables as SQL, created fresh for each test, after dropping every table: the package ships no migrations, so the test owns its database. */
const CORE_TABLES = [
  "DROP TABLE IF EXISTS api_key",
  "DROP TABLE IF EXISTS verification",
  "DROP TABLE IF EXISTS account",
  "DROP TABLE IF EXISTS session",
  "DROP TABLE IF EXISTS user",
  `CREATE TABLE user (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified integer NOT NULL DEFAULT 0, image text, created_at integer NOT NULL, updated_at integer NOT NULL)`,
  `CREATE TABLE session (id text PRIMARY KEY, expires_at integer NOT NULL, token text NOT NULL UNIQUE, created_at integer NOT NULL, updated_at integer NOT NULL, ip_address text, user_agent text, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE)`,
  `CREATE TABLE account (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE, access_token text, refresh_token text, id_token text, access_token_expires_at integer, refresh_token_expires_at integer, scope text, password text, created_at integer NOT NULL, updated_at integer NOT NULL)`,
  `CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)`,
];

/** The `api_key` table as the README tells a host to create it in a new database, read from the README itself, so every test that resets the database runs against exactly that table; {@link apiKey} declares the same table for Drizzle. */
function apiKeyTable(): string[] {
  return statementsOf(readmeSchemaSql());
}

/** The `api_key` table as version 0.1.0 of the package declared it: every key a person's, and every key expiring. `foreignKeys: false` leaves out the reference to `user`, as a database built without foreign-key enforcement would behave, so a key can outlive its person. */
function v0_1_0ApiKeyTable(foreignKeys: boolean): string[] {
  const references = foreignKeys
    ? " REFERENCES user(id) ON DELETE CASCADE"
    : "";

  return [
    `CREATE TABLE api_key (id text PRIMARY KEY, user_id text NOT NULL${references}, name text NOT NULL, key_hash text NOT NULL UNIQUE, start text NOT NULL, scopes text NOT NULL, claims text NOT NULL, created_at integer NOT NULL, expires_at integer NOT NULL, last_used_at integer)`,
    "CREATE UNIQUE INDEX api_key_user_id_name ON api_key (user_id, name)",
  ];
}

async function run(statements: readonly string[]): Promise<void> {
  await env.DATABASE.batch(
    statements.map((statement) => env.DATABASE.prepare(statement)),
  );
}

/** Recreates the tables, empty, with `api_key` as version 0.1.0 declared it. */
export async function resetToV0_1_0(
  options: { readonly foreignKeys: boolean } = { foreignKeys: true },
): Promise<void> {
  await run([...CORE_TABLES, ...v0_1_0ApiKeyTable(options.foreignKeys)]);
}

/** Runs the D1 migration file from 0.1.0 to 0.2.0 as one batch, which D1 applies as one transaction as `wrangler d1 migrations apply` does a migration file. */
export async function migrateFromV0_1_0(): Promise<void> {
  await run(statementsOf(V0_1_0_TO_V0_2_0_D1_MIGRATION));
}

/**
 * The `api_key` table as the database itself describes it: each column's name, type, nullability, key and whether a unique index covers that column alone (a `UNIQUE` column constraint or a single-column unique index), and each index created by `CREATE INDEX` with its uniqueness and columns. Read from the live database, so it shows what a migration actually built rather than what any declaration says.
 */
export async function describeApiKeyTable(): Promise<{
  readonly columns: readonly Record<string, unknown>[];
  readonly indexes: readonly Record<string, unknown>[];
}> {
  const columns = await env.DATABASE.prepare(
    `SELECT ti.name, ti.type, ti."notnull", ti.pk,
       EXISTS (
         SELECT 1 FROM pragma_index_list('api_key') AS il
         WHERE il."unique" = 1
           AND (SELECT count(*) FROM pragma_index_info(il.name)) = 1
           AND (SELECT name FROM pragma_index_info(il.name)) = ti.name
       ) AS "unique"
     FROM pragma_table_info('api_key') AS ti ORDER BY ti.cid`,
  ).all();
  const indexes = await env.DATABASE.prepare(
    "SELECT il.name, il.\"unique\", group_concat(ii.name, ',') AS columns FROM pragma_index_list('api_key') AS il, pragma_index_info(il.name) AS ii WHERE il.origin = 'c' GROUP BY il.name ORDER BY il.name",
  ).all();

  return { columns: columns.results, indexes: indexes.results };
}

/** Recreates the tables, empty. */
export async function resetDatabase(): Promise<void> {
  await run([...CORE_TABLES, ...apiKeyTable()]);
}

/** A better-auth instance over the test D1 database through the Drizzle adapter, with `plugin` registered. */
export function d1Auth(plugin: TestPlugin) {
  return betterAuth({
    secret: TEST_AUTH_SECRET,
    baseURL: TEST_BASE_URL,
    database: drizzleAdapter(drizzle(env.DATABASE), {
      provider: "sqlite",
      schema: { user, session, account, verification, apiKey },
    }),
    plugins: [plugin],
  });
}

/** Adds a person, whose id a key's owner must reference. */
export async function addUser(id: string): Promise<void> {
  const now = Date.now();
  await env.DATABASE.prepare(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  )
    .bind(id, id, `${id}@example.com`, now, now)
    .run();
}
