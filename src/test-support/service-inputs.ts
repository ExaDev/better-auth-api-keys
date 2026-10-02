import type { CreateApiKeyInput } from "../core/index.ts";
import { DAY_MS, type TestClaims, type TestScopes } from "./service-fixture.ts";

/** A typical key lifetime, and the default the host offers. */
const LIFETIME_DAYS = 90;
export const LIFETIME_MS = LIFETIME_DAYS * DAY_MS;

export const alice = { kind: "user", id: "alice" } as const;
export const bob = { kind: "user", id: "bob" } as const;
export const deployer = { kind: "system", id: "deployer" } as const;
/** A system principal whose id is the same string as the person `alice`'s. */
export const aliceSystem = { kind: "system", id: "alice" } as const;
/** Far enough past any lifetime the tests use that every key with an expiry has expired. */
export const YEARS_LATER = 10;

export function input(
  overrides: Partial<CreateApiKeyInput<TestScopes, TestClaims>> = {},
): CreateApiKeyInput<TestScopes, TestClaims> {
  return {
    owner: alice,
    name: "deploys",
    lifetimeMs: LIFETIME_MS,
    scopes: { access: "read" },
    claims: { provider: "google" },
    ...overrides,
  };
}
