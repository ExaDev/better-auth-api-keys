import { describe, expect, it } from "vitest";
import {
  describeApiKeyStoreContract,
  storedKey,
} from "../test-support/store-contract.ts";
import { createInMemoryApiKeyStore } from "./in-memory-store.ts";
import { createManualClock } from "./manual-clock.ts";

const SECOND_MS = 1000;

describeApiKeyStoreContract("the in-memory store", async () =>
  Promise.resolve({
    store: createInMemoryApiKeyStore(),
    addOwner: async () => Promise.resolve(),
  }),
);

describe("createInMemoryApiKeyStore", () => {
  it("copies records in and out, so a caller's mutation never reaches the store", async () => {
    const store = createInMemoryApiKeyStore();
    const key = storedKey("owner", { scopes: { access: "read" } });
    await store.insert(key);
    key.createdAt.setTime(0);
    const found = await store.findByHash(key.keyHash);
    if (found.outcome !== "found") throw new Error(found.outcome);
    expect(found.key.createdAt).not.toEqual(new Date(0));
    found.key.createdAt.setTime(0);
    const [listed] = await store.listByOwner("owner");
    expect(listed?.createdAt).not.toEqual(new Date(0));
  });

  it("refuses a second key with an id or hash already stored", async () => {
    const store = createInMemoryApiKeyStore();
    const key = storedKey("owner");
    await store.insert(key);
    await expect(store.insert({ ...key, name: "renamed" })).rejects.toThrow(
      "already stored",
    );
  });
});

describe("createManualClock", () => {
  it("stays where it is set until advanced", async () => {
    const clock = createManualClock(new Date("2026-01-01T00:00:00.000Z"));
    expect(await clock.now()).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    clock.advance(SECOND_MS);
    expect(await clock.now()).toEqual(new Date("2026-01-01T00:00:01.000Z"));
    clock.set(new Date("2027-01-01T00:00:00.000Z"));
    expect(await clock.now()).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });
});
