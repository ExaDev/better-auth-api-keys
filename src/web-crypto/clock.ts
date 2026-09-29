import { API_KEYS_CONTRACT_VERSION, type Clock } from "../contract/index.ts";
import { settleUnlessAborted } from "../core/index.ts";

/** A {@link Clock} reading the platform's wall clock. It lives beside the Web Crypto ports as the other web-standard implementation a host wires in; the core itself never reads the time. */
export const systemClock: Clock = {
  version: API_KEYS_CONTRACT_VERSION,
  async now(options) {
    return settleUnlessAborted(options, () => new Date());
  },
};
