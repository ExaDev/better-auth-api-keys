import { ESLint } from "eslint";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..");

/** The first lint builds the package's whole typed program and loads the shared config's plugins, which takes seconds on a loaded machine; later lints reuse both. */
const FIRST_LINT_TIMEOUT_MS = 120_000;
const eslint = new ESLint({
  cwd: packageRoot,
  ruleFilter: ({ ruleId }) => ruleId === "no-restricted-imports",
});

/** Whether the package's own lint configuration refuses `import "<specifier>"` written in `file`, which must be a real source file so the typed parser finds it in the package's program. */
async function bans(file: string, specifier: string): Promise<boolean> {
  const [result] = await eslint.lintText(`import "${specifier}";\n`, {
    filePath: join(packageRoot, file),
  });
  if (result === undefined) throw new Error(`${file} was not linted`);
  const unexpected = result.messages.filter(
    (message) => message.ruleId !== "no-restricted-imports",
  );
  if (unexpected.length > 0) {
    throw new Error(unexpected.map((message) => message.message).join("\n"));
  }
  return result.messages.length > 0;
}

/** One real file in each source folder. */
const everyFolder = [
  "src/contract/version.ts",
  "src/core/key-format.ts",
  "src/web-crypto/clock.ts",
  "src/testing/manual-clock.ts",
  "src/better-auth/schema.ts",
];

// The package is built to move to its own repository, and nothing else in this flat workspace enforces that it stays independent, so its own lint configuration does. These lint real imports in each folder, which also proves the package's extra bans were merged with the isomorphism guard's rather than replacing them.
describe("the package's import boundary", () => {
  beforeAll(async () => {
    await bans("src/contract/index.ts", "zod/mini");
  }, FIRST_LINT_TIMEOUT_MS);

  it.each(everyFolder)("keeps the isomorphism guard in %s", async (file) => {
    expect(await bans(file, "node:crypto")).toBe(true);
    expect(await bans(file, "fs")).toBe(true);
  });

  it.each(everyFolder)(
    "bans workspace packages, Cloudflare, Drizzle and escaping the package in %s",
    async (file) => {
      for (const specifier of [
        "db",
        "contract",
        "tokens",
        "access-policy/roles",
        "api",
        "../../apps/api/src/index.ts",
        "cloudflare:workers",
        "@cloudflare/workers-types",
        "drizzle-orm",
        "drizzle-orm/d1",
      ]) {
        expect(await bans(file, specifier), specifier).toBe(true);
      }
      expect(await bans(file, "zod/mini")).toBe(false);
    },
  );

  it.each(everyFolder.filter((file) => !file.startsWith("src/better-auth/")))(
    "bans better-auth in %s",
    async (file) => {
      for (const specifier of [
        "better-auth",
        "better-auth/db",
        "@better-auth/core",
        "@better-auth/core/db/adapter",
      ]) {
        expect(await bans(file, specifier), specifier).toBe(true);
      }
    },
  );

  it("allows better-auth in src/better-auth/", async () => {
    expect(await bans("src/better-auth/schema.ts", "better-auth/db")).toBe(
      false,
    );
    expect(await bans("src/better-auth/schema.ts", "@better-auth/core")).toBe(
      false,
    );
  });
});
