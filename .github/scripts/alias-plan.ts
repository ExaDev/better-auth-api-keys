import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

/** The file listing every npm name the release is also published under, relative to the repository root. */
export const ALIASES_FILE = ".github/npm-aliases.json";

/** The name and version a release tag's package.json declares: what an alias publishes as. */
export interface ReleaseIdentity {
  readonly name: string;
  readonly version: string;
}

/** One leg of the alias publishing matrix: publish `primary@version`, built from `tag`, under the name `alias`. */
export interface AliasLeg {
  readonly alias: string;
  readonly primary: string;
  readonly version: string;
  readonly tag: string;
}

/**
 * The alias names in the aliases file, checked rather than assumed: a non-empty array of distinct, non-empty strings. An empty list is refused because the alias jobs would then have nothing to do, and the way to stop publishing aliases is to remove those jobs.
 */
export function parseAliases(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${ALIASES_FILE} must be a non-empty array of npm names`);
  }
  const aliases = value.map((entry: unknown) => {
    if (typeof entry !== "string" || entry === "") {
      throw new Error(
        `${ALIASES_FILE} holds ${JSON.stringify(entry)}, which is not an npm name`,
      );
    }

    return entry;
  });
  const repeated = aliases.find(
    (alias, index) => aliases.indexOf(alias) !== index,
  );
  if (repeated !== undefined) {
    throw new Error(`${ALIASES_FILE} lists ${repeated} more than once`);
  }

  return aliases;
}

/** The name and version a package.json declares, checked rather than assumed. */
export function releaseIdentity(manifest: unknown): ReleaseIdentity {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    !("version" in manifest) ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("package.json declares no string name and version");
  }

  return { name: manifest.name, version: manifest.version };
}

/**
 * One matrix leg per alias, each publishing the release that `tag` names. Throws when an alias is the primary package's own name, since publishing it again would be the primary release itself, not an alias of it.
 */
export function aliasLegs(
  aliases: readonly string[],
  release: ReleaseIdentity,
  tag: string,
): AliasLeg[] {
  if (aliases.includes(release.name)) {
    throw new Error(
      `${ALIASES_FILE} lists ${release.name}, the primary package's own name`,
    );
  }

  return aliases.map((alias) => ({
    alias,
    primary: release.name,
    version: release.version,
    tag,
  }));
}

/** The package.json committed at an existing tag. Throws, naming the tag, when the repository has no such tag. */
function manifestAtTag(tag: string): unknown {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`],
      {
        stdio: "ignore",
      },
    );
  } catch {
    throw new Error(`${tag} is not a tag in this repository`);
  }

  return JSON.parse(
    execFileSync("git", ["show", `refs/tags/${tag}:package.json`], {
      encoding: "utf8",
    }),
  );
}

if (import.meta.main) {
  const [tag] = process.argv.slice(2);
  if (tag === undefined || tag === "") {
    throw new Error("Expected the release tag to publish under every alias");
  }
  const aliases = parseAliases(
    JSON.parse(await readFile(ALIASES_FILE, "utf8")),
  );
  process.stdout.write(
    `${JSON.stringify(aliasLegs(aliases, releaseIdentity(manifestAtTag(tag)), tag))}\n`,
  );
}
