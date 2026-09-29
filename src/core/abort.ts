import type { PortCallOptions } from "../contract/index.ts";

/**
 * Runs a synchronous port body as a promise, honouring the call's signal the way the port contract requires: an already-aborted signal rejects with its reason before `body` runs, and anything `body` throws rejects too, rather than throwing out of a method that promises to return a promise.
 */
export async function settleUnlessAborted<Result>(
  options: PortCallOptions | undefined,
  body: () => Result,
): Promise<Result> {
  return new Promise((resolve) => {
    options?.signal?.throwIfAborted();
    resolve(body());
  });
}
