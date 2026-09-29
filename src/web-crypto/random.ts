import {
  API_KEYS_CONTRACT_VERSION,
  type RandomSource,
} from "../contract/index.ts";
import { settleUnlessAborted } from "../core/index.ts";

/** A {@link RandomSource} backed by Web Crypto's `crypto.getRandomValues`, the platform's cryptographically secure generator in Workers, browsers and Node alike. */
export const webCryptoRandomSource: RandomSource = {
  version: API_KEYS_CONTRACT_VERSION,
  async bytes(length, options) {
    return settleUnlessAborted(options, () =>
      crypto.getRandomValues(new Uint8Array(length)),
    );
  },
};
