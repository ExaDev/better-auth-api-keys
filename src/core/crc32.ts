/**
 * The reflected form of the IEEE 802.3 CRC-32 polynomial, the one zlib, PNG and Ethernet use, so anyone (a secret scanner included) can recompute a key's checksum with a standard library.
 */
const CRC32_POLYNOMIAL = 0xedb88320;

/** CRC-32 as zlib defines it starts from all ones and inverts the result, so leading zero bytes still change the checksum. */
const CRC32_ALL_ONES = 0xffffffff;

const BITS_PER_BYTE = 8;
const BYTE_MASK = 2 ** BITS_PER_BYTE - 1;

/** One entry per byte value, precomputed once. */
const CRC32_TABLE: readonly number[] = Array.from(
  { length: 2 ** BITS_PER_BYTE },
  (_, byte) => {
    let value = byte;
    for (let bit = 0; bit < BITS_PER_BYTE; bit++) {
      value = value & 1 ? (value >>> 1) ^ CRC32_POLYNOMIAL : value >>> 1;
    }
    return value >>> 0;
  },
);

const textEncoder = new TextEncoder();

/** The standard CRC-32 of `text`'s UTF-8 bytes, as an unsigned 32-bit integer. */
export function crc32(text: string): number {
  let crc = CRC32_ALL_ONES;
  for (const byte of textEncoder.encode(text)) {
    const entry = CRC32_TABLE[(crc ^ byte) & BYTE_MASK];
    if (entry === undefined) {
      throw new Error(
        "Unreachable: a value masked to one byte always indexes the table",
      );
    }
    crc = (crc >>> BITS_PER_BYTE) ^ entry;
  }
  return (crc ^ CRC32_ALL_ONES) >>> 0;
}
