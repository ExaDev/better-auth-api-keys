import { ESLint } from "eslint";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..");

/** A typed lint on a loaded machine: the first builds the package's whole program and loads the shared config's plugins, and later ones still re-check the file against it. */
const LINT_TIMEOUT_MS = 120_000;
const eslint = new ESLint({
  cwd: packageRoot,
  ruleFilter: ({ ruleId }) => ruleId === "no-restricted-imports",
  // Under CI=true typescript-eslint assumes a single run and parses each file from disk, ignoring the text lintText is given, so these imports would never be seen.
  overrideConfig: {
    languageOptions: {
      parserOptions: { disallowAutomaticSingleRunInference: true },
    },
  },
});

/** Which of `specifiers` the package's own lint configuration refuses when imported in `file`, from one lint of one import per line. `file` must be a real source file so the typed parser finds it in the package's program. */
async function banned(
  file: string,
  specifiers: readonly string[],
): Promise<readonly string[]> {
  const [result] = await eslint.lintText(
    specifiers.map((specifier) => `import "${specifier}";\n`).join(""),
    { filePath: join(packageRoot, file) },
  );
  if (result === undefined) throw new Error(`${file} was not linted`);
  const unexpected = result.messages.filter(
    (message) => message.ruleId !== "no-restricted-imports",
  );
  if (unexpected.length > 0) {
    throw new Error(unexpected.map((message) => message.message).join("\n"));
  }
  const bannedLines = new Set(result.messages.map((message) => message.line));

  return specifiers.filter((_, index) => bannedLines.has(index + 1));
}

/** One real file in each source folder. */
const everyFolder = [
  "src/contract/version.ts",
  "src/core/key-format.ts",
  "src/web-crypto/clock.ts",
  "src/testing/manual-clock.ts",
  "src/better-auth/schema.ts",
];

// Nothing but the package's own lint configuration keeps it runtime-neutral and its entry points independent of better-auth, so these lint real imports in each folder, which also proves the package's extra bans were merged with the isomorphism guard's rather than replacing them.
const isomorphismBans = ["node:crypto", "fs"];
const boundaryBans = [
  "../../outside-the-package.ts",
  "cloudflare:workers",
  "@cloudflare/workers-types",
  "drizzle-orm",
  "drizzle-orm/d1",
];
const betterAuthImports = [
  "better-auth",
  "better-auth/db",
  "@better-auth/core",
  "@better-auth/core/db/adapter",
];
const allowedEverywhere = ["zod/mini", "../contract/index.ts"];

describe("the package's import boundary", () => {
  it.each(everyFolder.filter((file) => !file.startsWith("src/better-auth/")))(
    "keeps the isomorphism guard and bans Cloudflare, Drizzle, escaping the package and better-auth in %s",
    async (file) => {
      const specifiers = [
        ...isomorphismBans,
        ...boundaryBans,
        ...betterAuthImports,
        ...allowedEverywhere,
      ];
      expect(await banned(file, specifiers)).toEqual([
        ...isomorphismBans,
        ...boundaryBans,
        ...betterAuthImports,
      ]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "keeps every other ban in src/better-auth/, and allows better-auth only there",
    async () => {
      const specifiers = [
        ...isomorphismBans,
        ...boundaryBans,
        ...betterAuthImports,
        ...allowedEverywhere,
      ];
      expect(await banned("src/better-auth/schema.ts", specifiers)).toEqual([
        ...isomorphismBans,
        ...boundaryBans,
      ]);
    },
    LINT_TIMEOUT_MS,
  );
});
