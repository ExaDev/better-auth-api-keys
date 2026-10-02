/**
 * The migration that took a host's `api_key` table from 0.1.0 of the package to 0.2.0, as the 0.2.0 README gave it to hosts, kept here so the Workers tests go on proving that a 0.1.0 table still upgrades and its keys still verify. Every key in a 0.1.0 table is a person's, so the rebuild copies each one as its person's. The rebuild drops the old table, so its statements must run as one transaction: D1 applies a migration file, or a `batch`, as one.
 */
export const V0_1_0_TO_V0_2_0_D1_MIGRATION = `CREATE TABLE api_key_new (
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
INSERT INTO api_key_new (id, owner_kind, owner_id, user_id, name, key_hash, start, scopes, claims, created_at, expires_at, last_used_at)
  SELECT id, 'user', user_id, user_id, name, key_hash, start, scopes, claims, created_at, expires_at, last_used_at FROM api_key;
DROP TABLE api_key;
ALTER TABLE api_key_new RENAME TO api_key;
CREATE UNIQUE INDEX api_key_owner_name ON api_key (owner_kind, owner_id, name);
CREATE INDEX api_key_user_id ON api_key (user_id);
`;

/**
 * Deletes every 0.1.0 key whose person is gone, which a database that once ran without foreign-key enforcement may hold, and which would otherwise make the migration's copy fail. Every 0.1.0 key has a `user_id`, and `user.id` is never null, so `NOT IN` matches exactly the orphans.
 */
export const V0_1_0_DELETE_ORPHANED_KEYS = `DELETE FROM api_key WHERE user_id NOT IN (SELECT id FROM user);
`;
