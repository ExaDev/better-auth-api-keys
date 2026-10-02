import { describe, expect, it } from "vitest";
import {
  installabilityProblem,
  secondsToMs,
  WaitTimeoutError,
  waitUntilReady,
} from "./wait-for-primary.ts";

/** A clock whose sleep advances time instantly and records each requested sleep. */
function fakeClock() {
  let time = 0;
  const sleeps: number[] = [];

  return {
    sleeps,
    clock: {
      now: () => time,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        time += ms;
        await Promise.resolve();
      },
    },
  };
}

/** An already-settled promise, awaited so a stub stays an async function. */
async function resolved<T>(value: T): Promise<T> {
  return await Promise.resolve(value);
}

const INTERVAL_MS = 10_000;
const HALF_INTERVAL_MS = INTERVAL_MS / 2;
const policy = {
  budgetMs: INTERVAL_MS * 2 + HALF_INTERVAL_MS,
  intervalMs: INTERVAL_MS,
};
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const ATTEMPTS_WHEN_READY_ON_THIRD = 3;
const ATTEMPTS_WHEN_TIMED_OUT = 4;
const MS_PER_SECOND = 1000;
const SECONDS_IN_INPUT = 30;

describe("waitUntilReady", () => {
  it("returns after one probe when already ready, without sleeping", async () => {
    const { clock, sleeps } = fakeClock();

    expect(
      await waitUntilReady(async () => resolved(undefined), policy, clock),
    ).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("keeps probing at the interval until ready", async () => {
    const { clock, sleeps } = fakeClock();
    const reasons = ["not yet", "not yet", undefined];
    let call = 0;

    const attempts = await waitUntilReady(
      async () => resolved(reasons[call++]),
      policy,
      clock,
    );

    expect(attempts).toBe(ATTEMPTS_WHEN_READY_ON_THIRD);
    expect(sleeps).toEqual([INTERVAL_MS, INTERVAL_MS]);
  });

  it("clamps the last sleep to the budget, probes once more, then times out with the last reason", async () => {
    const { clock, sleeps } = fakeClock();
    let call = 0;

    const failure = await waitUntilReady(
      async () => resolved(`reason ${++call}`),
      policy,
      clock,
    ).catch((error: unknown) => error);

    expect(sleeps).toEqual([INTERVAL_MS, INTERVAL_MS, HALF_INTERVAL_MS]);
    expect(failure).toBeInstanceOf(WaitTimeoutError);
    expect(failure).toMatchObject({
      attempts: ATTEMPTS_WHEN_TIMED_OUT,
      lastReason: "reason 4",
    });
  });
});

describe("secondsToMs", () => {
  it("converts a positive whole number of seconds", () => {
    expect(secondsToMs("X", "30")).toBe(SECONDS_IN_INPUT * MS_PER_SECOND);
  });

  it.each([undefined, "", "0", "-1", "1.5", "ten"])("refuses %j", (value) => {
    expect(() => secondsToMs("X", value)).toThrow("X must be a positive");
  });
});

describe("installabilityProblem", () => {
  const head = (status: number) => async () => resolved(status);

  it("is ready when the packument lists the version and the tarball answers 200", async () => {
    expect(
      await installabilityProblem(
        "p@1.0.0",
        () => "https://r/p.tgz",
        head(HTTP_OK),
      ),
    ).toBeUndefined();
  });

  it("is not ready while the packument lacks the version", async () => {
    expect(
      await installabilityProblem("p@1.0.0", () => undefined, head(HTTP_OK)),
    ).toContain("does not list p@1.0.0");
  });

  it("is not ready while the tarball does not answer 200", async () => {
    expect(
      await installabilityProblem(
        "p@1.0.0",
        () => "https://r/p.tgz",
        head(HTTP_NOT_FOUND),
      ),
    ).toBe(`https://r/p.tgz answered ${HTTP_NOT_FOUND}`);
  });
});
