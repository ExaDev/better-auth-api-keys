# @exadev/better-auth-api-keys

A [better-auth](https://www.better-auth.com/) plugin for long-lived API keys, for unattended scripts and services calling an API as a person. It lives in the `show` repository for now and is built to move to its own repository and npm package unchanged: it depends at runtime on `zod` alone, takes `better-auth` and `@better-auth/core` as peers, and imports nothing from the app around it.

## Security model

A key looks like `exshow_` followed by 43 base62 characters and a 6-character base62 checksum. The prefix is chosen by the host.

- **256 bits of entropy.** The 43 random characters are drawn by rejection sampling of random bytes (a byte from 248 up is discarded, so every character is exactly equally likely), which carries 256 bits. Guessing is not a threat, so verification needs neither a slow hash nor a per-attempt counter.
- **Offline check first.** The checksum is the standard CRC-32 of the prefix and random part. `verify` checks the prefix, the length, the alphabet and the checksum before anything else, so a mistyped, truncated or made-up key is refused without a hash or a database read. Any single-character change to a genuine key fails the check. The prefix and checksum also let a leaked key be recognised by a person or a secret scanner.
- **Peppered hash only.** The key itself is never stored. The database holds `HMAC-SHA256(pepper, key)` in a unique column, where the pepper is a server secret kept out of the database (in `show`, the `API_KEY_PEPPER` Worker secret). A copy of the database alone gives nothing to test guesses against. The hasher is injected, and the Web Crypto one caches its imported key per instance.
- **One indexed lookup.** A presented key is found by an equality match on its hash, so no constant-time comparison is needed: the lookup reveals nothing a guess could build on.
- **Every key expires.** An expiry is required at creation, bounded by the host's `maxLifetimeMs`. A key is valid up to, not at, its expiry instant.
- **Throttled last-used write, only for keys the host accepts.** `verify` only reads, so a key the host goes on to refuse for its own reasons (its owner disabled, say) never looks used. Once the host accepts a key it calls `recordUse`, which, when the key's recorded last use is older than the host's `lastUsedIntervalMs`, hands one conditional write to the host's `defer` (a Worker's `ctx.waitUntil`) that sets the time only if it is still older than the cut-off, so a busy key costs at most one write per interval and two racing requests write once.
- **No session hook.** The plugin contributes no endpoints, no hooks, no middleware and no rate-limit rules. A key authenticates only where the host calls `verify` itself; it never becomes a better-auth session, so it cannot reach better-auth's own endpoints.
- **Scopes and claims are the host's.** Both are opaque to the package, typed by Zod schemas the host injects and stored as JSON. They are validated on creation and on every read; a stored key whose scopes or claims no longer pass the schemas verifies as `unknown`, and lists as `unreadable` so its owner can still revoke it. Whether scopes permit a request is decided by the host's injected authoriser.

### What it deliberately does not do

It has no management endpoints (the host calls the service from its own authorised procedures), no rotation (revoke, then create), no sweep of expired keys, no remaining-uses or refill quotas, no organisation ownership, no rate limiting (the host's platform limits requests), and no permission model of its own. It does not decide whom a key acts as beyond recording its owner's id: the host checks the owner is still allowed in, on every request.

## Using it

```ts
import { apiKeys, apiKeysOf } from "@exadev/better-auth-api-keys";
import {
  createWebCryptoKeyHasher,
  systemClock,
  webCryptoRandomSource,
} from "@exadev/better-auth-api-keys/web-crypto";

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

The plugin registers an `apiKey` model (`id`, `userId` referencing `user.id` with cascading delete, `name`, `keyHash` unique, `start`, `scopes` and `claims` as JSON, `createdAt`, `expiresAt`, and an unindexed nullable `lastUsedAt`, with `(userId, name)` unique). Its table and columns can be renamed through the `schema` option, as better-auth's own plugins allow. With a Drizzle SQLite database, declare `scopes` and `claims` as plain `text()`: better-auth's SQLite adapter already serialises JSON fields, so a `text({ mode: "json" })` column encodes them twice.

## Entry points

- `.`: the plugin (`apiKeys`, `apiKeysOf`, `apiKeySchema`, `API_KEY_ERROR_CODES`) and the adapter-backed store. The only entry point that imports better-auth.
- `./contract`: the port interfaces (`ApiKeyStore`, `KeyHasher`, `RandomSource`, `Clock`, `ScopeAuthoriser`), the key types and schemas, and `API_KEYS_CONTRACT_VERSION`, carried by every port as `version` and bumped on any breaking change to a port.
- `./core`: `createApiKeyService` and the key format, usable with any `ApiKeyStore` and no better-auth at all.
- `./web-crypto`: the HMAC hasher, random source and clock for any runtime with Web Crypto.
- `./testing`: an in-memory store and a manual clock for tests of code that uses the service.

## Development

`pnpm --filter @exadev/better-auth-api-keys test` runs the unit tests (the core, the plugin over better-auth's memory adapter, the manifest and the import boundary), and `test:workers` runs the adapter-backed store against D1 through better-auth's Drizzle adapter in a real Workers isolate. The package's lint configuration refuses any import of a workspace package, Cloudflare, Drizzle, or better-auth outside `src/better-auth/`, so it stays extractable.

## Licence

MIT.
