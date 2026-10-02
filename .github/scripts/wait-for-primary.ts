import { execFileSync } from "node:child_process";

/** How long to wait and how often to look, both in milliseconds. */
export interface WaitPolicy {
  readonly budgetMs: number;
  readonly intervalMs: number;
}

/** The clock and sleep a wait runs against, injected so a test never really waits. */
export interface WaitClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** Thrown when the budget ran out before the probe succeeded; carries the last reason the probe gave. */
export class WaitTimeoutError extends Error {
  readonly attempts: number;

  readonly lastReason: string;

  constructor(attempts: number, lastReason: string) {
    super(`gave up after ${attempts} attempts: ${lastReason}`);
    this.attempts = attempts;
    this.lastReason = lastReason;
  }
}

/**
 * Calls `probe` until it returns `undefined` (ready) or the budget is spent. A probe that returns a string is not ready yet, and the string says why. Always probes at least once, and never sleeps past the end of the budget. Resolves with the number of probes made.
 */
export async function waitUntilReady(
  probe: () => Promise<string | undefined>,
  policy: WaitPolicy,
  clock: WaitClock,
): Promise<number> {
  const deadline = clock.now() + policy.budgetMs;
  const attempt = async (attempts: number): Promise<number> => {
    const reason = await probe();
    if (reason === undefined) {
      return attempts;
    }
    const remaining = deadline - clock.now();
    if (remaining <= 0) {
      throw new WaitTimeoutError(attempts, reason);
    }
    await clock.sleep(Math.min(policy.intervalMs, remaining));

    return attempt(attempts + 1);
  };

  return attempt(1);
}

const MS_PER_SECOND = 1000;

/** The HTTP status of a successful tarball request. */
const HTTP_OK = 200;

/** A positive whole number of seconds from an environment variable, as milliseconds. Throws, naming the variable, for anything else. */
export function secondsToMs(name: string, value: string | undefined): number {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${name} must be a positive whole number of seconds`);
  }

  return Number(value) * MS_PER_SECOND;
}

/**
 * Why `spec` is not yet installable, or `undefined` when it is: the registry's packument must list the version (read with --prefer-online, so no cached packument can hide a version published since) and the tarball it names must be downloadable. The packument is what `npm pack` resolves a version from, and the tarball is fetched from the registry's CDN, so each can lag the other.
 */
export async function installabilityProblem(
  spec: string,
  viewTarball: (spec: string) => string | undefined,
  fetchHead: (url: string) => Promise<number>,
): Promise<string | undefined> {
  const tarball = viewTarball(spec);
  if (tarball === undefined) {
    return `the registry's packument does not list ${spec}`;
  }
  const status = await fetchHead(tarball);
  if (status !== HTTP_OK) {
    return `${tarball} answered ${status}`;
  }

  return undefined;
}

/** The tarball URL npm reports for `spec`, or `undefined` when the registry does not have that version. */
function npmViewTarball(spec: string): string | undefined {
  try {
    return execFileSync(
      "npm",
      ["view", spec, "dist.tarball", "--prefer-online"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const [spec] = process.argv.slice(2);
  if (spec === undefined || spec === "") {
    throw new Error("Expected the package spec to wait for, name@version");
  }
  const policy: WaitPolicy = {
    budgetMs: secondsToMs(
      "WAIT_BUDGET_SECONDS",
      process.env.WAIT_BUDGET_SECONDS,
    ),
    intervalMs: secondsToMs(
      "WAIT_INTERVAL_SECONDS",
      process.env.WAIT_INTERVAL_SECONDS,
    ),
  };
  try {
    const attempts = await waitUntilReady(
      async () =>
        installabilityProblem(
          spec,
          npmViewTarball,
          async (url) => (await fetch(url, { method: "HEAD" })).status,
        ),
      policy,
      {
        now: () => Date.now(),
        sleep: async (ms) => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
          });
        },
      },
    );
    process.stdout.write(`${spec} is installable (attempt ${attempts}).\n`);
  } catch (error) {
    if (!(error instanceof WaitTimeoutError)) {
      throw error;
    }
    process.stderr.write(
      `::error::${spec} is not visible on the registry after ${policy.budgetMs / MS_PER_SECOND}s (${error.lastReason}). If the release did publish it, backfill once it is visible with: gh workflow run ci.yml -f alias_tag=v${spec.slice(spec.lastIndexOf("@") + 1)}\n`,
    );
    process.exit(1);
  }
}
