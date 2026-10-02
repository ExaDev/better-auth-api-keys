import { API_KEYS_CONTRACT_VERSION, type Clock } from "../contract/index.ts";
import { settleUnlessAborted } from "../core/index.ts";

/** A {@link Clock} a test sets and advances by hand. */
export interface ManualClock extends Clock {
  /** Moves the clock forward by `ms` milliseconds. */
  advance: (ms: number) => void;
  /** Sets the clock to `at`. */
  set: (at: Date) => void;
}

/** A {@link ManualClock} starting at `start`, which only moves when told to. */
export function createManualClock(start: Date): ManualClock {
  let current = start.getTime();

  return {
    version: API_KEYS_CONTRACT_VERSION,
    async now(options) {
      return settleUnlessAborted(options, () => new Date(current));
    },
    advance(ms) {
      current += ms;
    },
    set(at) {
      current = at.getTime();
    },
  };
}
