import {
  API_KEYS_CONTRACT_VERSION,
  type RandomSource,
} from "../contract/index.ts";
import { settleUnlessAborted } from "../core/index.ts";

/** A random source that hands out `script`'s bytes in order and records each request's length, for tests that pin exactly which bytes rejection sampling sees. Throws once the script runs out, so a test never passes on bytes it did not choose. */
export function scriptedRandomSource(
  script: readonly number[],
): RandomSource & {
  readonly requests: number[];
} {
  let next = 0;
  const requests: number[] = [];
  return {
    version: API_KEYS_CONTRACT_VERSION,
    requests,
    bytes: async (length, options) =>
      settleUnlessAborted(options, () => {
        requests.push(length);
        if (next + length > script.length) {
          throw new Error("The scripted random source has run out of bytes");
        }
        const bytes = Uint8Array.from(script.slice(next, next + length));
        next += length;
        return bytes;
      }),
  };
}

/** mulberry32's increment and output mixing constants, from its reference implementation. */
const MULBERRY32_INCREMENT = 0x6d2b79f5;
const MULBERRY32_MIX_A = 15;
const MULBERRY32_MIX_B = 7;
const MULBERRY32_MIX_C = 14;
const MULBERRY32_MIX_D = 61;
const BYTE_MASK = 0xff;

/** A deterministic, seeded random source (mulberry32), so a property test that fails can be replayed exactly. Not cryptographically secure, and only for tests. */
export function seededRandomSource(seed: number): RandomSource {
  let state = seed >>> 0;
  const nextByte = () => {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> MULBERRY32_MIX_A), mixed | 1);
    mixed ^=
      mixed +
      Math.imul(mixed ^ (mixed >>> MULBERRY32_MIX_B), mixed | MULBERRY32_MIX_D);
    return ((mixed ^ (mixed >>> MULBERRY32_MIX_C)) >>> 0) & BYTE_MASK;
  };
  return {
    version: API_KEYS_CONTRACT_VERSION,
    bytes: async (length, options) =>
      settleUnlessAborted(options, () => Uint8Array.from({ length }, nextByte)),
  };
}
