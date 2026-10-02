import js from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import { exadevConfig } from "@exadev/eslint-config";
import type { Linter } from "eslint";
import { defineConfig } from "eslint/config";
import depend from "eslint-plugin-depend";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import yml from "eslint-plugin-yml";
import globals from "globals";
import { builtinModules } from "node:module";

/** One `no-restricted-imports` pattern: an anchored `regex` tested against the raw specifier, or a gitignore-semantics `group`. */
interface RestrictedImportPattern {
  readonly group?: readonly string[];
  readonly regex?: string;
  readonly message: string;
}

/** Runtime source, where the import bans apply. Tests and their shared fixtures are exempt: they run under Node and may reach whatever they need to. */
const runtimeSource = ["src/**/*.ts"];
const runtimeSourceExemptions = ["src/**/*.test.ts", "src/test-support/**"];

/** Node's own builtin module list, reduced to base specifiers, so the isomorphism ban stays complete as Node adds modules rather than needing a hand-maintained list that inevitably misses one. */
const nodeBuiltinBaseModules: readonly string[] = [
  ...new Set(
    builtinModules
      .filter((name) => !name.startsWith("_") && !name.startsWith("node:"))
      .map((name) =>
        name.includes("/") ? name.slice(0, name.indexOf("/")) : name,
      ),
  ),
].sort();

/**
 * The package runs unchanged in a Worker, a browser or Node, so its runtime source may use neither a Node builtin, bare or `node:`-prefixed, nor anything Cloudflare, nor an ORM. The bare-builtin ban is a regex, not a `group` glob: `group` uses gitignore semantics over path segments, which would also match a relative import that merely shares a name with a builtin (`./util/base64`), while the regex is tested against the raw specifier, which keeps its `./` prefix.
 */
const everywherePatterns: readonly RestrictedImportPattern[] = [
  {
    group: ["node:*", "node:*/**"],
    message:
      "This package is runtime-neutral: node:* imports are banned in runtime src. Use a Web API or an injected value instead.",
  },
  {
    regex: `^(${nodeBuiltinBaseModules.join("|")})(/.*)?$`,
    message:
      "This package is runtime-neutral: bare Node builtin imports are banned in runtime src. Use a Web API or an injected value instead.",
  },
  {
    regex: "^(\\.\\./){2}",
    message:
      "A relative import must stay inside the package's own src/, which is all that is published.",
  },
  {
    regex: "^(cloudflare:|@cloudflare/)",
    message:
      "This package is runtime-neutral: Cloudflare modules and types belong to the host.",
  },
  {
    regex: "^drizzle-orm(/.*)?$",
    message:
      "This package reaches storage only through its ApiKeyStore port or better-auth's adapter, never an ORM directly.",
  },
];

/** Lifted only in `src/better-auth/`, so the contract, core, web-crypto and testing entry points can be used without better-auth installed at all. */
const betterAuthPattern: RestrictedImportPattern = {
  regex: "^(better-auth|@better-auth/[^/]+)(/.*)?$",
  message:
    "Only src/better-auth/ may import better-auth: the contract, core, web-crypto and testing folders stay independent of it.",
};

/** A `no-restricted-imports` block. Each block carries the complete pattern list for the files it matches, because ESLint gives a file only the options of the last block that sets the rule. */
function restrictedImports(
  files: readonly string[],
  patterns: readonly RestrictedImportPattern[],
): Linter.Config {
  return {
    files: [...files],
    ignores: [...runtimeSourceExemptions],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...patterns] }],
    },
  };
}

export default defineConfig(
  {
    ignores: [
      "dist",
      "coverage",
      "node_modules",
      "reports",
      ".stryker-tmp",
      ".turbo",
      // wrangler's own local state and bundled temp output from the Workers tests: never source.
      ".wrangler",
      "CHANGELOG.md",
      // A generated lockfile, not source; --fix would otherwise rewrite its quoting on every run.
      "pnpm-lock.yaml",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      // tsconfig.json is the web-only program for src/, which makes runtime neutrality a type-level fact as well as a lint rule; tsconfig.node.json covers the config files and the tests that need Node or Workers types.
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    extends: [
      js.configs.recommended,
      exadevConfig({ react: false, nextjs: false }),
    ],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // A barrel per folder, not only one src/index.ts: each subpath export (./contract, ./core, ./web-crypto, ./testing) needs its own entry point, and ./core must not pull in better-auth through the main barrel.
      "exadev/barrel-policy": ["error", { mode: "siblings" }],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-empty-function": [
        "error",
        { allow: ["arrowFunctions", "asyncFunctions"] },
      ],
      // A test's steps are a scenario played in order (a manual clock advanced between uses, keys drawn in turn from a seeded random stream), so awaiting inside its loops is the point rather than lost parallelism.
      "no-await-in-loop": "off",
    },
  },
  {
    // Test fixtures are never published, so they have no module boundary for a host to depend on: their types are whatever they infer from the code under test, which is the type the tests mean to exercise.
    files: ["src/test-support/**", "test/**"],
    rules: { "@typescript-eslint/explicit-module-boundary-types": "off" },
  },
  restrictedImports(runtimeSource, [...everywherePatterns, betterAuthPattern]),
  restrictedImports(["src/better-auth/**"], everywherePatterns),
  {
    files: runtimeSource,
    ignores: runtimeSourceExemptions,
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "Buffer",
          message:
            "Buffer is Node-only; this runtime-neutral package uses Uint8Array.",
        },
      ],
    },
  },
  {
    files: ["**/*.json"],
    ignores: ["**/tsconfig*.json", "**/turbo.json"],
    plugins: { json },
    language: "json/json",
    extends: [json.configs.recommended],
  },
  {
    files: ["**/*.jsonc", "**/tsconfig*.json", "**/turbo.json"],
    plugins: { json },
    language: "json/jsonc",
    languageOptions: { allowTrailingCommas: true },
    extends: [json.configs.recommended],
  },
  markdown.configs.recommended,
  yml.configs["flat/recommended"].map((config) => ({
    ...config,
    files: ["**/*.{yml,yaml}"],
  })),
  {
    // A GitHub workflow trigger with no filters is a bare key: `pull_request:` means "every pull request", a genuinely absent value. Scoped to .github/ rather than off outright, since an accidentally empty value elsewhere usually is a real mistake.
    files: [".github/**/*.{yml,yaml}"],
    rules: { "yml/no-empty-mapping-value": "off" },
  },
  {
    files: ["**/package.json"],
    plugins: { depend },
    rules: {
      // lint-staged is the pre-commit runner the org's repositories share; eslint-plugin-depend would have it replaced.
      "depend/ban-dependencies": ["error", { allowed: ["lint-staged"] }],
    },
  },
  // Last, deliberately: it bundles eslint-config-prettier, turning off every stylistic rule that would otherwise fight the formatter. Placed earlier, a later config could re-enable one and the two would disagree forever.
  prettierRecommended,
);
