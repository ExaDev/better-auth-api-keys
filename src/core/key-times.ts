/** The cut-off for a last-used write at `now`: a key last used strictly before it is stale and gets written again. */
export function lastUsedCutOff(now: Date, intervalMs: number): Date {
  return new Date(now.getTime() - intervalMs);
}

/**
 * Whether a key's recorded last use is stale against `notSince`: never used, or last used strictly before it. The one rule both the service's decision to write and every store's conditional write apply, so the two can never disagree.
 */
export function isLastUsedStale(
  lastUsedAt: Date | undefined,
  notSince: Date,
): boolean {
  return lastUsedAt === undefined || lastUsedAt.getTime() < notSince.getTime();
}

/** Whether a key expiring at `expiresAt` has expired at `now`. A key is valid up to, but not at, its expiry instant; a key with no expiry (`null`, which only a system principal's key can have) never expires. */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}
