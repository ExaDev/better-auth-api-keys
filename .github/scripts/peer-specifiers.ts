import { readFile } from "node:fs/promises";

/** Which end of each peer's range to install: its lowest version, or the newest the range admits. */
export type RangeEnd = "floor" | "latest";

const CARET_RANGE = /^\^(\d+\.\d+\.\d+)$/u;

function isRangeEnd(value: string | undefined): value is RangeEnd {
  return value === "floor" || value === "latest";
}

/**
 * The `pnpm update` specifiers that install every peer at one end of its range: `name@x.y.z` for the floor of `^x.y.z`, and `name@^x.y.z` for the newest version it admits. Throws for a range that is not a plain caret range, since its floor would not be a single version.
 */
export function peerSpecifiers(
  peers: Readonly<Record<string, string>>,
  end: RangeEnd,
): string[] {
  return Object.entries(peers).map(([name, range]) => {
    const floor = CARET_RANGE.exec(range)?.[1];
    if (floor === undefined) {
      throw new Error(
        `${name}'s peer range ${range} is not a caret range with a single floor version`,
      );
    }

    return end === "floor" ? `${name}@${floor}` : `${name}@${range}`;
  });
}

/** The package.json field this reads, checked rather than assumed. */
function peerDependenciesOf(manifest: unknown): Record<string, string> {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("peerDependencies" in manifest)
  ) {
    throw new Error("package.json declares no peerDependencies");
  }
  const peers: unknown = manifest.peerDependencies;
  if (typeof peers !== "object" || peers === null || Array.isArray(peers)) {
    throw new Error("package.json's peerDependencies is not an object");
  }

  return Object.fromEntries(
    Object.entries(peers).map(([name, range]: [string, unknown]) => {
      if (typeof range !== "string") {
        throw new Error(`${name}'s peer range is not a string`);
      }

      return [name, range];
    }),
  );
}

if (import.meta.main) {
  const [end] = process.argv.slice(2);
  if (!isRangeEnd(end)) {
    throw new Error(`Expected "floor" or "latest", not ${String(end)}`);
  }
  const manifest: unknown = JSON.parse(await readFile("package.json", "utf8"));
  process.stdout.write(
    `${peerSpecifiers(peerDependenciesOf(manifest), end).join(" ")}\n`,
  );
}
