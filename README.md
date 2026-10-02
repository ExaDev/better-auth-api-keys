# @exadev/better-auth-api-keys

A [better-auth](https://www.better-auth.com/) plugin for long-lived API keys, for unattended scripts and services calling an API as a person, or as a system principal the host defines that belongs to no person. It has no runtime dependencies of its own: `zod`, `better-auth` and `@better-auth/core` are peers, so the plugin parses with the same Zod your scope and claim schemas were built with, and runs on the better-auth your app already has. It uses only Web APIs, so it runs unchanged in Cloudflare Workers, browsers and Node 22 or later.

```sh
pnpm add @exadev/better-auth-api-keys zod better-auth @better-auth/core
```

The peer ranges are `zod` `^4.0.0` and `better-auth` and `@better-auth/core` `^1.7.5`. CI runs the tests against the lowest and the newest version each range admits.

The same build is also published under the unscoped names `better-auth-api-keys` and `better-better-auth-api-key`; all three are one package, so install only one of them.

## Why this exists

better-auth has its own API-key plugin, [`@better-auth/api-key`](https://www.better-auth.com/docs/plugins/api-key). This package is not that plugin, not a fork of it, and not affiliated with better-auth: it is an independent alternative written by ExaDev, and its name differs from the official one by a single letter, so check which one you are installing. It was written for an app on Cloudflare Workers and D1 that needed verification that never writes to the database, keys stored only under a peppered hash, keys that never become a better-auth session, and keys owned by system principals that keep working when people leave. Use `@better-auth/api-key` if you want ready-made endpoints and client methods for managing keys, built-in rate limits and usage quotas, a permission model, or organisation-owned keys. Use this package if your app manages keys through its own authorised procedures, decides what a key may do itself, and wants a verification that only reads.

How the two differ, checked against the published source of `@better-auth/api-key` 1.7.6 and its documentation ([plugin](https://www.better-auth.com/docs/plugins/api-key), [archived](https://web.archive.org/web/20260911201031/https://better-auth.com/docs/plugins/api-key); [advanced](https://www.better-auth.com/docs/plugins/api-key/advanced), [archived](https://web.archive.org/web/20260705105906/https://better-auth.com/docs/plugins/api-key/advanced); [reference](https://www.better-auth.com/docs/plugins/api-key/reference), [archived](https://web.archive.org/web/20260607215137/https://better-auth.com/docs/plugins/api-key/reference)):

|                          | `@better-auth/api-key` 1.7.6                                                                                                                                                                                                                                                                                                                                                                                        | This package                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Writes on verification   | With the default `database` storage, every successful verification writes the key's row: always `updatedAt`, plus its rate-limit bookkeeping (`lastRequest`, `requestCount`) and `remaining` when the key has a quota. These writes run inline even with `deferUpdates`, and no option turns them all off. With `storage: "secondary-storage"` and no database fallback, the same writes go to the secondary store. | `verify` only reads. The host calls `recordUse` once it accepts a key, which writes the last-used time at most once per `lastUsedIntervalMs`, through the host's `defer`.          |
| Stored hash              | Unpeppered SHA-256 of the key. There is no option to supply a hasher; `disableKeyHashing` stores the key in plain text.                                                                                                                                                                                                                                                                                             | `HMAC-SHA256(pepper, key)`, with the pepper a server secret outside the database. The hasher is injected.                                                                          |
| Key format               | 64 random letters by default after an optional prefix, with no checksum.                                                                                                                                                                                                                                                                                                                                            | A required prefix, 43 base62 characters (256 bits) and a CRC-32 checksum, so a mistyped or made-up key is refused before any hash or database read.                                |
| Sessions                 | `enableSessionForAPIKeys` (off by default; its own option docs say it is not recommended for production) turns a user's key in the request headers (`x-api-key` by default) into a session on every better-auth endpoint.                                                                                                                                                                                           | None. A key authenticates only where the host calls `verify`.                                                                                                                      |
| Ownership                | A user, or an organisation with `references: "organization"`. `referenceId` has no foreign key and the plugin removes nothing when a user is deleted, so a deleted user's keys remain and still pass `verifyApiKey`.                                                                                                                                                                                                | A person, whose keys are deleted with them by a cascading foreign key, or a system principal the host defines, whose keys survive any person's removal. No organisation ownership. |
| Expiry                   | Optional: a key never expires unless created with `expiresIn` or the plugin's `keyExpiration.defaultExpiresIn` is set. A requested `expiresIn` must fall within `minExpiresIn` and `maxExpiresIn` (1 to 365 days by default). Expired keys are deleted when verified and swept from the plugin's endpoints.                                                                                                         | Required for a person's key, bounded by `maxLifetimeMs`. Only a system principal's key may have none, and only with `allowNonExpiringSystemKeys`. Expired keys stay until revoked. |
| Permissions              | Resource-to-actions statements (`Record<string, string[]>`) checked through better-auth's access control at verification, with `defaultPermissions`, plus optional JSON metadata.                                                                                                                                                                                                                                   | None of its own. Scopes and claims are opaque JSON typed by the host's Zod schemas, and the host's authoriser decides what a key may do.                                           |
| Rate limiting and quotas | Per-key rate limiting, on by default at 10 verifications a day; `remaining` usage counts with `refillAmount` and `refillInterval`; a key that reaches zero with no refill is deleted.                                                                                                                                                                                                                               | None.                                                                                                                                                                              |
| Management               | Endpoints to create, get, update, delete and list keys, a server-only verify and a server-only sweep of expired keys, with client methods; organisation keys are managed through the organisation plugin's roles.                                                                                                                                                                                                   | No endpoints. The host calls `create`, `list`, `revoke` and `revokeAllForOwner` from its own authorised procedures. No rotation: revoke, then create.                              |

## Security model

A key is a prefix the host chooses (`exshow_` in the examples here) followed by 43 base62 characters and a 6-character base62 checksum.

- **256 bits of entropy.** The 43 random characters are drawn by rejection sampling of random bytes (a byte from 248 up is discarded, so every character is exactly equally likely), which carries 256 bits. Guessing is not a threat, so verification needs neither a slow hash nor a per-attempt counter.
- **Offline check first.** The checksum is the standard CRC-32 of the prefix and random part. `verify` checks the prefix, the length, the alphabet and the checksum before anything else, so a mistyped, truncated or made-up key is refused without a hash or a database read. Any single-character change to a genuine key fails the check. The prefix and checksum also let a leaked key be recognised by a person or a secret scanner.
- **Peppered hash only.** The key itself is never stored. The database holds `HMAC-SHA256(pepper, key)` in a unique column, where the pepper is a server secret kept out of the database (a Worker secret such as `API_KEY_PEPPER` in the example below). A copy of the database alone gives nothing to test guesses against. The hasher is injected, and the Web Crypto one caches its imported key per instance.
- **One indexed lookup.** A presented key is found by an equality match on its hash, so no constant-time comparison is needed: the lookup reveals nothing a guess could build on.
- **Every person's key expires.** An expiry is required at creation, bounded by the host's `maxLifetimeMs`. A key is valid up to, not at, its expiry instant. Only a system principal's key may be created with no expiry, and only when the host sets `allowNonExpiringSystemKeys`; the rule is checked on every read as well, so turning the setting off disables every key it let through (they verify as `unknown` and list as `unreadable`, to be revoked).
- **Throttled last-used write, only for keys the host accepts.** `verify` only reads, so a key the host goes on to refuse for its own reasons (its owner disabled, say) never looks used. Once the host accepts a key it calls `recordUse`, which, when the key's recorded last use is older than the host's `lastUsedIntervalMs`, hands one conditional write to the host's `defer` (a Worker's `ctx.waitUntil`) that sets the time only if it is still older than the cut-off, so a busy key costs at most one write per interval and two racing requests write once.
- **No session hook.** The plugin contributes no endpoints, no hooks, no middleware and no rate-limit rules. A key authenticates only where the host calls `verify` itself; it never becomes a better-auth session, so it cannot reach better-auth's own endpoints.
- **Scopes and claims are the host's.** Both are opaque to the package, typed by Zod schemas the host injects and stored as JSON. They are validated on creation and on every read; a stored key whose scopes or claims no longer pass the schemas verifies as `unknown`, and lists as `unreadable` so its owner can still revoke it. Whether scopes permit a request is decided by the host's injected authoriser.

### What it deliberately does not do

These are the gaps the [comparison with `@better-auth/api-key`](#why-this-exists) lists, and they are deliberate. It has no management endpoints (the host calls the service from its own authorised procedures), no rotation (revoke, then create), no sweep of expired keys, no remaining-uses or refill quotas, no organisation ownership, no rate limiting (the host's platform limits requests), and no permission model or authority of its own, for people or for system principals. It does not decide whom a key acts as beyond recording its owner's kind and id: the host checks the owner is still allowed in, and what it may do, on every request.

## System principals

A system key is programmatic access that belongs to no person, so it keeps working when people come and go. It is owned by a system principal: a named caller the host defines and stores in its own table, with whatever role or ceiling the host gives it. The package knows only the principal's id and that it is a principal, never its authority; the host decides what the principal may do, on each request, exactly as it does for a person. A principal's id is the host's own and is never resolved by the package, and it lives in a separate namespace from user ids, so `{ kind: "system", id: "alice" }` and the person `alice` are two different owners whose keys never mix.

```ts
const created = await service.create({
  owner: { kind: "system", id: principal.id },
  name: "nightly export",
  lifetimeMs: 365 * DAY_MS, // or null, when allowNonExpiringSystemKeys is set
  scopes,
  claims,
  createdBy: session.user.id, // optional, stored as plain text
});

const result = await service.verify(presentedKey, { signal: request.signal });
if (result.outcome === "valid") {
  const { owner } = result.key;
  // owner.kind narrows owner: look the principal up in the host's own table, or the person in better-auth's.
}
```

Every owner names its kind: `{ kind: "user", id }` for a person, `{ kind: "system", id }` for a principal. An owner with no `kind`, or any other, is refused (`create` reports the owner as invalid; `list`, `revoke` and `revokeAllForOwner` throw), never read as a person, so a principal's id passed without its kind can never list or revoke a person's keys. A name is unique per owner, and `revoke` with an owner deletes the key only if that owner, of the same kind, holds it. `verify` and `list` report the owner only as `owner`, with no bare `ownerId`, so code that looks the owner up has to choose a table by `owner.kind`: a principal's id may equal a person's, and looking it up among people would authenticate the principal as that person.

`createdBy` records who created a key as plain text with no reference, at most `API_KEY_CREATED_BY_MAX_LENGTH` (254) characters, enough for a user id or any email address, so removing that person changes nothing about the key; it is for the host to show, and the host's own audit log remains the record of who did what.

**Deleting a principal is the host's job.** Deleting a person deletes their keys through the database's cascade, and leaves every system key alone. Nothing references a principal, so the package cannot cascade when one goes: the host's own principal deletion must call `service.revokeAllForOwner({ kind: "system", id })`, in the same operation where it can, or the principal's keys go on verifying for an owner the host no longer has. A host that looks the principal up on every request refuses them anyway, but should not rely on that alone.

## Using it

```ts
import { apiKeys, apiKeysOf } from "@exadev/better-auth-api-keys";
import {
  createWebCryptoKeyHasher,
  systemClock,
  webCryptoRandomSource,
} from "@exadev/better-auth-api-keys/web-crypto";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The prefix, the pepper's name, the schemas and the authoriser are the host's own.
export const apiKeyPlugin = apiKeys({
  prefix: "exshow_",
  maxLifetimeMs: 365 * DAY_MS,
  lastUsedIntervalMs: HOUR_MS,
  hasher: createWebCryptoKeyHasher(env.API_KEY_PEPPER),
  random: webCryptoRandomSource,
  clock: systemClock,
  scopes: scopesSchema,
  claims: claimsSchema,
  authoriser,
});

// betterAuth({ ..., plugins: [apiKeyPlugin] })

const service = apiKeysOf(await auth.$context, apiKeyPlugin);
const result = await service.verify(presentedKey, { signal: request.signal });
if (result.outcome === "valid" /* and the host's own checks accept it */) {
  await service.recordUse(result.key, {
    defer: (task) => ctx.waitUntil(task),
  });
}
```

## Database schema

The plugin registers an `apiKey` model: `id`; the owner as `ownerKind` (`"user"` or `"system"`) and `ownerId`; a nullable `userId` referencing `user.id` with cascading delete, set (to `ownerId`) only for a person's key, and indexed for that delete; `name`; `keyHash` unique; `start`; `scopes` and `claims` as JSON; `createdAt`; a nullable `expiresAt` (null only for a system key with no expiry); a nullable plain-text `createdBy`; and an unindexed nullable `lastUsedAt`; with `(ownerKind, ownerId, name)` unique. The owner is two required columns rather than a nullable `userId` beside a nullable `systemId` because better-auth refuses a unique index over a nullable column (SQL Server and MongoDB treat nulls in a unique index as equal), and a name must be unique per owner. Its table and columns can be renamed through the `schema` option, as better-auth's own plugins allow. With a Drizzle SQLite database, declare `scopes` and `claims` as plain `text()`: better-auth's SQLite adapter already serialises JSON fields, so a `text({ mode: "json" })` column encodes them twice.

The package ships no migrations: create the table with your own migration tool. On D1 or SQLite, with the column names the Drizzle declaration below uses (adjust them to your own):

```sql
CREATE TABLE api_key (
  id text PRIMARY KEY,
  owner_kind text NOT NULL,
  owner_id text NOT NULL,
  user_id text REFERENCES user(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  start text NOT NULL,
  scopes text NOT NULL,
  claims text NOT NULL,
  created_at integer NOT NULL,
  expires_at integer,
  created_by text,
  last_used_at integer,
  CONSTRAINT api_key_owner CHECK (
    (owner_kind = 'user' AND user_id IS NOT NULL AND user_id = owner_id AND expires_at IS NOT NULL)
    OR (owner_kind = 'system' AND user_id IS NULL)
  )
);
CREATE UNIQUE INDEX api_key_owner_name ON api_key (owner_kind, owner_id, name);
CREATE INDEX api_key_user_id ON api_key (user_id);
```

The `api_key_owner` check is the rule better-auth's schema cannot express, since it spans columns: a person's key names the same person in `user_id` and `owner_id` and always expires, and a system principal's key has no `user_id`. The adapter-backed store always writes a row that passes it and refuses to read one whose `userId` does not agree with its owner (verifying such a key throws; listing its owner's keys reports it as `corrupt`, by id, beside the rest, so it can be revoked without hiding the others), and the service refuses a person's key with no expiry whatever the database holds; the check makes the database refuse such a row as well. Deleting a person deletes their keys only where foreign keys are enforced: D1 always enforces them, and plain SQLite only on a connection that has run `PRAGMA foreign_keys = ON`. The Workers tests create their table from this block of the README.

better-auth's schema check will not tell you the table is missing or out of date: with the Drizzle adapter it compares the plugin's schema with your Drizzle declaration, not with the database, so it catches a stale declaration but not a migration that never ran. A release that changes the table says so in its release notes; run its migration before deploying code on that release.

The same table declared for Drizzle:

```ts
export const apiKey = sqliteTable(
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
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by"),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
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
```

## Entry points

- `.`: the plugin (`apiKeys`, `apiKeysOf`, `apiKeySchema`, `API_KEY_ERROR_CODES`) and the adapter-backed store. The only entry point that imports better-auth.
- `./contract`: the port interfaces (`ApiKeyStore`, `KeyHasher`, `RandomSource`, `Clock`, `ScopeAuthoriser`), the key types and schemas, and `API_KEYS_CONTRACT_VERSION`, carried by every port as `version` and bumped on any breaking change to a port.
- `./core`: `createApiKeyService` and the key format, usable with any `ApiKeyStore` and no better-auth at all.
- `./web-crypto`: the HMAC hasher, random source and clock for any runtime with Web Crypto.
- `./testing`: an in-memory store and a manual clock for tests of code that uses the service.

## Development

`pnpm test` runs the unit tests (the core, the plugin over better-auth's memory adapter, the manifest and the import boundary), and `pnpm test:workers` runs the adapter-backed store against D1 through better-auth's Drizzle adapter in a real Workers isolate. `pnpm lint`, `pnpm typecheck` and `pnpm build` (tsdown, ESM only, with declarations) complete the checks CI runs; `pnpm test:mutation` runs Stryker. The lint configuration refuses any Node builtin, anything Cloudflare, Drizzle, a relative import leaving `src/`, and better-auth outside `src/better-auth/`, so the package stays runtime-neutral and its other entry points work without better-auth.

Commits follow Conventional Commits, checked by commitlint. Merging to `main` releases through semantic-release, which publishes to npm with trusted publishing from the Release job in `.github/workflows/ci.yml`. The same release is then published under each unscoped name in `.github/npm-aliases.json`, one parallel `Publish alias` job per name, each building the release tag and refusing to publish unless its tarball matches the primary's apart from the name and description. Each alias name needs its own trusted publisher for `ci.yml`. To publish an existing release under the aliases (after registering a new alias's trusted publisher, say), run the CI workflow by hand with `alias_tag` set to the primary's latest release tag; a version an alias already has is skipped.

## Licence

MIT.
